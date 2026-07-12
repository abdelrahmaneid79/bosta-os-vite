/** Risk & intelligence engine — turns live read-model data into actionable
 *  insights. Every builder is PURE (no I/O) so it's deterministically unit-
 *  tested even while Supabase egress is blocked. Each insight states the data
 *  it uses, why it matters, and a fix path; confidence is explicit so we never
 *  fake certainty when history is thin.
 *
 *  Generic operational constants only (a week of cover, percent tolerances) —
 *  never hardcoded business figures (rent, prices, balances). */

export type Severity = "critical" | "warning" | "info";
/** high = derived from complete facts · estimate = projection from limited
 *  history · low-data = not enough data to judge (shown, never scored). */
export type Confidence = "high" | "estimate" | "low-data";

export interface Insight {
  key: string;
  severity: Severity;
  title: string;
  detail: string;   // what the signal is + why it matters
  action: string;   // the concrete fix path
  route: string;
  confidence: Confidence;
  metric?: string;  // the number behind it, when there is one
}

const SEV_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
export function sortInsights(xs: Insight[]): Insight[] {
  return [...xs].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}

/** Generic, non-financial constants. */
export const COVER_DAYS = 7;        // "a week of stock left" — operational, not a business figure
export const MIN_OBSERVED_DAYS = 7; // need ≥1 week of history before projecting velocity

// ── Stock risk ────────────────────────────────────────────────────────────────
export interface StockPositionLite {
  id: string; nameEn: string; baseUnit: string; onHand: number;
  isNegative: boolean; isLow: boolean; hasCost: boolean; active: boolean;
}
export interface Velocity { unitsPerDay: number; daysObserved: number }

/** Uses: current_stock, low_stock_threshold, and recent sales velocity
 *  (units sold/day from non-voided sale lines). Why: running out stops sales;
 *  negative stock means a purchase wasn't recorded so COGS/stock value is wrong.
 *  Days-of-cover is an estimate (projection) and only shown with ≥1wk history. */
export function buildStockInsights(
  positions: StockPositionLite[],
  velocity: Map<string, Velocity>,
): Insight[] {
  const out: Insight[] = [];
  for (const p of positions) {
    if (!p.active) continue;
    if (p.isNegative) {
      out.push({ key: `stock-neg-${p.id}`, severity: "critical", confidence: "high",
        title: `${p.nameEn} is at negative stock`,
        detail: "On-hand is below zero — a purchase was sold against but never recorded, so stock value and COGS are understated.",
        action: "Record the missing purchase on Purchases to correct on-hand and cost.",
        route: "/purchases", metric: `${p.onHand} ${p.baseUnit}` });
      continue;
    }
    if (p.onHand <= 0) {
      out.push({ key: `stock-out-${p.id}`, severity: "warning", confidence: "high",
        title: `${p.nameEn} is out of stock`,
        detail: "On-hand is zero — it can't be sold until restocked.",
        action: "Add a purchase on Purchases to restock.", route: "/purchases" });
      continue;
    }
    const v = velocity.get(p.id);
    if (v && v.unitsPerDay > 0 && v.daysObserved >= MIN_OBSERVED_DAYS) {
      const cover = p.onHand / v.unitsPerDay;
      if (cover < COVER_DAYS) {
        out.push({ key: `stock-cover-${p.id}`, severity: "warning", confidence: "estimate",
          title: `${p.nameEn}: ≈${Math.round(cover)} day${Math.round(cover) === 1 ? "" : "s"} of stock left`,
          detail: `At the recent rate of ${round1(v.unitsPerDay)} ${p.baseUnit}/day, current stock runs out in under a week. Estimate from the last ${v.daysObserved} days of sales.`,
          action: "Plan a restock purchase before it sells out.", route: "/purchases",
          metric: `${round1(p.onHand)} ${p.baseUnit} left` });
        continue;
      }
    } else if (p.isLow) {
      // No reliable velocity, but owner-set low-stock threshold tripped.
      out.push({ key: `stock-low-${p.id}`, severity: "warning", confidence: "high",
        title: `${p.nameEn} is below its low-stock level`,
        detail: "On-hand has fallen to or below the threshold you set for this product.",
        action: "Restock on Purchases, or adjust the threshold in the product if it's too high.",
        route: "/purchases", metric: `${round1(p.onHand)} ${p.baseUnit}` });
    }
  }
  return out;
}

// ── Cash risk ─────────────────────────────────────────────────────────────────
export interface CashFacts {
  balance: number | null;     // current ledger balance
  inflow: number;             // Σ positive movements in range
  outflow: number;            // Σ negative movements (negative number)
  withdrawals: number;        // |personal withdrawals| in range
  hasEverCounted: boolean;    // any cash_count recorded?
}

/** Uses: money_accounts balance + signed movements over the period. Why: a
 *  negative balance means the ledger is impossible (a movement is missing or
 *  wrong); drawing more than the business earned shrinks working capital.
 *  Withdrawals are cash, never expenses. */
export function buildCashInsights(c: CashFacts): Insight[] {
  const out: Insight[] = [];
  if (c.balance != null && c.balance < 0) {
    out.push({ key: "cash-negative", severity: "critical", confidence: "high",
      title: "Cash balance is negative",
      detail: "The ledger shows less than zero cash, which isn't physically possible — a movement is missing, doubled, or mis-signed.",
      action: "Count cash to reset to reality, then review recent movements.",
      route: "/money", metric: fmt(c.balance) });
  }
  const netOperating = c.inflow + c.outflow + c.withdrawals; // outflow is negative, withdrawals add back the cash-out we re-examine
  if (c.withdrawals > 0 && c.withdrawals > c.inflow) {
    out.push({ key: "cash-withdrawals", severity: "warning", confidence: "high",
      title: "Withdrawals exceeded money coming in",
      detail: "You took out more personal cash this period than the business brought in. This isn't an expense, but it draws down working capital.",
      action: "Review withdrawals on Cash and pace them against inflow.",
      route: "/money", metric: `${fmt(c.withdrawals)} out vs ${fmt(c.inflow)} in` });
  } else if (netOperating < 0 && c.inflow > 0) {
    out.push({ key: "cash-burn", severity: "info", confidence: "high",
      title: "Cash went down this period",
      detail: "More cash left than came in over this range. Worth watching if it continues.",
      action: "Check movements on Cash to see what drove the outflow.", route: "/money" });
  }
  if (!c.hasEverCounted && c.balance != null) {
    out.push({ key: "cash-uncounted", severity: "info", confidence: "low-data",
      title: "Cash has never been counted",
      detail: "The balance is purely from recorded movements and hasn't been checked against physical cash, so it may have drifted.",
      action: "Count cash on Cash to anchor the ledger to reality.", route: "/money" });
  }
  return out;
}

// ── Settlement / cheque intelligence ──────────────────────────────────────────
export interface PeriodLite { id: string; start: string; netExpected: number; status: string; hasCheque: boolean }
export interface ChequeLite { id: string; expected: number; received: number | null; difference: number | null; status: string }

/** Uses: settlement periods (net_expected, status) and cheques (expected vs
 *  received). Why: money expected but no cheque recorded is unbilled income;
 *  a received cheque that differs from expected beyond tolerance means you were
 *  under/over-paid. tolerance(expected) is injected (same rule as sales recon). */
export function buildSettlementInsights(
  periods: PeriodLite[], cheques: ChequeLite[], tolerance: (expected: number) => number,
): Insight[] {
  const out: Insight[] = [];
  for (const p of periods) {
    if (p.status !== "reconciled" && p.netExpected > 0 && !p.hasCheque) {
      out.push({ key: `settle-nocheque-${p.id}`, severity: "warning", confidence: "high",
        title: "Settlement money expected, no cheque recorded",
        detail: `An open period (since ${p.start}) expects ${fmt(p.netExpected)} but has no cheque logged yet — that income isn't tracked.`,
        action: "Record the cheque on Cheques when it arrives.", route: "/cheques",
        metric: fmt(p.netExpected) });
    }
  }
  for (const c of cheques) {
    if (c.received == null) continue;
    const diff = c.difference ?? c.received - c.expected;
    if (Math.abs(diff) > tolerance(c.expected)) {
      out.push({ key: `settle-diff-${c.id}`, severity: "warning", confidence: "high",
        title: diff < 0 ? "Cheque came in under expected" : "Cheque came in over expected",
        detail: `Received ${fmt(c.received)} against ${fmt(c.expected)} expected — a ${fmt(Math.abs(diff))} ${diff < 0 ? "shortfall" : "surplus"} beyond tolerance.`,
        action: "Reconcile on Cheques and check the deduction breakdown with the payer.",
        route: "/cheques", metric: `${diff < 0 ? "−" : "+"}${fmt(Math.abs(diff))}` });
    }
  }
  return out;
}

// ── Month-over-month trend (only when history supports it) ─────────────────────
export interface TrendFacts {
  thisRevenue: number; lastRevenue: number;
  thisExpenses: number; lastExpenses: number;
}
/** Uses: this month vs last month revenue/expenses. Why: direction of travel
 *  matters more than a single number. Honest: if last month has no data we say
 *  so (low-data) instead of inventing a percentage. */
export function buildTrendInsights(t: TrendFacts): Insight[] {
  const out: Insight[] = [];
  if (t.lastRevenue <= 0) {
    out.push({ key: "trend-rev-nodata", severity: "info", confidence: "low-data",
      title: "Not enough history to compare revenue",
      detail: "Last month has no recorded revenue, so a month-over-month trend can't be computed yet.",
      action: "Keep recording daily sales — a comparison appears next month.", route: "/sales" });
  } else {
    const chg = ((t.thisRevenue - t.lastRevenue) / t.lastRevenue) * 100;
    out.push({ key: "trend-rev", severity: "info", confidence: "high",
      title: chg >= 0 ? `Revenue up ${round1(chg)}% vs last month` : `Revenue down ${round1(Math.abs(chg))}% vs last month`,
      detail: `This month ${fmt(t.thisRevenue)} vs ${fmt(t.lastRevenue)} last month (month-to-date).`,
      action: chg >= 0 ? "Keep doing what's working." : "Review slow products and recent days on Sales.",
      route: "/sales", metric: `${chg >= 0 ? "▲ +" : "▼ −"}${round1(Math.abs(chg))}%` });
  }
  if (t.lastExpenses > 0 && t.thisExpenses > t.lastExpenses) {
    const chg = ((t.thisExpenses - t.lastExpenses) / t.lastExpenses) * 100;
    out.push({ key: "trend-exp", severity: "info", confidence: "high",
      title: `Expenses up ${round1(chg)}% vs last month`,
      detail: `Operating expenses are ${fmt(t.thisExpenses)} vs ${fmt(t.lastExpenses)} last month. Rising costs eat into net profit.`,
      action: "Check the expense breakdown on Reports.", route: "/reports",
      metric: `▲ +${round1(chg)}%` });
  }
  return out;
}

// ── small local formatters (no app deps, keeps this module pure & portable) ────
function round1(n: number): number { return Math.round(n * 10) / 10; }
function fmt(n: number): string {
  return new Intl.NumberFormat("en-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 0 }).format(n);
}
