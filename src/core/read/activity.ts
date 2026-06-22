/** Activity feed — a single time-ordered stream of business events (sales days,
 *  purchases, expenses, cash movements, cheques) merged from live reads. Why it
 *  matters: the owner sees the pulse of the business in one place and can spot
 *  anything out of place. The merge is PURE and unit-tested; the I/O is thin.
 *  READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import { todayCairo, isoDaysAgo } from "@/core/time";

export type ActivityKind = "sale" | "purchase" | "expense" | "cash" | "withdrawal" | "cheque";
export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  date: string;       // ISO date (business day)
  ts: string;         // ISO timestamp for stable ordering within a day
  label: string;      // human summary
  amount: number;     // signed: money in = +, money out = −, neutral = 0
  route: string;      // where to act on it
}

/** Pure merge — newest first, ties broken by created_at timestamp then kind.
 *  Kept separate so ordering is deterministically testable. */
export function mergeActivity(events: ActivityEvent[], limit = 40): ActivityEvent[] {
  return [...events]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : a.kind.localeCompare(b.kind)))
    .slice(0, limit);
}

export async function getActivityFeed(windowDays = 30, limit = 40, range?: { from: string; to: string }): Promise<ActivityEvent[]> {
  const sb = requireEngine();
  const today = range?.to ?? todayCairo();
  const from = range?.from ?? isoDaysAgo(today, windowDays - 1);

  const [sales, purchases, expenses, movements, cheques, products, cats] = await Promise.all([
    sb.from("sales").select("id,sale_date,total_amount,created_at").is("voided_at", null).gte("sale_date", from).lte("sale_date", today),
    sb.from("purchase_batches").select("id,purchase_date,product_id,total_cost,created_at").is("voided_at", null).gte("purchase_date", from).lte("purchase_date", today),
    sb.from("expenses").select("id,expense_date,category_id,amount,created_at").is("voided_at", null).gte("expense_date", from).lte("expense_date", today),
    sb.from("money_movements").select("id,movement_date,movement_type,amount,created_at").is("voided_at", null).gte("movement_date", from).lte("movement_date", today),
    sb.from("cheques").select("id,received_date,amount_received,created_at").is("voided_at", null).not("received_date", "is", null).gte("received_date", from).lte("received_date", today),
    sb.from("products").select("id,name_en"),
    sb.from("expense_categories").select("id,name"),
  ]);
  for (const r of [sales, purchases, expenses, movements, cheques, products, cats]) if (r.error) throw r.error;

  const pname = new Map((products.data ?? []).map((p) => [p.id, p.name_en]));
  const cname = new Map((cats.data ?? []).map((c) => [c.id, c.name]));
  const ev: ActivityEvent[] = [];

  for (const s of sales.data!) ev.push({ id: s.id, kind: "sale", date: s.sale_date, ts: s.created_at ?? s.sale_date,
    label: "Sales day recorded", amount: Number(s.total_amount), route: "/sales" });
  for (const p of purchases.data!) ev.push({ id: p.id, kind: "purchase", date: p.purchase_date, ts: p.created_at ?? p.purchase_date,
    label: `Bought ${pname.get(p.product_id) ?? "stock"}`, amount: -Number(p.total_cost), route: "/purchases" });
  for (const e of expenses.data!) ev.push({ id: e.id, kind: "expense", date: e.expense_date, ts: e.created_at ?? e.expense_date,
    label: `Expense · ${cname.get(e.category_id) ?? "Other"}`, amount: -Number(e.amount), route: "/expenses" });
  for (const m of movements.data!) {
    const withdrawal = m.movement_type === "personal_withdrawal";
    ev.push({ id: m.id, kind: withdrawal ? "withdrawal" : "cash", date: m.movement_date, ts: m.created_at ?? m.movement_date,
      label: withdrawal ? "Personal withdrawal" : m.amount >= 0 ? "Cash in" : "Cash out", amount: Number(m.amount), route: "/money" });
  }
  for (const c of cheques.data!) ev.push({ id: c.id, kind: "cheque", date: c.received_date!, ts: c.created_at ?? c.received_date!,
    label: "Cheque received", amount: Number(c.amount_received ?? 0), route: "/cheques" });

  return mergeActivity(ev, limit);
}
