/** "Load my Bosta Bites history" — one-click importer for the bundled, already
 *  cleaned real ledgers in public/seed/*.csv. It fetches the CSVs, runs them
 *  through the Basic Accounting Brain one more time (belt-and-braces dedupe),
 *  and creates ORDINARY editable entries (sales, expenses, cash cheques,
 *  products) — nothing is hardcoded in the app, so the owner can view, edit or
 *  void any of it afterwards. Re-running is safe: every writer first checks what
 *  already exists and skips it, so the import is idempotent. */
import Papa from "papaparse";
import {
  dedupeDailySales, dedupeExpenses, dedupeCheques,
  type CleanSale, type CleanExpense, type CleanCheque,
} from "@/core/accounting/brain";
import { requireEngine } from "@/core/db/engine";
import { getLocations, getChannels } from "@/core/read/common";
import {
  createSale, addExpense, ensureExpenseCategory,
  createProduct, addAlias, openSettlementPeriod, recordCheque,
} from "@/core/db/mutations";

// ── Bundle shape ────────────────────────────────────────────────────────────
export interface SeedProduct { nameAr: string; barcode: string; avgPrice: number | null }
export interface SeedBundle {
  sales: CleanSale[];
  expenses: CleanExpense[];
  cheques: CleanCheque[];
  products: SeedProduct[];
}
export type SeedKind = "sales" | "expenses" | "cheques" | "products";
export interface SeedOptions { sales: boolean; expenses: boolean; cheques: boolean; products: boolean }

/** Goods-cost category name — purchases and stock buys are merged into this one
 *  expense category (the owner asked to keep it simple as a single bucket). */
export const STOCK_CATEGORY = "Stock";

const num = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

async function fetchCsv<T = Record<string, string>>(name: string): Promise<T[]> {
  const url = `${import.meta.env.BASE_URL}seed/${name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${name} (${res.status})`);
  const text = await res.text();
  const parsed = Papa.parse<T>(text, { header: true, skipEmptyLines: true });
  return parsed.data;
}

/** Fetch + clean the four seed files. Pure of any DB writes. */
export async function fetchSeedBundle(): Promise<SeedBundle> {
  const [salesRaw, expRaw, chqRaw, prodRaw] = await Promise.all([
    fetchCsv<{ date: string; total: string }>("sales.csv"),
    fetchCsv<{ date: string; category: string; amount: string; notes?: string }>("expenses.csv"),
    fetchCsv<{ date: string; amount: string }>("cheques.csv"),
    fetchCsv<{ name_ar: string; barcode: string; avg_price: string }>("products.csv"),
  ]);

  const sales = dedupeDailySales(
    salesRaw.map((r) => ({ date: r.date, total: num(r.total) ?? 0 })).filter((r) => r.date && r.total),
  ).clean;

  const expenses = dedupeExpenses(
    expRaw
      .map((r) => ({ date: r.date, category: (r.category || "Other").trim(), amount: num(r.amount) ?? 0, vendor: (r.notes || "").trim() || null }))
      .filter((r) => r.date && r.amount),
  ).clean;

  const cheques = dedupeCheques(
    chqRaw.map((r) => ({ date: r.date, amount: num(r.amount) ?? 0 })).filter((r) => r.date && r.amount),
  ).clean;

  const products: SeedProduct[] = prodRaw
    .map((r) => ({ nameAr: (r.name_ar || "").trim(), barcode: (r.barcode || "").trim(), avgPrice: num(r.avg_price) }))
    .filter((p) => p.nameAr);

  return { sales, expenses, cheques, products };
}

// ── Reconciliation preview (what the owner sees before approving) ────────────
export interface SeedPreview {
  sales: { rows: number; total: number; from: string; to: string };
  expenses: { rows: number; total: number; stock: number; operating: number };
  cheques: { rows: number; total: number };
  products: { rows: number; withBarcode: number };
}
export function previewBundle(b: SeedBundle): SeedPreview {
  const dates = b.sales.map((s) => s.date).sort();
  const stock = b.expenses.filter((e) => e.category.toLowerCase() === STOCK_CATEGORY.toLowerCase()).reduce((a, e) => a + e.amount, 0);
  const expTotal = b.expenses.reduce((a, e) => a + e.amount, 0);
  return {
    sales: { rows: b.sales.length, total: b.sales.reduce((a, s) => a + s.total, 0), from: dates[0] ?? "—", to: dates[dates.length - 1] ?? "—" },
    expenses: { rows: b.expenses.length, total: expTotal, stock, operating: expTotal - stock },
    cheques: { rows: b.cheques.length, total: b.cheques.reduce((a, c) => a + c.amount, 0) },
    products: { rows: b.products.length, withBarcode: b.products.filter((p) => p.barcode).length },
  };
}

// ── Import runner ────────────────────────────────────────────────────────────
export interface SectionResult { created: number; skipped: number; failed: number }
export type SeedReport = Record<SeedKind, SectionResult>;
export interface Progress { phase: SeedKind; done: number; total: number }

const r2 = (n: number) => Math.round(n * 100) / 100;
const blank = (): SectionResult => ({ created: 0, skipped: 0, failed: 0 });

/** Create entries for the chosen sections. Idempotent: existing days / matching
 *  rows / known products are skipped, so a second run is a no-op. */
export async function runSeedImport(
  bundle: SeedBundle, opts: SeedOptions, onProgress?: (p: Progress) => void,
): Promise<SeedReport> {
  const sb = requireEngine();
  const report: SeedReport = { sales: blank(), expenses: blank(), cheques: blank(), products: blank() };

  // ---- SALES → one canonical sale per day ----------------------------------
  if (opts.sales && bundle.sales.length) {
    const [locs, chans] = await Promise.all([getLocations(), getChannels()]);
    const loc = locs[0], ch = chans[0];
    if (!loc || !ch) throw new Error("No active location/channel — set those up first.");
    const existing = await sb.from("sales").select("sale_date").is("voided_at", null);
    if (existing.error) throw existing.error;
    const seen = new Set((existing.data ?? []).map((r) => r.sale_date));
    let done = 0;
    for (const s of bundle.sales) {
      onProgress?.({ phase: "sales", done: ++done, total: bundle.sales.length });
      if (seen.has(s.date)) { report.sales.skipped++; continue; }
      try { await createSale({ date: s.date, total: r2(s.total), locationId: loc.id, channelId: ch.id }); seen.add(s.date); report.sales.created++; }
      catch { report.sales.failed++; }
    }
  }

  // ---- EXPENSES (operating + Stock) ----------------------------------------
  if (opts.expenses && bundle.expenses.length) {
    const locs = await getLocations();
    const loc = locs[0];
    if (!loc) throw new Error("No active location.");
    // existing expense fingerprints to avoid double-imports
    const [exRows, catRows] = await Promise.all([
      sb.from("expenses").select("expense_date,amount,category_id").is("voided_at", null),
      sb.from("expense_categories").select("id,name"),
    ]);
    if (exRows.error) throw exRows.error;
    if (catRows.error) throw catRows.error;
    const catName = new Map((catRows.data ?? []).map((c) => [c.id, (c.name ?? "").toLowerCase()]));
    const fp = (date: string, cat: string, amt: number) => `${date}|${cat.toLowerCase()}|${r2(amt)}`;
    const seen = new Set((exRows.data ?? []).map((e) => fp(e.expense_date, catName.get(e.category_id) ?? "", Number(e.amount))));
    const catCache = new Map<string, string>();
    let done = 0;
    for (const e of bundle.expenses) {
      onProgress?.({ phase: "expenses", done: ++done, total: bundle.expenses.length });
      const key = fp(e.date, e.category, e.amount);
      if (seen.has(key)) { report.expenses.skipped++; continue; }
      try {
        const ck = e.category.toLowerCase();
        let catId = catCache.get(ck);
        if (!catId) {
          // Stock is the goods-cost bucket (not an operating overhead); everything else is operating.
          const isOperating = ck !== STOCK_CATEGORY.toLowerCase();
          catId = await ensureExpenseCategory(e.category, isOperating);
          catCache.set(ck, catId);
        }
        await addExpense({ date: e.date, categoryId: catId, amount: r2(e.amount), paymentMethod: "cash", notes: e.vendor, locationId: loc.id });
        seen.add(key); report.expenses.created++;
      } catch { report.expenses.failed++; }
    }
  }

  // ---- CHEQUES → the cheques table (the ONE canonical cheque store) ---------
  // Never written to money_movements: cash reads treat `cheques` as truth, and
  // a movement copy double-counts the same money (the 2026-07 audit voided 40
  // such duplicates). Each cheque is filed under its month's settlement period.
  if (opts.cheques && bundle.cheques.length) {
    const locs = await getLocations();
    const loc = locs[0];
    if (!loc) throw new Error("No active location.");
    const existing = await sb.from("cheques").select("received_date,amount_received").is("voided_at", null);
    if (existing.error) throw existing.error;
    const fp = (d: string, a: number) => `${d}|${r2(Math.abs(a))}`;
    const seen = new Set((existing.data ?? [])
      .filter((c) => c.received_date && c.amount_received != null)
      .map((c) => fp(c.received_date as string, Number(c.amount_received))));
    const periodCache = new Map<string, string>();
    let done = 0;
    for (const c of bundle.cheques) {
      onProgress?.({ phase: "cheques", done: ++done, total: bundle.cheques.length });
      if (seen.has(fp(c.date, c.amount))) { report.cheques.skipped++; continue; }
      try {
        const monthStart = c.date.slice(0, 8) + "01";
        let periodId = periodCache.get(monthStart);
        if (!periodId) { periodId = await openSettlementPeriod(loc.id, monthStart); periodCache.set(monthStart, periodId); }
        await recordCheque({ periodId, expected: r2(c.amount), received: r2(c.amount), receivedDate: c.date, status: "reconciled", notes: "Mall settlement cheque (history)" });
        seen.add(fp(c.date, c.amount)); report.cheques.created++;
      } catch { report.cheques.failed++; }
    }
  }

  // ---- PRODUCTS → catalog seed with barcodes -------------------------------
  if (opts.products && bundle.products.length) {
    const existing = await sb.from("products").select("name_ar,name_en");
    if (existing.error) throw existing.error;
    const seen = new Set((existing.data ?? []).flatMap((p) => [p.name_ar, p.name_en].filter(Boolean).map((s) => (s as string).trim().toLowerCase())));
    let done = 0;
    for (const p of bundle.products) {
      onProgress?.({ phase: "products", done: ++done, total: bundle.products.length });
      if (seen.has(p.nameAr.toLowerCase())) { report.products.skipped++; continue; }
      try {
        // Bosta Bites sells by weight: seed weight/kg (stock + sale unit = kg,
        // factor 1), NOT count/piece. A few genuinely per-piece items are
        // re-tagged afterwards in the catalog. The name carries "قطعه" for the
        // rare piece items — but that's an owner review call, not an import guess.
        const id = await createProduct({
          nameEn: p.nameAr, nameAr: p.nameAr, unitType: "weight", baseUnit: "kg",
          saleUnit: "kg", sellingPrice: p.avgPrice, lowStock: null, active: true,
        });
        if (p.barcode) { try { await addAlias(id, p.barcode, "barcode", "seed"); } catch { /* alias is best-effort */ } }
        seen.add(p.nameAr.toLowerCase()); report.products.created++;
      } catch { report.products.failed++; }
    }
  }

  return report;
}
