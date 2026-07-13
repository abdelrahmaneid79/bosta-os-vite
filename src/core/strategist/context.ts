/** Business context for the strategist — owner targets & preferences.
 *
 *  Owner answers live in app_settings key `strategist_context_v2`. Anything
 *  unanswered falls back to the DOCUMENTED DEFAULTS below (asked in the
 *  grouped owner questions, 2026-07-13). Each metric's `basis` says which:
 *  "fact" = owner-provided · "estimated" = default assumption. */
import { requireEngine } from "@/core/db/engine";
import { metric, type BusinessContext, type Metric } from "./contract";

export interface OwnerContextAnswers {
  monthlyRevenueTarget?: number;
  monthlyProfitTarget?: number;
  grossMarginFloorPct?: number;
  cashReserveFloor?: number;
  withdrawalRule?: string;
  strategicProducts?: string[];
  productsToGrow?: string[];
  stockoutToleranceDays?: number;
  maxStockCoverDays?: number;
  deadStockDays?: number;
  reviewPeriodDays?: number;
  maxChequeAgeDays?: number;
  priorityFocus?: "growth" | "cash_preservation" | "balanced";
  reserveType?: "fixed" | "days_of_costs" | "higher_of_both";
  cashCountFreshnessDays?: number;
  downsideSalesPct?: number;
  allowExpectedCashForOptional?: boolean;
  /** field → ISO date the owner confirmed it (Tune stamps this) */
  confirmedAt?: Record<string, string>;
  aggressiveness?: "conservative" | "balanced" | "aggressive";
  allowPriceRecommendations?: boolean;
  challengeOwner?: boolean;
  briefingCadence?: string;
  upcomingEvents?: { name: string; date: string; note: string }[];
  knownConstraints?: string[];
}

const SRC_OWNER = "app_settings.strategist_context_v2 (owner answer)";
const SRC_DEFAULT = "documented default (owner has not answered yet)";
const LINK = "/health";

/** The defaults, exactly as stated in the grouped owner questions. */
export const CONTEXT_DEFAULTS = {
  monthlyRevenueTarget: null as number | null, // default: beat trailing-3-month average (computed, not fixed)
  monthlyProfitTarget: null as number | null,  // same basis as revenue target
  grossMarginFloorPct: 25,
  cashReserveFloor: 25_000,                    // ≈ 1 month of rent + operating expenses
  withdrawalRule: "flag withdrawals above 50% of that month's net profit",
  strategicProducts: [] as string[],
  productsToGrow: [] as string[],
  stockoutToleranceDays: 7,
  maxStockCoverDays: 45,                       // beyond this, stock is "excessive" for perishable-adjacent goods
  deadStockDays: 30,                           // no sale in this many trading days → dormant
  reviewPeriodDays: 14,                        // recommendation outcome review window
  maxChequeAgeDays: 45,                        // settlement older than this is overdue
  priorityFocus: "balanced" as const,
  reserveType: "higher_of_both" as const,      // reserve = max(fixed floor, N days of operating costs)
  cashCountFreshnessDays: 7,                   // a drawer count older than this is stale
  downsideSalesPct: -25,                       // downside scenario: sales this much below run-rate
  allowExpectedCashForOptional: false,         // optional spends must fit VERIFIED cash by default
  aggressiveness: "balanced" as const,
  allowPriceRecommendations: true,
  challengeOwner: true,
  briefingCadence: "daily brief + weekly review",
  upcomingEvents: [] as { name: string; date: string; note: string }[],
  knownConstraints: [] as string[],
};

/** PURE merge: owner answers override defaults; provenance recorded per field. */
export function composeContext(answers: OwnerContextAnswers | null, period: string): BusinessContext {
  const a = answers ?? {};
  function pick<T>(owner: T | undefined, fallback: T, note?: string): Metric<T> {
    return owner !== undefined
      ? metric(owner, SRC_OWNER, period, LINK)
      : metric(fallback, SRC_DEFAULT, period, LINK, { basis: "estimated", confidence: "medium", ...(note ? { note } : {}) });
  }
  // Targets default to "beat the trailing-3-month average" — a rule, not a
  // fixed number, so the default value is null with the rule in the note.
  const targetDefault = (note: string): Metric<number> => ({
    value: null, source: SRC_DEFAULT, period, basis: "estimated", confidence: "medium",
    completeness: null, screenLink: LINK, note,
  });
  return {
    monthlyRevenueTarget: a.monthlyRevenueTarget !== undefined
      ? metric(a.monthlyRevenueTarget, SRC_OWNER, period, LINK)
      : targetDefault("default: beat the trailing-3-month average revenue"),
    monthlyProfitTarget: a.monthlyProfitTarget !== undefined
      ? metric(a.monthlyProfitTarget, SRC_OWNER, period, LINK)
      : targetDefault("default: beat the trailing-3-month average net profit"),
    grossMarginFloorPct: pick(a.grossMarginFloorPct, CONTEXT_DEFAULTS.grossMarginFloorPct),
    cashReserveFloor: pick(a.cashReserveFloor, CONTEXT_DEFAULTS.cashReserveFloor, "≈ one month of rent + operating expenses"),
    withdrawalRule: pick(a.withdrawalRule, CONTEXT_DEFAULTS.withdrawalRule),
    strategicProducts: pick(a.strategicProducts, CONTEXT_DEFAULTS.strategicProducts),
    productsToGrow: pick(a.productsToGrow, CONTEXT_DEFAULTS.productsToGrow),
    stockoutToleranceDays: pick(a.stockoutToleranceDays, CONTEXT_DEFAULTS.stockoutToleranceDays),
    maxStockCoverDays: pick(a.maxStockCoverDays, CONTEXT_DEFAULTS.maxStockCoverDays),
    deadStockDays: pick(a.deadStockDays, CONTEXT_DEFAULTS.deadStockDays),
    reviewPeriodDays: pick(a.reviewPeriodDays, CONTEXT_DEFAULTS.reviewPeriodDays),
    maxChequeAgeDays: pick(a.maxChequeAgeDays, CONTEXT_DEFAULTS.maxChequeAgeDays),
    priorityFocus: pick<"growth" | "cash_preservation" | "balanced">(a.priorityFocus, CONTEXT_DEFAULTS.priorityFocus),
    reserveType: pick<"fixed" | "days_of_costs" | "higher_of_both">(a.reserveType, CONTEXT_DEFAULTS.reserveType),
    cashCountFreshnessDays: pick(a.cashCountFreshnessDays, CONTEXT_DEFAULTS.cashCountFreshnessDays),
    downsideSalesPct: pick(a.downsideSalesPct, CONTEXT_DEFAULTS.downsideSalesPct),
    allowExpectedCashForOptional: pick(a.allowExpectedCashForOptional, CONTEXT_DEFAULTS.allowExpectedCashForOptional),
    aggressiveness: pick<"conservative" | "balanced" | "aggressive">(a.aggressiveness, CONTEXT_DEFAULTS.aggressiveness),
    allowPriceRecommendations: pick(a.allowPriceRecommendations, CONTEXT_DEFAULTS.allowPriceRecommendations),
    challengeOwner: pick(a.challengeOwner, CONTEXT_DEFAULTS.challengeOwner),
    briefingCadence: pick(a.briefingCadence, CONTEXT_DEFAULTS.briefingCadence),
    upcomingEvents: pick(a.upcomingEvents, CONTEXT_DEFAULTS.upcomingEvents),
    knownConstraints: pick(a.knownConstraints, CONTEXT_DEFAULTS.knownConstraints),
  };
}

export async function loadOwnerContext(): Promise<OwnerContextAnswers | null> {
  const { data } = await requireEngine()
    .from("app_settings").select("value").eq("key", "strategist_context_v2").maybeSingle();
  return (data?.value as OwnerContextAnswers | null) ?? null;
}

export async function saveOwnerContext(answers: OwnerContextAnswers): Promise<void> {
  const { error } = await requireEngine()
    .from("app_settings")
    .upsert({ key: "strategist_context_v2", value: answers as never }, { onConflict: "key" });
  if (error) throw error;
}
