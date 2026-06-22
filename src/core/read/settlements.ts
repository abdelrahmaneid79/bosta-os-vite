/** Settlement + cheque read-model. net_expected = accumulated_revenue −
 *  total_deductions (verified engine caches). READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
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
