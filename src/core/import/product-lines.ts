/**
 * PRODUCT-LINE IMPORT (pure)
 * --------------------------
 * Parses a daily product-sales sheet (POS export) into editable, classified
 * sale lines: date · product · quantity · unit price · line total. Column
 * detection, value parsing, in-file dedupe, and classification (ready / unmapped
 * / invalid) all live here and are unit-tested. Product resolution is injected
 * (a closure over the real alias index) so this module stays pure; the screen
 * owns file reading and the writes (ensure sale day → create_sale_item RPC).
 */
import { toIso, toNum, type Row } from "./csv";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
function pick(headers: string[], syns: string[]): string | null {
  for (const s of syns) { const h = headers.find((x) => norm(x) === s); if (h) return h; }
  for (const s of syns) { const h = headers.find((x) => norm(x).includes(s)); if (h) return h; }
  return null;
}

export interface ProductLineMap { date: string; product: string; qty: string; unitPrice: string; lineTotal: string }

export function detectLineMap(headers: string[]): ProductLineMap {
  return {
    date: pick(headers, ["date", "day", "sale date", "تاريخ"]) ?? "",
    product: pick(headers, ["product", "item", "name", "item name", "description", "barcode", "sku", "المنتج", "الصنف", "البيان", "اسم الصنف"]) ?? "",
    qty: pick(headers, ["qty", "quantity", "units", "count", "weight", "الكمية", "العدد", "كمية"]) ?? "",
    unitPrice: pick(headers, ["unit price", "price", "rate", "السعر", "سعر"]) ?? "",
    lineTotal: pick(headers, ["line total", "total", "amount", "value", "net", "القيمة", "الاجمالي", "اجمالي", "المبيعات"]) ?? "",
  };
}

export interface ParsedProductLine {
  date: string | null; rawName: string;
  qty: number | null; unitPrice: number | null; lineTotal: number | null;
  issues: string[];
}

export function parseProductLines(rows: Row[], map: ProductLineMap): ParsedProductLine[] {
  return rows.map((r) => {
    const date = toIso(map.date ? r[map.date] : "");
    const rawName = ((map.product ? r[map.product] : "") || "").toString().trim();
    const qty = toNum(map.qty ? r[map.qty] : "");
    const unitPrice = toNum(map.unitPrice ? r[map.unitPrice] : "");
    let lineTotal = toNum(map.lineTotal ? r[map.lineTotal] : "");
    if (lineTotal == null && qty != null && unitPrice != null) lineTotal = Math.round(qty * unitPrice * 100) / 100;
    const issues: string[] = [];
    if (!date) issues.push("no date");
    if (!rawName) issues.push("no product");
    if (qty == null || qty <= 0) issues.push("no quantity");
    if (lineTotal == null || lineTotal <= 0) issues.push("no amount");
    return { date, rawName, qty, unitPrice, lineTotal, issues };
  });
}

/** Drop exact duplicate rows within the same file (date|name|qty|total). */
export function dedupeLines(lines: ParsedProductLine[]): { kept: ParsedProductLine[]; dropped: number } {
  const seen = new Set<string>();
  const kept: ParsedProductLine[] = [];
  let dropped = 0;
  for (const l of lines) {
    const key = `${l.date}|${norm(l.rawName)}|${l.qty}|${l.lineTotal}`;
    if (seen.has(key)) { dropped += 1; continue; }
    seen.add(key); kept.push(l);
  }
  return { kept, dropped };
}

export type LineStatus = "ready" | "unmapped" | "invalid";
export interface ClassifiedLine extends ParsedProductLine {
  productId: string | null; matchedName: string | null; status: LineStatus;
}

export type Resolver = (rawName: string) => { id: string; name: string } | null;

export function classifyLines(lines: ParsedProductLine[], resolve: Resolver): ClassifiedLine[] {
  return lines.map((l) => {
    if (l.issues.length) return { ...l, productId: null, matchedName: null, status: "invalid" };
    const hit = resolve(l.rawName);
    if (!hit) return { ...l, productId: null, matchedName: null, status: "unmapped" };
    return { ...l, productId: hit.id, matchedName: hit.name, status: "ready" };
  });
}

export interface ImportSummary { ready: number; unmapped: number; invalid: number; days: number }
export function summarize(lines: ClassifiedLine[]): ImportSummary {
  const days = new Set(lines.filter((l) => l.date).map((l) => l.date)).size;
  return {
    ready: lines.filter((l) => l.status === "ready").length,
    unmapped: lines.filter((l) => l.status === "unmapped").length,
    invalid: lines.filter((l) => l.status === "invalid").length,
    days,
  };
}
