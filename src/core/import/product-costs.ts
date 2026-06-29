/**
 * PRODUCT-COST IMPORT (pure)
 * --------------------------
 * Reads a product-portfolio file (CSV/Excel) of cost price + selling price per
 * product and prepares editable, matched updates. Columns are auto-detected
 * (Arabic + English), products resolve by BARCODE first (most reliable) then by
 * name. The provided cost is treated as the real finished-good unit cost
 * ("verified") — it sets products.reference_cost (drives per-sale COGS) and the
 * lifetime margin source. All parsing/classification is pure + unit-tested; the
 * screen owns file reading + the writes.
 */
import { toNum, type Row } from "./csv";
import { normalize } from "@/core/products/match";

function pick(headers: string[], syns: string[]): string {
  const ns = syns.map(normalize);
  for (const s of ns) { const h = headers.find((x) => normalize(x) === s); if (h) return h; }
  for (const s of ns) { const h = headers.find((x) => normalize(x).includes(s)); if (h) return h; }
  return "";
}

export interface CostMap { barcode: string; name: string; cost: string; price: string }
export function detectCostMap(headers: string[]): CostMap {
  return {
    barcode: pick(headers, ["الباركود", "باركود", "barcode", "ean", "sku", "كود الصنف", "الكود", "code"]),
    name: pick(headers, ["اسم الصنف", "الصنف", "المنتج", "name", "product", "item", "البيان", "description"]),
    cost: pick(headers, ["سعر التكلفة", "التكلفة", "تكلفة", "سعر الشراء", "الشراء", "cost price", "unit cost", "cost", "buy", "purchase price"]),
    price: pick(headers, ["سعر البيع", "البيع", "السعر", "selling price", "sale price", "sell price", "price", "retail"]),
  };
}

export interface ParsedCost { barcode: string; name: string; cost: number | null; price: number | null; issues: string[] }
export function parseCosts(rows: Row[], map: CostMap): ParsedCost[] {
  return rows.map((r) => {
    const barcode = ((map.barcode ? r[map.barcode] : "") || "").toString().trim();
    const name = ((map.name ? r[map.name] : "") || "").toString().trim();
    const cost = toNum(map.cost ? r[map.cost] : "");
    const price = toNum(map.price ? r[map.price] : "");
    const issues: string[] = [];
    if (!barcode && !name) issues.push("no product");
    if (cost == null && price == null) issues.push("no cost or price");
    if (cost != null && cost < 0) issues.push("negative cost");
    if (price != null && price < 0) issues.push("negative price");
    return { barcode, name, cost, price, issues };
  });
}

export type CostStatus = "ready" | "unmapped" | "invalid";
export interface ClassifiedCost extends ParsedCost {
  productId: string | null; matchedName: string | null; status: CostStatus;
}
export type CostResolver = (name: string, barcode: string) => { id: string; name: string } | null;
export function classifyCosts(lines: ParsedCost[], resolve: CostResolver): ClassifiedCost[] {
  return lines.map((l) => {
    if (l.issues.length) return { ...l, productId: null, matchedName: null, status: "invalid" };
    const hit = resolve(l.name, l.barcode);
    if (!hit) return { ...l, productId: null, matchedName: null, status: "unmapped" };
    return { ...l, productId: hit.id, matchedName: hit.name, status: "ready" };
  });
}

export interface CostSummary { ready: number; unmapped: number; invalid: number; withCost: number; withPrice: number }
export function summarizeCosts(lines: ClassifiedCost[]): CostSummary {
  const ready = lines.filter((l) => l.status === "ready");
  return {
    ready: ready.length,
    unmapped: lines.filter((l) => l.status === "unmapped").length,
    invalid: lines.filter((l) => l.status === "invalid").length,
    withCost: ready.filter((l) => l.cost != null).length,
    withPrice: ready.filter((l) => l.price != null).length,
  };
}
