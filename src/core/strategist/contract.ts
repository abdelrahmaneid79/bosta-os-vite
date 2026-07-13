/** Strategist Snapshot v2 — the ONE authoritative fact base the AI consumes.
 *
 *  Rules this file enforces by construction:
 *  - Every metric carries value + source + period + basis + confidence +
 *    completeness + screenLink. A missing number is basis:"missing" with
 *    value:null — NEVER silently zero.
 *  - All values come from the audited read layer (src/core/read/*). The LLM
 *    never queries tables or recomputes financial logic.
 *  - Cash, profit, revenue, settlements and withdrawals are separate blocks
 *    and must never be conflated downstream. */

export type Basis = "fact" | "calculated" | "estimated" | "forecast" | "missing";
export type Confidence = "high" | "medium" | "low" | "none";

export interface Metric<T = number> {
  value: T | null;
  /** Read-model origin, e.g. "read/profit.getProfitReadout" */
  source: string;
  /** Human period label, e.g. "2026-05-01→2026-05-31" or "all-time" */
  period: string;
  basis: Basis;
  confidence: Confidence;
  /** 0–100 where meaningful (e.g. % of revenue with product detail), else null */
  completeness: number | null;
  /** App route where the owner can inspect this number */
  screenLink: string;
  note?: string;
}

/** Constructor for a known value. */
export function metric<T>(
  value: T,
  source: string,
  period: string,
  screenLink: string,
  opts: { basis?: Basis; confidence?: Confidence; completeness?: number | null; note?: string } = {},
): Metric<T> {
  return {
    value,
    source,
    period,
    basis: opts.basis ?? "fact",
    confidence: opts.confidence ?? "high",
    completeness: opts.completeness ?? null,
    screenLink,
    ...(opts.note ? { note: opts.note } : {}),
  };
}

/** Constructor for an UNKNOWN value — explicit, never zero. */
export function missing<T = number>(source: string, period: string, screenLink: string, note: string): Metric<T> {
  return { value: null, source, period, basis: "missing", confidence: "none", completeness: 0, screenLink, note };
}

export interface DayPoint { date: string; total: number }
export interface NamedValue { name: string; value: number }

export interface LiveOpsConfig {
  /** the official live-operations start date; null until owner-confirmed */
  startDate: string | null;
  confirmedAt: string | null;
  basis: "confirmed" | "proposed" | "unset";
  reason: string | null;
  /** the most recent daily-close date, if any */
  lastCloseDate: string | null;
}

export interface SnapshotMeta {
  generatedAt: string;        // ISO timestamp
  businessClock: "Africa/Cairo";
  today: string;              // Cairo date
  period: { from: string; to: string; label: string };
  comparePeriod: { from: string; to: string; label: string };
  lastDataDate: string | null;   // latest sale date in the books
  staleDays: number | null;      // today − lastDataDate
  isStale: boolean;              // staleDays > 3
  completenessScore: number;     // 0–100 blended data-completeness
  liveOps: LiveOpsConfig;
}

export interface RevenueBlock {
  periodRevenue: Metric;
  priorRevenue: Metric;
  changePct: Metric;
  rolling7Avg: Metric;
  rolling30Avg: Metric;
  bestDays: Metric<DayPoint[]>;
  weakestDays: Metric<DayPoint[]>;
  dayOfWeekPattern: Metric<NamedValue[]>;
  monthlySeries: Metric<NamedValue[]>;      // seasonality view (label YYYY-MM)
  unusualDays: Metric<DayPoint[]>;          // > 2.5σ from period mean
}

export interface ProfitBlock {
  revenue: Metric;
  coveredRevenue: Metric;
  uncoveredRevenue: Metric;    // unknown-COGS exposure — the honesty metric
  knownCogs: Metric;
  grossProfit: Metric;         // null unless coverage complete
  operatingExpenses: Metric;
  netProfit: Metric;
  grossMarginPct: Metric;      // on covered revenue only
  netMarginPct: Metric;
  priorGrossMarginPct: Metric;
  monthlyProfitSeries: Metric<{ month: string; revenue: number; knownCogs: number; uncovered: number; opex: number }[]>;
}

export interface ProductEntry {
  name: string;
  revenue: number;
  units: number;
  grossProfit: number | null;
  marginPct: number | null;
  missingCost: boolean;
}
/** Full per-product period record — the contribution/classification input.
 *  daysSold uses sale-line count (lines are per-day-per-product aggregates
 *  from the POS daily reports, so lines ≈ trading days with a sale). */
export interface ProductPeriodEntry extends ProductEntry {
  cogs: number;
  daysSold: number;
}
/** Live per-product position: list price, weighted cost, stock. */
export interface ProductPositionEntry {
  name: string;
  sellingPrice: number | null;
  avgCost: number;      // 0 = unknown (WAC never established)
  hasCost: boolean;
  onHand: number;
  isLow: boolean;
  vendor: string | null;
}
export interface ProductsBlock {
  coveragePct: Metric;
  /** full current-period product detail (all mapped products, uncapped) */
  detail: Metric<ProductPeriodEntry[]>;
  /** full comparison-period product detail */
  compareDetail: Metric<ProductPeriodEntry[]>;
  /** trading days in the period / comparison period (frequency denominators) */
  periodDays: Metric;
  comparePeriodDays: Metric;
  /** live positions (price/cost/stock) for active products */
  positions: Metric<ProductPositionEntry[]>;                       // % of period revenue with product lines
  topRevenue: Metric<ProductEntry[]>;
  topGrossProfit: Metric<ProductEntry[]>;
  highestMargin: Metric<ProductEntry[]>;
  fastestGrowing: Metric<(ProductEntry & { changePct: number })[]>;
  fastestDeclining: Metric<(ProductEntry & { changePct: number })[]>;
  highVolumeLowMargin: Metric<ProductEntry[]>;
  lowVolumeHighMargin: Metric<ProductEntry[]>;
  missingCosts: Metric<string[]>;            // product names lacking reference cost
  stockRisk: Metric<{ name: string; daysCover: number | null; onHand: number }[]>;
}

export interface InventoryBlock {
  trackedProducts: Metric;
  stockValue: Metric;
  negativeStock: Metric;
  lowStock: Metric;
  hasLiveData: boolean;        // false today: no counts, no purchases recorded
  lastPhysicalCount: Metric<string>;
}

export interface ExpensesBlock {
  operatingTotal: Metric;
  priorOperatingTotal: Metric;
  categories: Metric<(NamedValue & { priorValue: number; changePct: number | null })[]>;
  spikes: Metric<(NamedValue & { changePct: number })[]>;
  /** categories seen in BOTH recent periods — the recurring cash obligations */
  recurringMonthly: Metric<{ name: string; avgMonthly: number; isOperating: boolean }[]>;
  withdrawals: Metric;         // SEPARATE — never inside operatingTotal
}

export interface CashBlock {
  expectedBalance: Metric;     // ledger-derived position
  latestCount: Metric;         // last physical count amount
  unexplainedDifference: Metric;
  inflows: Metric;
  outflows: Metric;
  withdrawals: Metric;
  injections: Metric;
  lastCountDate: Metric<string>;
  /** days since the latest count; null = never counted */
  countAgeDays: Metric;
  hasLiveData: boolean;        // false today: no live movements/counts
}

export interface ChequesBlock {
  totalReceived: Metric;
  openTabGross: Metric;        // sales since last cheque, pre-deduction
  openTabEstimatedNet: Metric;
  blendedDeductionPct: Metric;
  overduePeriods: Metric<string[]>;
  unmatchedCheques: Metric;
  averageDelayDays: Metric;
  lastChequeDate: Metric<string>;
  /** median days between consecutive cheques — the settlement rhythm */
  interChequeGapDays: Metric;
  /** deterministic ETA for the next cheque (last cheque + gap) */
  nextChequeEta: Metric<string>;
  /** rent is DEDUCTED FROM THE CHEQUE by the mall — never a cash outflow */
  monthlyRentDeduction: Metric;
}

export interface DataQualityIssue { issue: string; affectedEgp: number | null; screenLink: string }
export interface DataQualityBlock {
  issues: DataQualityIssue[];
  missingCostLines: Metric;
  uncoveredRevenueAllTime: Metric;
  lineCoverageWindow: Metric<string>;   // e.g. "2024-11-01→2025-06-30"
  unknownProductCodes: Metric<string[]>;
  missingOwnerInputs: string[];
}

/** Owner targets & preferences. Every field has a documented default in
 *  context.ts; `source` says whether it's an owner answer or a default. */
export interface BusinessContext {
  monthlyRevenueTarget: Metric;
  monthlyProfitTarget: Metric;
  grossMarginFloorPct: Metric;
  cashReserveFloor: Metric;
  withdrawalRule: Metric<string>;
  strategicProducts: Metric<string[]>;
  productsToGrow: Metric<string[]>;
  stockoutToleranceDays: Metric;
  maxStockCoverDays: Metric;
  deadStockDays: Metric;
  reviewPeriodDays: Metric;
  maxChequeAgeDays: Metric;
  priorityFocus: Metric<"growth" | "cash_preservation" | "balanced">;
  reserveType: Metric<"fixed" | "days_of_costs" | "higher_of_both">;
  cashCountFreshnessDays: Metric;
  downsideSalesPct: Metric;
  allowExpectedCashForOptional: Metric<boolean>;
  aggressiveness: Metric<"conservative" | "balanced" | "aggressive">;
  allowPriceRecommendations: Metric<boolean>;
  challengeOwner: Metric<boolean>;
  briefingCadence: Metric<string>;
  upcomingEvents: Metric<{ name: string; date: string; note: string }[]>;
  knownConstraints: Metric<string[]>;
}

export interface StrategistSnapshot {
  meta: SnapshotMeta;
  revenue: RevenueBlock;
  profit: ProfitBlock;
  products: ProductsBlock;
  inventory: InventoryBlock;
  expenses: ExpensesBlock;
  cash: CashBlock;
  cheques: ChequesBlock;
  dataQuality: DataQualityBlock;
  context: BusinessContext;
}
