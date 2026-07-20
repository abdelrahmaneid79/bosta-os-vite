/** Live product margin — one definition everywhere.
 *
 *  Buy price prefers the ledger's weighted avg_cost (it moves with every
 *  purchase); reference_cost is the fallback for products bought before
 *  purchase tracking. Margin is gross on price: (sell − buy) / sell.
 *
 *  Tiers match how the owner already reads his products (his strong lines sit
 *  at 30–40%): ≥35 strong · 22–35 healthy · 12–22 thin · <12 weak. Colour is
 *  never the only signal — every tier ships with its word.
 */
export function buyPrice(avgCost: number | null | undefined, referenceCost: number | null | undefined): number | null {
  const avg = Number(avgCost ?? 0), ref = Number(referenceCost ?? 0);
  if (avg > 0) return avg;
  if (ref > 0) return ref;
  return null;
}

export function productMargin(sellingPrice: number | null | undefined, avgCost?: number | null, referenceCost?: number | null): number | null {
  const sell = Number(sellingPrice ?? 0);
  const buy = buyPrice(avgCost, referenceCost);
  if (sell <= 0 || buy == null) return null;
  return ((sell - buy) / sell) * 100;
}

export type MarginTier = "good" | "ok" | "warn" | "bad";

export function marginTier(m: number): MarginTier {
  return m >= 35 ? "good" : m >= 22 ? "ok" : m >= 12 ? "warn" : "bad";
}

export const TIER_WORD: Record<MarginTier, string> = {
  good: "strong", ok: "healthy", warn: "thin", bad: "weak",
};
