/**
 * DAILY POS SALES IMPORT — pure pipeline (vision-direct, code-matched)
 * ====================================================================
 * Rebuild of the failed product-line importer. A photo of the Arabic POS daily
 * product report is read by a vision model into strict JSON (see `RawDayReport`);
 * THIS module turns that JSON into a review model with zero I/O:
 *
 *   1. VALIDATE deterministically — per line net_qty = qty_sold − qty_returned and
 *      net_value = net_qty × avg_unit_price; and Σ net_value must equal the
 *      document's branch net total (اجمالى الفرع). Nothing that fails is hidden.
 *   2. MATCH each line to a product by POS item code (كود الصنف), exact after
 *      leading-zero folding. Unmatched codes are surfaced, never dropped/guessed.
 *   3. DECIDE what to do with the day (attach / create / duplicate) against the
 *      sale row that already exists, and CROSS-CHECK the read total to that day's
 *      saved total_amount.
 *   4. CONFIDENCE per line using the existing verification enum.
 *
 * All functions are pure and unit-tested; the screen owns the photo upload, the
 * DB reads that populate `ExistingDay`, and the writes (create_sale_item RPC).
 * The financial engine / money math is never touched here.
 */
import { toIso } from "./csv";
import type { Enums } from "@/core/db/tables";

export type Verification = Enums<"verification_status">; // verified | partially_verified | unverified | estimated

// ── Vision output shape (the reader returns exactly this) ───────────────────
export interface RawDayLine {
  item_code: string;
  barcode: string;            // الباركود (13-digit) — NOT used for matching; kept only
                              // so a newly-assigned product can be auto-coded (market_code)
  name_ar: string;
  avg_unit_price: number | null;
  qty_sold: number | null;
  qty_returned: number | null;
  net_qty: number | null;
  net_value: number | null;
}

/** The owner-facing 4-digit code = the 4 digits after the "230" barcode prefix
 *  (2301606000004 → "1606"). Returns null when the barcode doesn't fit. Slicing
 *  is done here in code — the 4 digits are never eyeballed off the document. */
export function marketCodeFromBarcode(barcode: string | null | undefined): string | null {
  const m = /^230(\d{4})\d+$/.exec((barcode ?? "").replace(/\D/g, ""));
  return m ? m[1] : null;
}
export interface RawDayReport {
  sale_date: string | null;        // the "من" (from) date, ISO
  branch_total_net: number | null; // اجمالى الفرع = the reconciliation anchor
  line_items: RawDayLine[];
}

// ── Product code index ──────────────────────────────────────────────────────
export interface CodedProduct { id: string; nameEn: string; nameAr: string | null; posCode: string | null; marketCode: string | null }

/** Canonical form of an item code: digits only, leading zeros folded, so a code
 *  read as "00021043", "21043" or "0021043" all resolve to the same key. */
export function canonCode(code: string | null | undefined): string {
  return (code ?? "").replace(/\D/g, "").replace(/^0+/, "");
}

/** Index products for line matching. Keys are namespaced so the two code spaces
 *  never collide: "p:<canon pos_code>" (primary, hidden 8-digit key the document
 *  prints) and "m:<market_code>" (the 4-digit code, derived from the same
 *  barcode the document also prints). The market key is the fallback used when a
 *  vision misread mangles the item code but the barcode reads clean. Products
 *  without a code are skipped (they can never be code-matched). */
export function buildCodeIndex(products: CodedProduct[]): Map<string, CodedProduct> {
  const m = new Map<string, CodedProduct>();
  for (const p of products) {
    const c = canonCode(p.posCode);
    if (c && !m.has(`p:${c}`)) m.set(`p:${c}`, p);
    if (p.marketCode && !m.has(`m:${p.marketCode}`)) m.set(`m:${p.marketCode}`, p);
  }
  return m;
}

// ── Tolerances ──────────────────────────────────────────────────────────────
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000; // weights carry 3 decimals
/** Money tolerance: 1% of the magnitude, floor 1.00 EGP (rounding + OCR wobble). */
const moneyTol = (v: number) => Math.max(1, Math.abs(v) * 0.01);
/** Quantity tolerance: 1% of the magnitude, floor 0.01 (weights to 3dp). */
const qtyTol = (v: number) => Math.max(0.01, Math.abs(v) * 0.01);

// ── Per-line analysis ───────────────────────────────────────────────────────
export interface AnalyzedLine extends RawDayLine {
  canon: string;                    // canonical (hidden) pos code, for matching only
  productId: string | null;         // matched product (by code)
  productName: string | null;       // matched product's English name
  productMarketCode: string | null; // matched product's owner-facing 4-digit code (shown)
  matchedByBarcode: boolean;        // pos code misread → matched via the barcode instead
  netValue: number | null;          // net_value, or inferred from qty×price
  inferred: boolean;                // netValue was computed, not read
  issues: string[];                 // deterministic validation problems
}

/** Validate + code-match ONE line. Returns the enriched line; the arithmetic
 *  checks are the charter's per-line contract (net qty and net value). */
export function analyzeLine(l: RawDayLine, index: Map<string, CodedProduct>): AnalyzedLine {
  const issues: string[] = [];
  const canon = canonCode(l.item_code);
  // Match on the hidden pos code first (the document's item code); if that misread
  // and left no match, fall back to the market code derived from the barcode.
  const mkt = marketCodeFromBarcode(l.barcode);
  const product = (canon ? index.get(`p:${canon}`) : null)
    ?? (mkt ? index.get(`m:${mkt}`) : null)
    ?? null;
  const matchedByBarcode = !!product && !(canon && index.get(`p:${canon}`));

  // net_qty = qty_sold − qty_returned
  if (l.qty_sold != null && l.net_qty != null) {
    const ret = l.qty_returned ?? 0;
    if (Math.abs(l.net_qty - (l.qty_sold - ret)) > qtyTol(l.qty_sold)) {
      issues.push("net qty ≠ sold − returned");
    }
  }

  // net_value: read when present, else inferred from net_qty × avg price
  let netValue = l.net_value;
  let inferred = false;
  if (netValue == null && l.net_qty != null && l.avg_unit_price != null) {
    netValue = r2(l.net_qty * l.avg_unit_price);
    inferred = true;
    issues.push("value inferred from qty × price");
  }

  // net_value = net_qty × avg_unit_price (arithmetic tie)
  if (!inferred && netValue != null && l.net_qty != null && l.avg_unit_price != null) {
    const expect = l.net_qty * l.avg_unit_price;
    if (Math.abs(netValue - expect) > moneyTol(netValue)) issues.push("value ≠ qty × price");
  }

  if (!canon) issues.push("no item code");
  if (netValue == null) issues.push("no value");
  if (!product && canon) issues.push("code not matched");

  return {
    ...l,
    canon,
    productId: product?.id ?? null,
    productName: product?.nameEn ?? null,
    productMarketCode: product?.marketCode ?? null,
    matchedByBarcode,
    netValue: netValue != null ? r2(netValue) : null,
    inferred,
    issues,
  };
}

// ── Whole-document analysis ─────────────────────────────────────────────────
export interface DayAnalysis {
  saleDate: string | null;
  branchTotalNet: number | null; // printed اجمالى الفرع
  readTotal: number;             // Σ net_value of the read lines
  totalReconciles: boolean;      // readTotal ≈ branchTotalNet
  lines: AnalyzedLine[];
  matchedCount: number;
  unmatchedCodes: string[];      // canonical codes with no product (review queue)
  issues: string[];             // document-level problems
}

/** Turn a raw vision report into the full review model. Pure. */
export function analyzeDayReport(report: RawDayReport, index: Map<string, CodedProduct>): DayAnalysis {
  const lines = (report.line_items ?? []).map((l) => analyzeLine(l, index));
  const readTotal = r2(lines.reduce((s, l) => s + (l.netValue ?? 0), 0));
  const branchTotalNet = report.branch_total_net;
  const totalReconciles =
    branchTotalNet != null && Math.abs(readTotal - branchTotalNet) <= moneyTol(branchTotalNet);

  const issues: string[] = [];
  const saleDate = report.sale_date ? toIso(report.sale_date) : null;
  if (!saleDate) issues.push("no sale date read");
  if (branchTotalNet == null) issues.push("no branch total read");
  else if (!totalReconciles) issues.push(`lines sum to ${readTotal}, document says ${branchTotalNet}`);

  const unmatched = new Set<string>();
  let matched = 0;
  for (const l of lines) {
    if (l.productId) matched++;
    else if (l.canon) unmatched.add(l.canon);
  }

  return {
    saleDate, branchTotalNet, readTotal, totalReconciles, lines,
    matchedCount: matched, unmatchedCodes: [...unmatched], issues,
  };
}

// ── Confidence (existing verification enum; never blanket-'verified') ────────
/** Per-line provenance. Gated by whether the WHOLE document reconciled:
 *   verified            = code-matched, doc total reconciles, clean arithmetic
 *   partially_verified  = matched but a line arithmetic check failed
 *   estimated           = a value was inferred (net_value not printed)
 *   unverified          = doc total failed to reconcile, or line has no product
 *                         (cannot be saved without an explicit owner override). */
export function lineConfidence(line: AnalyzedLine, docReconciles: boolean): Verification {
  if (!line.productId) return "unverified";       // unmatched — must be reviewed, not saved
  if (!docReconciles) return "unverified";        // whole doc is suspect
  if (line.inferred) return "estimated";
  if (line.issues.length) return "partially_verified";
  return "verified";
}

// ── Decision against the day that already exists ────────────────────────────
export type DayAction =
  | "attach"              // day exists as a total with no lines → the main case
  | "create"             // no day exists → propose creating it
  | "duplicate_block"    // day already has lines and totals match → already imported
  | "duplicate_flag"     // day already has lines and totals differ → needs a human
  | "blocked_unreconciled"; // doc total failed to reconcile → nothing saves w/o override

export interface ExistingDay { id: string; total: number; lineCount: number }

export interface DayDecision {
  action: DayAction;
  reason: string;
  savedTotal: number | null; // the day's existing total_amount (cross-check anchor)
  readTotal: number;         // Σ net_value read from the photo
  totalsMatch: boolean;      // savedTotal ≈ readTotal
}

/** Decide what to do with this day. `existing` is null when no sale row exists
 *  for the date. Cross-checks the read total against the day's saved total. */
export function decideDayAction(
  analysis: Pick<DayAnalysis, "readTotal" | "totalReconciles">,
  existing: ExistingDay | null,
): DayDecision {
  const { readTotal, totalReconciles } = analysis;
  const savedTotal = existing ? r2(existing.total) : null;
  const totalsMatch = savedTotal != null && Math.abs(savedTotal - readTotal) <= moneyTol(savedTotal);

  if (!totalReconciles) {
    return { action: "blocked_unreconciled", reason: "The photo's lines don't add up to its own branch total — review before saving.", savedTotal, readTotal, totalsMatch };
  }
  if (!existing) {
    return { action: "create", reason: "No sale exists for this day yet — propose creating it from these lines.", savedTotal, readTotal, totalsMatch };
  }
  if (existing.lineCount === 0) {
    return { action: "attach", reason: totalsMatch
      ? "Day exists as a total with no product lines — attach these and the totals agree."
      : `Day exists with no lines — attach, but the read total (${readTotal}) differs from the saved total (${savedTotal}).`,
      savedTotal, readTotal, totalsMatch };
  }
  // day already has lines
  if (totalsMatch) {
    return { action: "duplicate_block", reason: "This day already has product lines that match this total — already imported.", savedTotal, readTotal, totalsMatch };
  }
  return { action: "duplicate_flag", reason: `This day already has product lines, but their total (${savedTotal}) differs from this photo (${readTotal}) — do not overwrite; reconcile manually.`, savedTotal, readTotal, totalsMatch };
}

/** Only 'attach' and 'create' can write. Duplicates and unreconciled docs are
 *  read-only until the owner overrides. */
export function actionCanSave(action: DayAction): boolean {
  return action === "attach" || action === "create";
}

export { r2 as round2, r3 as round3 };
