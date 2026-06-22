/** "Ask Bosta" — a deterministic natural-language answerer over the shop's own
 *  numbers. No external AI/API: it matches intent from keywords and answers from
 *  a precomputed context, so it's instant, free, private, and (like the rest of
 *  BostaOS) never invents a number — if data is missing it says so. Pure +
 *  unit-tested; the UI builds the context from the read-models. */
import { egp } from "@/core/utils/format";

export interface BostaContext {
  revenue: { today: number; week: number; month: number; lastMonth: number; all: number };
  profitMonthNet: number | null;
  marginMonth: number | null;
  expensesMonth: number;
  expensesLastMonth: number;
  cash: number | null;
  owed: number;
  rentMonthly: number | null;
  topProduct: { name: string; revenue: number } | null;
  bestDay: { date: string; total: number } | null;
  lowStock: { name: string; onHand: number; unit: string }[];
  // optional signals used by the proactive briefing
  yesterdayRevenue?: number;
  avgDailyMonth?: number;
  soonestStockout?: { name: string; days: number } | null;
  isYesterdayBest?: boolean;
}

export interface BostaAnswer { text: string; route?: string }

/** Proactive briefing — short, ranked, friendly nudges Bosta surfaces without
 *  being asked. Pure: every line is backed by a real number; nothing is shown
 *  when the data doesn't support it. */
export function proactiveInsights(c: BostaContext): { text: string; route?: string }[] {
  const out: { text: string; route?: string }[] = [];
  const y = c.yesterdayRevenue ?? 0;
  if (c.isYesterdayBest && y > 0) out.push({ text: `🎉 Yesterday (${egp(y)}) was your best day this month.`, route: "/sales" });
  if (c.soonestStockout && c.soonestStockout.days < 7) out.push({ text: `⚠️ ${c.soonestStockout.name} runs out in ~${Math.round(c.soonestStockout.days)} day(s) — restock soon.`, route: "/purchases" });
  if (c.revenue.today > 0) {
    const vs = c.avgDailyMonth && c.avgDailyMonth > 0 ? c.revenue.today / c.avgDailyMonth : 1;
    out.push({ text: vs >= 1.3 ? `🔥 ${egp(c.revenue.today)} so far today — well above your daily average.` : `You've sold ${egp(c.revenue.today)} so far today.`, route: "/sales" });
  }
  if (c.revenue.lastMonth > 0) {
    const g = pct(c.revenue.month, c.revenue.lastMonth);
    if (g != null && Math.abs(g) >= 5) out.push({ text: `This month is ${dir(g)} ${Math.abs(Math.round(g))}% vs last month.`, route: "/reports" });
  }
  if (c.cash != null && c.cash < 0) out.push({ text: `Cash balance is negative (${egp(c.cash)}) — review movements.`, route: "/money" });
  if (c.owed > 0) out.push({ text: `You're owed ${egp(c.owed)} from open settlements.`, route: "/cheques" });
  return out.slice(0, 4);
}

export const SUGGESTIONS = [
  "How much did I make today?",
  "What's my profit this month?",
  "Best selling product?",
  "How much cash do I have?",
  "Am I doing better than last month?",
  "What needs restocking?",
];

const has = (q: string, ...words: string[]) => words.some((w) => q.includes(w));
const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
const dir = (n: number) => (n >= 0 ? "up" : "down");

export function askBosta(question: string, c: BostaContext): BostaAnswer {
  const q = " " + question.toLowerCase().trim() + " ";

  // profit
  if (has(q, "profit", "net", "bottom line", "ربح")) {
    if (c.profitMonthNet == null) return { text: "I can't give a profit figure yet — some sold products have no recorded cost. Add a purchase for them and I'll have it.", route: "/missing" };
    const m = c.marginMonth != null ? ` (${Math.round(c.marginMonth)}% margin)` : "";
    return { text: `This month's net profit is ${egp(c.profitMonthNet)}${m}, after cost of goods and expenses.`, route: "/reports" };
  }
  // compare / growth
  if (has(q, "better", "worse", "compare", " vs ", "than last", "growth", "trend")) {
    const g = pct(c.revenue.month, c.revenue.lastMonth);
    if (g == null) return { text: "There's no full previous month to compare to yet — keep recording and I'll show the trend.", route: "/reports" };
    return { text: `Revenue is ${dir(g)} ${Math.abs(Math.round(g))}% vs last month — ${egp(c.revenue.month)} so far vs ${egp(c.revenue.lastMonth)}.`, route: "/reports" };
  }
  // expenses
  if (has(q, "expense", "spend", "spent", "cost", "مصروف")) {
    const g = pct(c.expensesMonth, c.expensesLastMonth);
    const cmp = g == null ? "" : ` — ${dir(g)} ${Math.abs(Math.round(g))}% vs last month`;
    return { text: `You've spent ${egp(c.expensesMonth)} on operating expenses this month${cmp}.`, route: "/expenses" };
  }
  // cash (+ after rent)
  if (has(q, "cash", "drawer", "balance", "كاش")) {
    if (c.cash == null) return { text: "No cash account is set up yet, so I can't read a balance.", route: "/money" };
    if (has(q, "after rent", "minus rent", "rent") && c.rentMonthly != null) {
      return { text: `Cash is ${egp(c.cash)} now; after the ${egp(c.rentMonthly)} monthly rent that's ${egp(c.cash - c.rentMonthly)}.`, route: "/money" };
    }
    return { text: `You have ${egp(c.cash)} in cash right now.`, route: "/money" };
  }
  // owed / payout / settlement
  if (has(q, "owe", "owed", "payout", "settle", "cheque", "receivable")) {
    return c.owed > 0
      ? { text: `You're owed about ${egp(c.owed)} from open settlement periods.`, route: "/cheques" }
      : { text: "Nothing is outstanding — no open settlements expecting money.", route: "/cheques" };
  }
  // best / top product
  if (has(q, "product", "item", "seller", "sell") && has(q, "best", "top", "most", "highest", "biggest")) {
    return c.topProduct
      ? { text: `Your top earner is ${c.topProduct.name} at ${egp(c.topProduct.revenue)} in revenue.`, route: "/reports" }
      : { text: "No product sales are recorded for this period yet.", route: "/reports" };
  }
  // best day
  if (has(q, "best day", "biggest day", "highest day", "top day")) {
    return c.bestDay
      ? { text: `Your best day was ${c.bestDay.date} with ${egp(c.bestDay.total)} in sales.`, route: "/sales" }
      : { text: "No sales days recorded yet.", route: "/sales" };
  }
  // low stock / restock
  if (has(q, "restock", "low stock", "run out", "running out", "out of stock", "reorder")) {
    if (!c.lowStock.length) return { text: "Nothing is low on stock right now.", route: "/stock" };
    const names = c.lowStock.slice(0, 4).map((s) => s.name).join(", ");
    return { text: `${c.lowStock.length} product(s) need attention: ${names}${c.lowStock.length > 4 ? "…" : ""}.`, route: "/missing" };
  }
  // revenue (period) — keep last so "profit/expenses" win first
  if (has(q, "make", "made", "revenue", "sales", "sold", "earn", "money", "بيع", "مبيعات", "كسب")) {
    if (has(q, "today")) return { text: `You've made ${egp(c.revenue.today)} so far today.`, route: "/sales" };
    if (has(q, "week")) return { text: `This week's revenue is ${egp(c.revenue.week)}.`, route: "/sales" };
    if (has(q, "last month")) return { text: `Last month you made ${egp(c.revenue.lastMonth)}.`, route: "/sales" };
    if (has(q, "all", "total", "ever", "lifetime")) return { text: `All-time revenue is ${egp(c.revenue.all)}.`, route: "/reports" };
    return { text: `This month's revenue is ${egp(c.revenue.month)} so far.`, route: "/sales" };
  }

  return { text: "I can answer about revenue, profit, expenses, cash, what you're owed, your best product or day, and what's low on stock. Try one of the suggestions.", route: undefined };
}
