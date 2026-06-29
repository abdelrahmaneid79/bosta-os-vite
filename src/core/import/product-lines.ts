/**
 * PRODUCT-LINE IMPORT (pure)
 * --------------------------
 * Reads a daily POS product-sales export (Arabic, RTL) into editable, classified
 * sale lines. Built for the real Bosta Bites report shape:
 *   - metadata rows on top (branch, period "من YYYY/MM/DD الى ...", print date),
 *   - a header row (كود الصنف · الباركود · اسم الصنف · متوسط سعر البيع ·
 *     الكمية المباعة · المبيعات · ... · صافى الكمية · صافى القيمة),
 *   - product rows, then totals rows (اجمالي المورد / اجمالي الفرع).
 * There is NO per-row date — the whole file is ONE day (sniffed from the header,
 * owner-confirmable). Products resolve by BARCODE first (exact, most reliable),
 * then by Arabic/English name. All parsing/classification is pure + unit-tested;
 * the screen owns file reading and the writes (create_sale_item RPC).
 */
import { toIso, toNum, type Row } from "./csv";
import { normalize } from "@/core/products/match";

/** Match a header against synonyms, Arabic-folded both sides (ى/ي, ة/ه, …). */
function pick(headers: string[], syns: string[]): string | null {
  const ns = syns.map(normalize);
  for (const s of ns) { const h = headers.find((x) => normalize(x) === s); if (h) return h; }
  for (const s of ns) { const h = headers.find((x) => normalize(x).includes(s)); if (h) return h; }
  return null;
}

export interface ProductLineMap { date: string; barcode: string; product: string; qty: string; unitPrice: string; lineTotal: string }

export function detectLineMap(headers: string[]): ProductLineMap {
  return {
    date: pick(headers, ["date", "day", "sale date", "تاريخ"]) ?? "",
    barcode: pick(headers, ["الباركود", "باركود", "barcode", "ean", "sku", "كود الصنف", "الكود"]) ?? "",
    product: pick(headers, ["اسم الصنف", "الصنف", "المنتج", "البيان", "name", "item name", "item", "product", "description"]) ?? "",
    // net columns preferred over gross (returns already deducted)
    qty: pick(headers, ["صافى الكمية", "صافي الكميه", "net qty", "الكمية المباعة", "الكمية", "كمية", "qty", "quantity", "units", "count", "weight", "العدد"]) ?? "",
    unitPrice: pick(headers, ["متوسط سعر البيع", "سعر البيع", "السعر", "سعر", "unit price", "price", "rate", "avg price"]) ?? "",
    lineTotal: pick(headers, ["صافى القيمة", "صافي القيمه", "net value", "المبيعات", "القيمة", "القيمه", "line total", "value", "total", "amount", "الاجمالي", "اجمالي", "net"]) ?? "",
  };
}

/** All ISO dates inside a free-text cell (handles "الفترة من 2024/12/03 الى …"). */
function datesIn(s: string): string[] {
  const out: string[] = [];
  const re = /(\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2})|(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/g;
  for (const m of s.matchAll(re)) { const iso = toIso(m[0]); if (iso) out.push(iso); }
  return out;
}

const HEADER_HINTS = ["باركود", "barcode", "اسم الصنف", "الصنف", "المبيعات", "القيمه", "الكميه", "سعر", "sku", "product", "item", "name"].map(normalize);

export interface SmartSheet { rows: Row[]; headers: string[]; date: string | null }

/** Turn a raw 2-D sheet (array of arrays from CSV/Excel) into header-keyed rows:
 *  finds the real header row (most column hints), drops metadata/blank rows, and
 *  sniffs the report's day from the metadata above the header (earliest date —
 *  the trading period precedes the print date). Plain CSVs with headers on row 0
 *  pass through unchanged. */
export function parseSheet(rows2d: unknown[][]): SmartSheet {
  const cell = (v: unknown) => (v == null ? "" : String(v));
  let headerIdx = 0, best = -1;
  for (let i = 0; i < Math.min(rows2d.length, 40); i++) {
    const cells = (rows2d[i] ?? []).map((c) => normalize(cell(c)));
    const score = cells.filter((c) => c && HEADER_HINTS.some((h) => c === h || c.includes(h))).length;
    if (score > best) { best = score; headerIdx = i; }
  }
  // de-duplicate header labels so repeated POS columns stay addressable
  const seen = new Map<string, number>();
  const headers = (rows2d[headerIdx] ?? []).map((c, i) => {
    const base = cell(c).trim() || `col${i}`;
    const n = seen.get(base) ?? 0; seen.set(base, n + 1);
    return n ? `${base}#${n}` : base;
  });
  const rows: Row[] = [];
  for (let i = headerIdx + 1; i < rows2d.length; i++) {
    const r = rows2d[i] ?? [];
    if (r.every((c) => cell(c).trim() === "")) continue;
    const obj: Row = {};
    headers.forEach((h, idx) => { obj[h] = cell(r[idx]); });
    rows.push(obj);
  }
  const dates: string[] = [];
  for (let i = 0; i < headerIdx; i++) for (const c of rows2d[i] ?? []) dates.push(...datesIn(cell(c)));
  dates.sort();
  return { rows, headers, date: dates[0] ?? null };
}

export interface ParsedProductLine {
  date: string | null; barcode: string; rawName: string;
  qty: number | null; unitPrice: number | null; lineTotal: number | null;
  issues: string[];
}

const TOTAL_ROW = /اجمالي|اجمالى|الاجمالي|total/i;

/** Build classified-ready lines. `fallbackDate` (the file's single day) fills the
 *  date when there's no per-row date column. Line total prefers the report's net
 *  value column; only computed from qty×price when that's missing. */
export function parseProductLines(rows: Row[], map: ProductLineMap, fallbackDate?: string): ParsedProductLine[] {
  return rows.map((r) => {
    const date = (map.date ? toIso(r[map.date]) : null) ?? (fallbackDate || null);
    const barcode = ((map.barcode ? r[map.barcode] : "") || "").toString().trim();
    const rawName = ((map.product ? r[map.product] : "") || "").toString().trim();
    const qty = toNum(map.qty ? r[map.qty] : "");
    const unitPrice = toNum(map.unitPrice ? r[map.unitPrice] : "");
    let lineTotal = toNum(map.lineTotal ? r[map.lineTotal] : "");
    if (lineTotal == null && qty != null && unitPrice != null) lineTotal = Math.round(qty * unitPrice * 100) / 100;
    const issues: string[] = [];
    if (TOTAL_ROW.test(rawName) && !barcode) issues.push("totals row");
    else {
      if (!date) issues.push("no date");
      if (!rawName && !barcode) issues.push("no product");
      if (qty == null || qty <= 0) issues.push("no quantity");
      if (lineTotal == null || lineTotal <= 0) issues.push("no amount");
    }
    return { date, barcode, rawName, qty, unitPrice, lineTotal, issues };
  });
}

/** Drop exact duplicate rows within the same file. */
export function dedupeLines(lines: ParsedProductLine[]): { kept: ParsedProductLine[]; dropped: number } {
  const seen = new Set<string>();
  const kept: ParsedProductLine[] = [];
  let dropped = 0;
  for (const l of lines) {
    const key = `${l.date}|${l.barcode || normalize(l.rawName)}|${l.qty}|${l.lineTotal}`;
    if (seen.has(key)) { dropped += 1; continue; }
    seen.add(key); kept.push(l);
  }
  return { kept, dropped };
}

export type LineStatus = "ready" | "unmapped" | "invalid";
export interface ClassifiedLine extends ParsedProductLine {
  productId: string | null; matchedName: string | null; status: LineStatus;
}

/** Resolve a line to a product: barcode first (most reliable), then name. */
export type Resolver = (rawName: string, barcode: string) => { id: string; name: string } | null;

export function classifyLines(lines: ParsedProductLine[], resolve: Resolver): ClassifiedLine[] {
  return lines.map((l) => {
    if (l.issues.length) return { ...l, productId: null, matchedName: null, status: "invalid" };
    const hit = resolve(l.rawName, l.barcode);
    if (!hit) return { ...l, productId: null, matchedName: null, status: "unmapped" };
    return { ...l, productId: hit.id, matchedName: hit.name, status: "ready" };
  });
}

export interface ImportSummary { ready: number; unmapped: number; invalid: number; days: number; total: number }
export function summarize(lines: ClassifiedLine[]): ImportSummary {
  const days = new Set(lines.filter((l) => l.date).map((l) => l.date)).size;
  return {
    ready: lines.filter((l) => l.status === "ready").length,
    unmapped: lines.filter((l) => l.status === "unmapped").length,
    invalid: lines.filter((l) => l.status === "invalid").length,
    days,
    total: Math.round(lines.filter((l) => l.status === "ready").reduce((s, l) => s + (l.lineTotal ?? 0), 0) * 100) / 100,
  };
}
