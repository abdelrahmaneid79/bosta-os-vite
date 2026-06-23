/**
 * PRODUCT RECOMMENDED ACTION (pure)
 * ---------------------------------
 * Turns a product's operational signals (stock, cost, days-of-cover, lifetime
 * rank) into a single clear next action. Priority order: data-integrity issues
 * first (negative stock, missing cost), then availability (out/low), then
 * commercial signals (star vs slow mover). Deterministic + unit-tested.
 */
export interface ProductSignals {
  onHand: number;
  isNegative: boolean;
  hasCost: boolean;
  daysCover: number | null;     // estimated days of stock left, when known
  lifetimeRank: number | null;  // 1 = top seller by lifetime revenue
  lifetimeCount: number;        // total ranked products
  active: boolean;
}
export type AdviceTone = "critical" | "warn" | "good" | "info";
export interface Recommendation { tone: AdviceTone; title: string; detail: string }

const COVER_DAYS = 7;
const STAR_TOP = 10;

export function recommendProductAction(s: ProductSignals): Recommendation {
  if (s.isNegative)
    return { tone: "critical", title: "Record the missing purchase", detail: "On-hand is negative — a sale was booked against stock that was never purchased, so stock value and COGS are wrong." };
  if (s.onHand > 0 && !s.hasCost)
    return { tone: "warn", title: "Add a purchase to set cost", detail: "This product has stock but no recorded cost, so its gross profit can't be calculated." };
  if (s.onHand <= 0)
    return { tone: s.active ? "warn" : "info", title: s.active ? "Out of stock — restock" : "Out of stock (inactive)", detail: s.active ? "It can't be sold until you record a purchase." : "Inactive product with no stock — reactivate and restock if you'll sell it again." };
  if (s.daysCover != null && s.daysCover < COVER_DAYS)
    return { tone: "warn", title: "Low cover — restock soon", detail: `At the recent sales rate, only about ${Math.round(s.daysCover)} day(s) of stock remain.` };

  const isStar = s.lifetimeRank != null && s.lifetimeRank <= STAR_TOP;
  const isSlow = s.lifetimeRank != null && s.lifetimeCount >= 20 && s.lifetimeRank > s.lifetimeCount - 10;
  if (isStar)
    return { tone: "good", title: "Top seller — keep it well stocked", detail: `Ranks #${s.lifetimeRank} by lifetime revenue. Never let this one run out.` };
  if (isSlow)
    return { tone: "info", title: "Slow mover — review", detail: `Near the bottom of lifetime revenue (#${s.lifetimeRank} of ${s.lifetimeCount}). Consider delisting or promoting it.` };
  return { tone: "good", title: "Healthy", detail: "Stock, cost and demand all look fine for this product." };
}
