/** Settlement + cheque read-model. net_expected = accumulated_revenue −
 *  total_deductions (verified engine caches). READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import { todayCairo } from "@/core/time";
import { composeSettlement, type SettlementView, type DeductionLite } from "@/core/settlement/logic";
import type { Tables } from "@/core/db/tables";

export interface SettlementPeriod {
  id: string; start: string; end: string | null;
  revenue: number; deductions: number; netExpected: number;
  status: Tables<"settlement_periods">["status"];
}
export async function getSettlementPeriods(): Promise<SettlementPeriod[]> {
  const { data, error } = await requireEngine()
    .from("settlement_periods")
    .select("id,start_date,end_date,accumulated_revenue,total_deductions,net_expected,status")
    .is("voided_at", null).order("start_date", { ascending: false });
  if (error) throw error;
  return data.map((p) => ({
    id: p.id, start: p.start_date, end: p.end_date,
    revenue: p.accumulated_revenue, deductions: p.total_deductions,
    netExpected: p.net_expected, status: p.status,
  }));
}

/** Last calendar day of the month containing `iso` (for periods with no end). */
function monthEnd(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

export interface SettlementDetail extends SettlementView {
  id: string; start: string; end: string | null;
  periodStatus: Tables<"settlement_periods">["status"];
  cheques: ChequeView[];
}

/** One period's full reconciliation: revenue − deductions = expected vs cheques. */
export async function getSettlementDetail(periodId: string): Promise<SettlementDetail | null> {
  const sb = requireEngine();
  const today = todayCairo();
  const [periodRes, dedRes, chqRes] = await Promise.all([
    sb.from("settlement_periods").select("id,start_date,end_date,accumulated_revenue,total_deductions,net_expected,status").eq("id", periodId).is("voided_at", null).maybeSingle(),
    sb.from("settlement_deductions").select("deduction_type,amount,rate").eq("settlement_period_id", periodId).is("voided_at", null),
    sb.from("cheques").select("id,settlement_period_id,received_date,expected_amount,amount_received,difference,status").eq("settlement_period_id", periodId).is("voided_at", null).order("received_date", { ascending: true, nullsFirst: false }),
  ]);
  if (periodRes.error) throw periodRes.error;
  if (!periodRes.data) return null;
  if (dedRes.error) throw dedRes.error;
  if (chqRes.error) throw chqRes.error;
  const p = periodRes.data;
  const deductions: DeductionLite[] = (dedRes.data ?? []).map((d) => ({ type: d.deduction_type, amount: Number(d.amount), rate: d.rate == null ? null : Number(d.rate) }));
  const cheques: ChequeView[] = (chqRes.data ?? []).map((c) => ({ id: c.id, periodId: c.settlement_period_id, receivedDate: c.received_date, expected: c.expected_amount, received: c.amount_received, difference: c.difference, status: c.status }));
  const view = composeSettlement({
    revenue: Number(p.accumulated_revenue), deductions, netExpected: Number(p.net_expected),
    cheques: cheques.map((c) => ({ id: c.id, received: c.received, expected: c.expected, date: c.receivedDate, status: c.status })),
    periodEnd: p.end_date ?? monthEnd(p.start_date), today,
  });
  return { ...view, id: p.id, start: p.start_date, end: p.end_date, periodStatus: p.status, cheques };
}

export interface SettlementOverviewRow { id: string; start: string; end: string | null; view: SettlementView }

/** All periods with their reconciliation view — for the Cheques list + overdue alerts. */
export async function getSettlementOverview(): Promise<SettlementOverviewRow[]> {
  const sb = requireEngine();
  const today = todayCairo();
  const [periods, deds, chqs] = await Promise.all([
    sb.from("settlement_periods").select("id,start_date,end_date,accumulated_revenue,net_expected,status").is("voided_at", null).order("start_date", { ascending: false }),
    sb.from("settlement_deductions").select("settlement_period_id,deduction_type,amount,rate").is("voided_at", null),
    sb.from("cheques").select("settlement_period_id,expected_amount,amount_received,received_date,status").is("voided_at", null),
  ]);
  if (periods.error) throw periods.error;
  if (deds.error) throw deds.error;
  if (chqs.error) throw chqs.error;
  const dByP = new Map<string, DeductionLite[]>();
  for (const d of deds.data ?? []) { const a = dByP.get(d.settlement_period_id) ?? []; a.push({ type: d.deduction_type, amount: Number(d.amount), rate: d.rate == null ? null : Number(d.rate) }); dByP.set(d.settlement_period_id, a); }
  const cByP = new Map<string, { id: string; received: number | null; expected: number; date: string | null; status: string }[]>();
  for (const c of chqs.data ?? []) { const a = cByP.get(c.settlement_period_id) ?? []; a.push({ id: "", received: c.amount_received, expected: c.expected_amount, date: c.received_date, status: c.status }); cByP.set(c.settlement_period_id, a); }
  return (periods.data ?? []).map((p) => ({
    id: p.id, start: p.start_date, end: p.end_date,
    view: composeSettlement({
      revenue: Number(p.accumulated_revenue), deductions: dByP.get(p.id) ?? [], netExpected: Number(p.net_expected),
      cheques: cByP.get(p.id) ?? [], periodEnd: p.end_date ?? monthEnd(p.start_date), today,
    }),
  }));
}

export interface ChequeView {
  id: string; periodId: string; receivedDate: string | null;
  expected: number; received: number | null; difference: number | null;
  status: Tables<"cheques">["status"];
}
export async function getCheques(): Promise<ChequeView[]> {
  const { data, error } = await requireEngine()
    .from("cheques")
    .select("id,settlement_period_id,received_date,expected_amount,amount_received,difference,status")
    .is("voided_at", null).order("received_date", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data.map((c) => ({
    id: c.id, periodId: c.settlement_period_id, receivedDate: c.received_date,
    expected: c.expected_amount, received: c.amount_received, difference: c.difference, status: c.status,
  }));
}
