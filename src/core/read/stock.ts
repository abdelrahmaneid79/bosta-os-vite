/** Stock read-model. Mirrors the verified engine's caches (current_stock,
 *  avg_cost) — never recomputed here, only displayed. READ-ONLY. */
import { getProducts } from "./common";

export interface StockPosition {
  id: string;
  nameEn: string;
  nameAr: string | null;
  marketCode: string | null; // owner-facing 4-digit code
  vendor: string | null;     // supplier the product is bought from
  baseUnit: string;
  saleUnit: string | null;
  onHand: number;        // base units (current_stock cache)
  avgCost: number;       // per base unit (WAC cache)
  sellingPrice: number | null;
  stockValue: number;    // onHand * avgCost
  hasCost: boolean;      // avg_cost > 0 (missing-COGS flag)
  isLow: boolean;        // <= low_stock_threshold when set
  isNegative: boolean;
  active: boolean;
}

export interface StockSummary {
  positions: StockPosition[];
  totalValue: number;
  lowCount: number;
  missingCostCount: number;
  negativeCount: number;
}

export async function getStockSummary(): Promise<StockSummary> {
  const products = await getProducts();
  const positions: StockPosition[] = products.map((p) => {
    const onHand = p.current_stock;
    const avgCost = p.avg_cost;
    const hasCost = avgCost > 0;
    const isLow = p.low_stock_threshold != null && onHand <= p.low_stock_threshold;
    return {
      id: p.id,
      nameEn: p.name_en,
      nameAr: p.name_ar,
      marketCode: p.market_code,
      vendor: p.vendor,
      baseUnit: p.base_unit,
      saleUnit: p.sale_unit,
      onHand,
      avgCost,
      sellingPrice: p.selling_price,
      stockValue: onHand * avgCost,
      hasCost,
      isLow,
      isNegative: onHand < 0,
      active: p.active,
    };
  });
  positions.sort((a, b) => b.stockValue - a.stockValue);
  return {
    positions,
    totalValue: positions.reduce((s, p) => s + p.stockValue, 0),
    lowCount: positions.filter((p) => p.isLow && p.active).length,
    missingCostCount: positions.filter((p) => p.onHand > 0 && !p.hasCost).length,
    negativeCount: positions.filter((p) => p.isNegative).length,
  };
}
