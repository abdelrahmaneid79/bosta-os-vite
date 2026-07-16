/**
 * CATALOG INTEGRITY CHECK (pure, unit-tested).
 * --------------------------------------------
 * Revenue reconciliation (Σ net_value = printed branch total) proves the money,
 * but NOT the per-line quantity — and quantity drives inventory deduction and
 * COGS. A line can hit the right value with the wrong qty (qty 2 × price 50 =
 * qty 1 × price 100). So once a line is matched to a product we cross-check its
 * implied unit price (value ÷ qty) against the product's known catalog selling
 * price: a large disagreement means the qty (weight) is probably mis-read and
 * would corrupt stock. We surface a suggested weight (value ÷ catalog price),
 * never overwrite silently.
 */
export interface CatalogCheck {
  suggestedQty: number | null;   // value ÷ catalog price — a weight anchored on reliable fields
  suggestedPrice: number | null; // catalog price, to fill a missing OCR price
  priceOff: boolean;             // OCR price disagrees with catalog price
  qtyRisk: boolean;              // implied price is far from catalog → qty likely wrong (inventory risk)
  warnings: string[];
}

const rel = (a: number, b: number) => { const m = Math.max(Math.abs(a), Math.abs(b)); return m === 0 ? 0 : Math.abs(a - b) / m; };
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function checkAgainstCatalog(
  line: { qty: number | null; price: number | null; value: number | null },
  catalogPrice: number | null,
  tol = 0.15,
): CatalogCheck {
  const out: CatalogCheck = { suggestedQty: null, suggestedPrice: null, priceOff: false, qtyRisk: false, warnings: [] };
  if (catalogPrice == null || catalogPrice <= 0) return out;

  if (line.value != null && line.value > 0) out.suggestedQty = r3(line.value / catalogPrice);
  if (line.price == null) out.suggestedPrice = r2(catalogPrice);
  else if (rel(line.price, catalogPrice) > tol) { out.priceOff = true; out.warnings.push(`price ${r2(line.price)} vs catalog ${r2(catalogPrice)}/unit`); }

  // implied unit price from the (reliable) value and the (shaky) qty
  if (line.qty != null && line.qty > 0 && line.value != null) {
    const implied = line.value / line.qty;
    if (rel(implied, catalogPrice) > tol) {
      out.qtyRisk = true;
      out.warnings.push(`weight looks off — value ÷ qty = ${r2(implied)}/unit but catalog is ${r2(catalogPrice)}/unit (affects stock)`);
    }
  }
  return out;
}
