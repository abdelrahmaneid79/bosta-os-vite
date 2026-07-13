/** Daily-close fact assembler — IO (Cycle 9). Derives the close checklist from
 *  records so the owner attests only to what BostaOS cannot read. READ-ONLY.
 *
 *  The cash/cheque/inventory/action signals that require the full snapshot are
 *  passed in (composed by the caller from the strategy report) so this stays a
 *  thin, per-date DB read. The pure engine (analysis/daily-close.ts) turns
 *  these facts into an evaluation. */
import { requireEngine } from "@/core/db/engine";
import type { DailyCloseFacts } from "@/core/strategist/analysis/daily-close";

/** The parts of the close picture that come from the strategy report, not from
 *  a single day's rows. */
export interface CloseSignals {
  cashCountRequired: boolean;
  cashDifferenceUnresolved: boolean;
  chequeNeedsUpdate: boolean;
  inventoryAlertsToAck: number;
  criticalActionsOpen: number;
}

const maxTs = (rows: { updated_at?: string | null; created_at?: string | null }[]): string | null => {
  let m: string | null = null;
  for (const r of rows) {
    const t = r.updated_at ?? r.created_at ?? null;
    if (t && (!m || t > m)) m = t;
  }
  return m;
};

export async function assembleCloseFacts(date: string, signals: CloseSignals): Promise<DailyCloseFacts> {
  const sb = requireEngine();

  const [salesRes, expRes, purRes, impRes, closeRes] = await Promise.all([
    sb.from("sales").select("id,total_amount,verification,reconciled,updated_at,created_at").is("voided_at", null).eq("sale_date", date),
    sb.from("expenses").select("id,updated_at,created_at").is("voided_at", null).eq("expense_date", date),
    sb.from("purchase_batches").select("id,updated_at,created_at").is("voided_at", null).eq("purchase_date", date),
    sb.from("imports").select("id", { count: "exact", head: true }).is("voided_at", null).eq("status", "previewed"),
    sb.from("daily_closes").select("status").is("voided_at", null).eq("close_date", date).maybeSingle(),
  ]);
  for (const r of [salesRes, expRes, purRes] as const) if (r.error) throw r.error;

  const sales = salesRes.data ?? [];
  const salesRecorded = sales.length > 0;
  const saleIds = sales.map((s) => s.id);

  // sale items for the day's sales — unmapped + missing-cogs + presence
  let unmappedLines = 0, missingCogsLines = 0, linesPresent = false;
  let itemTs: string | null = null;
  if (saleIds.length) {
    const items = await sb.from("sale_items").select("product_id,cogs_at_sale,updated_at,created_at").is("voided_at", null).in("sale_id", saleIds);
    if (items.error) throw items.error;
    const rows = items.data ?? [];
    linesPresent = rows.length > 0;
    unmappedLines = rows.filter((r) => r.product_id == null).length;
    missingCogsLines = rows.filter((r) => r.product_id != null && r.cogs_at_sale == null).length;
    itemTs = maxTs(rows);
  }

  // verification of the day's sales — worst-case wins
  const verOrder = ["verified", "partially_verified", "unverified", "estimated"] as const;
  let salesVerification: DailyCloseFacts["salesVerification"] = "none";
  if (salesRecorded) {
    let worst = 0;
    for (const s of sales) {
      const idx = verOrder.indexOf((s.verification as typeof verOrder[number]) ?? "verified");
      if (idx > worst) worst = idx;
    }
    salesVerification = verOrder[worst];
  }

  const productLinesReconcile = !linesPresent ? null : sales.every((s) => s.reconciled !== false);
  const markedNoTrading = closeRes.data?.status === "no_trading";
  void itemTs; // (used only via closeSourceDataAt below)

  const cashCount = await sb.from("cash_reconciliations").select("id", { count: "exact", head: true })
    .is("voided_at", null).eq("count_date", date);

  return {
    date,
    salesRecorded,
    salesVerification,
    productLinesPresent: linesPresent,
    productLinesReconcile,
    markedNoTrading,
    expensesRecorded: (expRes.data ?? []).length > 0,
    purchasesRecorded: (purRes.data ?? []).length > 0,
    importsAwaitingApproval: impRes.count ?? 0,
    unmappedLines,
    missingCogsLines,
    cashCountRequired: signals.cashCountRequired,
    cashCountRecorded: (cashCount.count ?? 0) > 0,
    cashDifferenceUnresolved: signals.cashDifferenceUnresolved,
    chequeNeedsUpdate: signals.chequeNeedsUpdate,
    inventoryAlertsToAck: signals.inventoryAlertsToAck,
    criticalActionsOpen: signals.criticalActionsOpen,
  };
}

/** Completed closes whose underlying records changed after they were closed —
 *  computed live so it is always accurate even if nobody re-marked the close.
 *  Bounded to recent completed closes. */
export async function getStaleCloses(limit = 30): Promise<{ date: string; status: string }[]> {
  const sb = requireEngine();
  const { data, error } = await sb.from("daily_closes")
    .select("close_date,status,source_data_at")
    .is("voided_at", null).in("status", ["complete", "estimated"])
    .order("close_date", { ascending: false }).limit(limit);
  if (error) throw error;
  const out: { date: string; status: string }[] = [];
  for (const c of data ?? []) {
    if (!c.source_data_at) continue;
    const cur = await closeSourceDataAt(c.close_date);
    if (cur && cur > c.source_data_at) out.push({ date: c.close_date, status: c.status });
  }
  return out;
}

/** Newest updated_at across a day's underlying records — the stale-detection
 *  watermark captured at close time. */
export async function closeSourceDataAt(date: string): Promise<string | null> {
  const sb = requireEngine();
  const [sales, exp, pur] = await Promise.all([
    sb.from("sales").select("id,updated_at,created_at").is("voided_at", null).eq("sale_date", date),
    sb.from("expenses").select("updated_at,created_at").is("voided_at", null).eq("expense_date", date),
    sb.from("purchase_batches").select("updated_at,created_at").is("voided_at", null).eq("purchase_date", date),
  ]);
  const saleIds = (sales.data ?? []).map((s) => s.id);
  let itemTs: string | null = null;
  if (saleIds.length) {
    const items = await sb.from("sale_items").select("updated_at,created_at").is("voided_at", null).in("sale_id", saleIds);
    itemTs = maxTs(items.data ?? []);
  }
  return [maxTs(sales.data ?? []), maxTs(exp.data ?? []), maxTs(pur.data ?? []), itemTs]
    .filter((x): x is string => !!x).sort().pop() ?? null;
}
