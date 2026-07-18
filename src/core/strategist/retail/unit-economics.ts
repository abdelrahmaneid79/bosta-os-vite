/**
 * TRUE UNIT ECONOMICS + BREAK-EVEN (pure)
 * ---------------------------------------
 * Gross margin (price − cost) is NOT what the owner keeps. At the Gardenia
 * stand three further costs land on every sale before a pound reaches him:
 *
 *   1. the mall's revenue commission (a % of gross sales),
 *   2. packaging — a FLAT cost per pack (clamshell + brand sticker), which is
 *      brutal on cheap lines and trivial on premium nuts,
 *   3. a fixed monthly base (mall rent + salary + accountant) that is paid
 *      whether he sells anything or not.
 *
 * (1) and (2) are variable and belong in per-product margin. (3) is fixed and
 * belongs in break-even. Mixing them is the classic error — it makes cheap,
 * high-turn lines look worse than they are and hides how violently profit
 * swings with revenue.
 *
 * Everything here is pure so it can be unit-tested and reasoned about; the
 * caller supplies the cost model. READ-ONLY maths, no I/O.
 */

/** The costs a location imposes on top of COGS. */
export interface StoreCostModel {
  /** mall commission as a fraction of gross revenue (0.03 = 3%) */
  commissionPct: number;
  /** flat cost of one packed unit: box + label/sticker */
  packagingCostPerPack: number;
  /** fixed monthly cost that must be covered before any profit (rent + opex) */
  fixedMonthly: number;
}

export interface UnitEconomicsInput {
  name: string;
  /** selling price per kg */
  pricePerKg: number | null;
  /** weighted-average cost per kg */
  costPerKg: number | null;
  /** typical packed weight in grams; null = unknown */
  packSizeG: number | null;
}

export interface UnitEconomics {
  name: string;
  /** price of one pack at the typical fill weight; null when pack size unknown */
  ticket: number | null;
  grossMarginPct: number | null;
  /** packaging expressed per kg, so it can be compared against price/kg */
  packagingPerKg: number | null;
  /** packaging as a share of one pack's price — the "packaging tax" */
  packagingPctOfTicket: number | null;
  /** profit per kg after commission AND packaging */
  trueProfitPerKg: number | null;
  /** trueProfitPerKg as a % of price — the number that actually matters */
  trueMarginPct: number | null;
  /** how many margin points commission + packaging removed */
  marginPointsLost: number | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Per-product economics after the mall's cut and the flat packaging cost. */
export function trueEconomics(p: UnitEconomicsInput, m: StoreCostModel): UnitEconomics {
  const { pricePerKg: price, costPerKg: cost, packSizeG } = p;
  const base: UnitEconomics = {
    name: p.name, ticket: null, grossMarginPct: null, packagingPerKg: null,
    packagingPctOfTicket: null, trueProfitPerKg: null, trueMarginPct: null, marginPointsLost: null,
  };
  if (price == null || price <= 0 || cost == null || cost < 0) return base;

  const grossMarginPct = r1(((price - cost) / price) * 100);
  // Without a pack size we cannot convert a per-PACK cost into a per-KG one,
  // so we report gross margin only rather than guess a fill weight.
  if (packSizeG == null || packSizeG <= 0) return { ...base, grossMarginPct };

  const packKg = packSizeG / 1000;
  const packagingPerKg = r2(m.packagingCostPerPack / packKg);
  const ticket = r2(price * packKg);
  const trueProfitPerKg = r2(price * (1 - m.commissionPct) - cost - packagingPerKg);
  const trueMarginPct = r1((trueProfitPerKg / price) * 100);

  return {
    name: p.name,
    ticket,
    grossMarginPct,
    packagingPerKg,
    packagingPctOfTicket: r1((m.packagingCostPerPack / ticket) * 100),
    trueProfitPerKg,
    trueMarginPct,
    marginPointsLost: r1(grossMarginPct - trueMarginPct),
  };
}

export type BreakEvenStatus = "below" | "thin" | "healthy";

export interface BreakEvenResult {
  /** contribution as a % of revenue, after COGS + commission + packaging */
  contributionMarginPct: number;
  contribution: number;
  fixedMonthly: number;
  /** revenue needed just to cover the fixed base */
  breakEvenRevenue: number;
  revenue: number;
  profit: number;
  /** how far above break-even, as a % of break-even. Negative = losing money. */
  marginOfSafetyPct: number;
  status: BreakEvenStatus;
  /** extra profit earned per additional 1,000 EGP of revenue */
  profitPer1000Revenue: number;
}

/**
 * Break-even for a period. `contribution` is revenue − COGS − commission −
 * packaging (i.e. everything variable), already summed by the caller.
 *
 * Why this matters more than margin: with a large fixed base, profit is a
 * small difference between two big numbers, so a modest revenue dip wipes out
 * a disproportionate share of profit. Surfacing margin-of-safety makes that
 * leverage visible before it bites.
 */
export function breakEven(revenue: number, contribution: number, fixedMonthly: number): BreakEvenResult {
  const contributionMarginPct = revenue > 0 ? r1((contribution / revenue) * 100) : 0;
  const cmFraction = revenue > 0 ? contribution / revenue : 0;
  const breakEvenRevenue = cmFraction > 0 ? Math.round(fixedMonthly / cmFraction) : Infinity;
  const profit = Math.round(contribution - fixedMonthly);
  const marginOfSafetyPct = Number.isFinite(breakEvenRevenue) && breakEvenRevenue > 0
    ? r1(((revenue - breakEvenRevenue) / breakEvenRevenue) * 100)
    : 0;

  const status: BreakEvenStatus = profit <= 0 ? "below" : marginOfSafetyPct < 20 ? "thin" : "healthy";

  return {
    contributionMarginPct, contribution: Math.round(contribution), fixedMonthly,
    breakEvenRevenue, revenue: Math.round(revenue), profit, marginOfSafetyPct, status,
    profitPer1000Revenue: Math.round(cmFraction * 1000),
  };
}

/**
 * Revenue required to reach a target profit — the answer to "what do I need to
 * sell to make X?", which is far more actionable than a margin percentage.
 */
export function revenueForProfit(targetProfit: number, contributionMarginPct: number, fixedMonthly: number): number | null {
  const cm = contributionMarginPct / 100;
  if (!(cm > 0)) return null;
  return Math.round((fixedMonthly + targetProfit) / cm);
}

/**
 * Saving from packing the same volume into fewer, larger packs. Packaging is
 * charged per PACK, so the lever is pack count, never the box price.
 */
export function repackSaving(
  kgSold: number, currentPackG: number, targetPackG: number, packagingCostPerPack: number,
): { currentPacks: number; targetPacks: number; packsSaved: number; saving: number } | null {
  if (!(kgSold > 0) || !(currentPackG > 0) || !(targetPackG > 0) || targetPackG <= currentPackG) return null;
  const currentPacks = Math.round((kgSold * 1000) / currentPackG);
  const targetPacks = Math.round((kgSold * 1000) / targetPackG);
  const packsSaved = currentPacks - targetPacks;
  return { currentPacks, targetPacks, packsSaved, saving: Math.round(packsSaved * packagingCostPerPack) };
}

/**
 * Pack weight that lands on a round shelf price — a price a shopper can
 * remember, which random-weight packing makes impossible.
 */
export function packWeightForPrice(pricePerKg: number, targetTicket: number): number | null {
  if (!(pricePerKg > 0) || !(targetTicket > 0)) return null;
  return Math.round((targetTicket / pricePerKg) * 1000);
}
