/** Settlement + cheque read-model. net_expected = accumulated_revenue −
 *  total_deductions (verified engine caches). READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import { todayCairo } from "@/core/time";
import { buildChequeCycle, type ChequeCycle } from "@/core/settlement/cheque-cycle";
import type { Tables } from "@/core/db/tables";

/** The real cheque flow: each cheque cross-referenced to the sales it settled
 *  (coverage window), the open tab since the last cheque, and the pre-record
 *  cash era. READ-ONLY. */
export async function getChequeCycle(): Promise<ChequeCycle> {
  const sb = requireEngine();
  const today = todayCairo();
  const [chq, sales] = await Promise.all([
    sb.from("cheques").select("id,received_date,amount_received").is("voided_at", null),
    sb.from("sales").select("sale_date,total_amount").is("voided_at", null),
  ]);
  if (chq.error) throw chq.error;
  if (sales.error) throw sales.error;
  const cheques = (chq.data ?? [])
    .filter((c) => c.received_date && c.amount_received != null)
    .map((c) => ({ id: c.id, date: c.received_date as string, amount: Number(c.amount_received) }));
  const daily = (sales.data ?? []).map((s) => ({ date: s.sale_date, total: Number(s.total_amount) }));
  return buildChequeCycle(cheques, daily, today);
}

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

/** Monthly settlement statement: the trigger-maintained period cache broken into
 *  its stored deduction rows (flat rent + 3% charge + any other) and matched to
 *  its received cheque(s). Every figure is read straight from the DB — revenue,
 *  net_expected and the deduction amounts are cached engine values; `difference`
 *  is a DISPLAY delta of two stored numbers (cheque received − net expected).
 *  Nothing is recomputed. READ-ONLY. */
export interface SettlementStatement {
  id: string; month: string; end: string | null;
  revenue: number; rent: number; charge: number; other: number; netExpected: number;
  chequeReceived: number | null; chequeCount: number; difference: number | null;
  status: Tables<"settlement_periods">["status"];
  chequeStatus: Tables<"cheques">["status"] | null;
}
export async function getSettlementStatements(): Promise<SettlementStatement[]> {
  const sb = requireEngine();
  const [periods, deds, chqs] = await Promise.all([
    sb.from("settlement_periods").select("id,start_date,end_date,accumulated_revenue,net_expected,status")
      .is("voided_at", null).order("start_date", { ascending: false }),
    sb.from("settlement_deductions").select("settlement_period_id,deduction_type,amount").is("voided_at", null),
    sb.from("cheques").select("settlement_period_id,amount_received,status").is("voided_at", null).not("received_date", "is", null),
  ]);
  if (periods.error) throw periods.error;
  if (deds.error) throw deds.error;
  if (chqs.error) throw chqs.error;

  const ded = new Map<string, { rent: number; charge: number; other: number }>();
  for (const d of deds.data ?? []) {
    const e = ded.get(d.settlement_period_id) ?? { rent: 0, charge: 0, other: 0 };
    if (d.deduction_type === "rent") e.rent += Number(d.amount);
    else if (d.deduction_type === "revenue_charge") e.charge += Number(d.amount);
    else e.other += Number(d.amount);
    ded.set(d.settlement_period_id, e);
  }
  const chq = new Map<string, { received: number; count: number; status: Tables<"cheques">["status"] }>();
  for (const c of chqs.data ?? []) {
    if (c.amount_received == null) continue;
    const e = chq.get(c.settlement_period_id) ?? { received: 0, count: 0, status: c.status };
    e.received += Number(c.amount_received); e.count += 1; e.status = c.status;
    chq.set(c.settlement_period_id, e);
  }

  return (periods.data ?? []).map((p) => {
    const d = ded.get(p.id) ?? { rent: 0, charge: 0, other: 0 };
    const c = chq.get(p.id);
    return {
      id: p.id, month: p.start_date, end: p.end_date,
      revenue: p.accumulated_revenue, rent: d.rent, charge: d.charge, other: d.other,
      netExpected: p.net_expected,
      chequeReceived: c ? Math.round(c.received * 100) / 100 : null,
      chequeCount: c?.count ?? 0,
      difference: c ? Math.round((c.received - p.net_expected) * 100) / 100 : null,
      status: p.status, chequeStatus: c?.status ?? null,
    };
  });
}
