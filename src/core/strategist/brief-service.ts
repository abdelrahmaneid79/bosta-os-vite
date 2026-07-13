/** Daily-brief assembler — Layer 2 orchestration (Cycle 9). Maps the snapshot,
 *  strategy report and canonical exceptions into the pure brief input, reading
 *  the most recent trading day's figures directly. */
import { requireEngine } from "@/core/db/engine";
import { composeDailyBrief, type BriefInput, type DailyBrief } from "./analysis/brief";
import type { StrategistSnapshot } from "./contract";
import type { StrategyReport } from "./analysis/report";
import type { ReconciledException } from "./analysis/exceptions";

async function lastDaySummary(date: string | null): Promise<BriefInput["lastDay"]> {
  if (!date) return null;
  const sb = requireEngine();
  const [salesRes, expRes] = await Promise.all([
    sb.from("sales").select("id,total_amount,verification").is("voided_at", null).eq("sale_date", date),
    sb.from("expenses").select("amount").is("voided_at", null).eq("expense_date", date),
  ]);
  const sales = salesRes.data ?? [];
  if (!sales.length) return null;
  const revenue = sales.reduce((s, r) => s + Number(r.total_amount), 0);
  const expenses = (expRes.data ?? []).reduce((s, r) => s + Number(r.amount), 0);

  // top product + cost coverage for the day
  const saleIds = sales.map((s) => s.id);
  let topProduct: string | null = null;
  let grossProfit: number | null = null;
  let covered = true;
  if (saleIds.length) {
    const items = await sb.from("sale_items")
      .select("product_id,quantity,line_total,cogs_at_sale,products(name_en)")
      .is("voided_at", null).in("sale_id", saleIds);
    const rows = (items.data ?? []) as { product_id: string | null; quantity: number; line_total: number; cogs_at_sale: number | null; products: { name_en: string } | null }[];
    let best = -1;
    let gp = 0;
    for (const r of rows) {
      if (r.product_id && Number(r.quantity) > best) { best = Number(r.quantity); topProduct = r.products?.name_en ?? null; }
      if (r.cogs_at_sale == null) covered = false;
      else gp += Number(r.line_total) - Number(r.cogs_at_sale);
    }
    grossProfit = covered && rows.length ? Math.round(gp) : null;
  }
  return { date, revenue: Math.round(revenue), expenses: Math.round(expenses), grossProfit, grossProfitCovered: covered, topProduct };
}

async function lastDayCloseStatus(date: string | null): Promise<BriefInput["lastDayClose"]> {
  if (!date) return "open";
  const { data } = await requireEngine().from("daily_closes")
    .select("status").is("voided_at", null).eq("close_date", date).maybeSingle();
  const s = data?.status;
  if (s === "complete" || s === "estimated" || s === "partial" || s === "no_trading" || s === "reopened") return s;
  return "open";
}

export async function assembleDailyBrief(
  s: StrategistSnapshot, report: StrategyReport, exceptions: ReconciledException[],
): Promise<DailyBrief> {
  const [lastDay, lastDayClose] = await Promise.all([
    lastDaySummary(s.meta.lastDataDate).catch(() => null),
    lastDayCloseStatus(s.meta.lastDataDate).catch(() => "open" as const),
  ]);

  const critical = exceptions.filter((e) => e.severity === "critical").length;
  const high = exceptions.filter((e) => e.severity === "high").length;
  const top = exceptions[0] ? { title: exceptions[0].title, screenLink: exceptions[0].screenLink } : null;

  // what the owner must record today, from activation + freshness
  const required: string[] = [];
  if (s.meta.isStale) required.push("enter or import recent sales");
  const cashStep = report.activation.steps.find((x) => x.key === "first_cash");
  if (cashStep && cashStep.status !== "done") required.push("count the drawer (opening baseline)");
  const stockStep = report.activation.steps.find((x) => x.key === "first_stock");
  if (stockStep && stockStep.status !== "done") required.push("count stock (opening baseline)");

  const urgent = report.executive.mostUrgentAction;
  const primaryAction = urgent ? { title: urgent.title, action: urgent.action, screenLink: urgent.screenLink } : null;
  const secondaryActions = report.findings
    .filter((f) => f.action && f.id !== report.executive.mostUrgentAction?.findingId)
    .slice(0, 3)
    .map((f) => ({ title: f.action!.title, screenLink: f.action!.screenLink }));

  const input: BriefInput = {
    today: s.meta.today,
    lastDataDate: s.meta.lastDataDate,
    staleDays: s.meta.staleDays,
    isStale: s.meta.isStale,
    lastDay,
    lastDayClose,
    cashReconciled: s.cash.hasLiveData ? (s.cash.unexplainedDifference.value ?? 0) === 0 : null,
    cashConfidence: report.liveHealth.cashConfidence,
    inventoryConfidence: report.liveHealth.inventoryConfidence,
    financialConfidence: report.liveHealth.financialConfidence,
    nextChequeEta: s.cheques.nextChequeEta.value,
    overdueCheques: s.cheques.overduePeriods.value ?? [],
    obligationsNext7: report.obligations.next7,
    requiredRecordsToday: required,
    exceptions: { critical, high, total: exceptions.length, top },
    primaryAction,
    secondaryActions,
    missing: report.missingData.flatMap((g) => g.items.map((it) => it.title)).slice(0, 5),
    readiness: report.activation.readiness,
  };
  return composeDailyBrief(input);
}
