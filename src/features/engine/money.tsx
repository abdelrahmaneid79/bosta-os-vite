import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHead, Eyebrow, StatCard, Badge, Button, Select } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { Confirm } from "@/components/ui/Confirm";
import { BarChart } from "@/components/charts";
import { EmptyState, SkeletonRows, ErrorState } from "@/components/feedback";
import { DateRangePicker } from "@/components/DateRangePicker";
import { egp, egpShort } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { monthBoundsCairo } from "@/core/time";
import { useActiveRange } from "@/store/filters";
import { getMoneyMovements, getCashSummary, getMoneyAccounts } from "@/core/read/money";
import { getSettlementPeriods, getCheques } from "@/core/read/settlements";
import { getExpenses, getExpenseCategories } from "@/core/read/expenses";
import { getLocations } from "@/core/read/common";
import { voidMovement, reconcileCheque, voidCheque, openSettlementPeriod, voidExpense } from "@/core/db/mutations";
import { CashForm, ChequeForm, ExpenseForm } from "./forms";
import { useUI } from "@/store/ui";

const en = isEngineConfigured;
const MI = {
  cash: "M3 7h18v11H3zM3 11h18M7 15h2",
  in: "M12 5v14M5 12l7 7 7-7",
  out: "M12 19V5M5 12l7-7 7 7",
  bag: "M6 8h12l1 12H5zM9 8a3 3 0 0 1 6 0",
  bank: "M3 21h18M5 21V10M19 21V10M3 10l9-6 9 6M9 21v-6h6v6",
} as const;
const monthKey = (d: string) => d.slice(0, 7);

// ── Money / Cash ───────────────────────────────────────────────────────────
export function MoneyScreen() {
  const r = useActiveRange();
  const [sheet, setSheet] = useState<null | "count" | "in" | "out" | "withdraw">(null);
  const [voidMv, setVoidMv] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "in" | "out" | "withdrawals">("all");
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const sum = useQuery({ queryKey: ["cash", r], queryFn: () => getCashSummary(r), enabled: en });
  const mv = useQuery({ queryKey: ["mv", r], queryFn: () => getMoneyMovements(r), enabled: en });
  const accounts = useQuery({ queryKey: ["money-accounts"], queryFn: getMoneyAccounts, enabled: en });
  const accId = accounts.data?.[0]?.id;
  const c = sum.data;
  const all = mv.data ?? [];
  const movements = all.filter((m) =>
    filter === "all" ? true : filter === "withdrawals" ? m.isWithdrawal : filter === "in" ? m.amount >= 0 : m.amount < 0 && !m.isWithdrawal);
  const months = [...new Set(all.map((m) => monthKey(m.date)))].sort();
  const inflowSeries = months.map((ym) => ({ label: fmtDate(ym + "-01", "MMM"), value: all.filter((m) => monthKey(m.date) === ym && m.amount > 0).reduce((s, m) => s + m.amount, 0) }));
  const outflowSeries = months.map((ym) => ({ label: fmtDate(ym + "-01", "MMM"), value: all.filter((m) => monthKey(m.date) === ym && m.amount < 0).reduce((s, m) => s + Math.abs(m.amount), 0) }));
  const del = useMutation({ mutationFn: (id: string) => voidMovement(id, accId!), onSuccess: () => { reportSuccess("Void movement", "Movement voided · balance recalculated"); setVoidMv(null); qc.invalidateQueries(); }, onError: (e) => reportError("Void movement", e) });
  if (!en) return <EmptyState title="Sign in to load money" />;

  const titles = { count: "Count cash", in: "Add cash", out: "Cash out", withdraw: "Owner withdrawal" } as const;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Cash ledger · drawer only — separate from profit &amp; expenses</Eyebrow>
        <div className="flex-1" />
        <DateRangePicker />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Cash balance" accent="blue" icon={MI.cash} value={c ? (c.balance == null ? "—" : egpShort(c.balance)) : "—"} sub="current drawer" />
        <StatCard label="Money in" accent="mint" icon={MI.in} value={c ? egpShort(c.inflow) : "—"} sub="in range" />
        <StatCard label="Money out" accent="red" icon={MI.out} value={c ? egpShort(Math.abs(c.outflow)) : "—"} sub="in range" />
        <StatCard label="Withdrawals" accent="amber" icon={MI.bag} value={c ? egpShort(c.withdrawals) : "—"} sub="not an expense" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setSheet("count")}>Count cash</Button>
        <Button variant="outline" onClick={() => setSheet("in")}>+ Cash in</Button>
        <Button variant="outline" onClick={() => setSheet("out")}>− Cash out</Button>
        <Button variant="outline" onClick={() => setSheet("withdraw")}>Withdraw</Button>
      </div>

      {months.length > 0 && (
        <Card>
          <CardHead title="Cash flow" sub="Money in vs out, by month" accent="blue" icon={MI.bank} />
          <div className="grid gap-5 lg:grid-cols-2">
            <div><div className="mb-1 text-[11px] font-semibold text-good">Money in</div><BarChart data={inflowSeries} height={150} color="rgb(var(--good))" /></div>
            <div><div className="mb-1 text-[11px] font-semibold text-bad">Money out</div><BarChart data={outflowSeries} height={150} color="rgb(var(--bad))" /></div>
          </div>
        </Card>
      )}

      <Card className="!p-0">
        <div className="flex flex-wrap items-center gap-2 p-5 pb-3">
          <Eyebrow>Movements</Eyebrow>
          <div className="flex-1" />
          <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="max-w-[170px]">
            <option value="all">All movements</option>
            <option value="in">Cash in</option>
            <option value="out">Cash out</option>
            <option value="withdrawals">Withdrawals</option>
          </Select>
        </div>
        {mv.isLoading ? <div className="p-4"><SkeletonRows /></div> : mv.isError ? <div className="p-4"><ErrorState message={String((mv.error as Error)?.message)} /></div> :
          movements.length === 0 ? <div className="p-4"><EmptyState title="No movements in range" /></div> : (
          <div className="divide-y divide-line">
            {movements.map((m) => (
              <div key={m.id} className="row-hover flex items-center gap-3 px-5 py-3">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${m.amount >= 0 ? "bg-good/10 text-good" : "bg-bad/10 text-bad"}`}>
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d={m.amount >= 0 ? MI.in : MI.out} /></svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium capitalize text-text">{m.type.replace(/_/g, " ")}{m.notes ? ` · ${m.notes}` : ""}</div>
                  <div className="text-[12px] text-dim">{fmtDate(m.date)}{m.isWithdrawal ? " · not an expense" : ""}</div>
                </div>
                <div className={`tnum font-display text-sm font-bold ${m.amount >= 0 ? "text-good" : "text-bad"}`}>{m.amount >= 0 ? "+" : "−"}{egp(Math.abs(m.amount))}</div>
                <button onClick={() => setVoidMv(m.id)} className="text-dim hover:text-bad" title="Void">✕</button>
              </div>
            ))}
          </div>
        )}
      </Card>
      {sheet && <Modal open onClose={() => setSheet(null)} title={titles[sheet]}><CashForm mode={sheet} onDone={() => setSheet(null)} /></Modal>}
      <Confirm open={!!voidMv} title="Void this movement?" danger busy={del.isPending}
        message="The cash balance is recomputed without this entry. The row is kept for audit." confirmLabel="Void"
        onConfirm={() => voidMv && del.mutate(voidMv)} onClose={() => setVoidMv(null)} />
    </div>
  );
}

// ── Expenses ─────────────────────────────────────────────────────────────────
export function ExpensesScreen() {
  const r = useActiveRange();
  const [addOpen, setAddOpen] = useState(false);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [cat, setCat] = useState("");
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["expenses", r], queryFn: () => getExpenses(r), enabled: en });
  const cats = useQuery({ queryKey: ["expense-cats"], queryFn: getExpenseCategories, enabled: en });
  const rows = (q.data ?? []).filter((e) => !cat || e.category === cat);
  const filteredTotal = rows.reduce((s, e) => s + e.amount, 0);
  const del = useMutation({ mutationFn: (id: string) => voidExpense(id), onSuccess: () => { reportSuccess("Void expense", "Expense voided · profit restored · kept for audit"); setVoidId(null); qc.invalidateQueries(); }, onError: (e) => reportError("Void expense", e) });
  if (!en) return <EmptyState title="Sign in to load expenses" />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Operating expenses · withdrawals are on Cash</Eyebrow>
        <div className="flex-1" />
        <DateRangePicker />
        <Link to="/expenses/import" className="lift rounded-2xl border border-line bg-panel px-4 py-2.5 font-display text-sm font-bold text-text hover:bg-panel2">Import</Link>
        <Button onClick={() => setAddOpen(true)}>+ Expense</Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatCard label={cat ? "Spend (filtered)" : "Spend in range"} accent="red" icon={MI.out} value={egp(filteredTotal)} sub={cat || "all categories"} />
        <StatCard label="Records" accent="amber" icon={MI.bag} value={rows.length} sub="in range" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="max-w-xs">
          <option value="">All categories</option>
          {(cats.data ?? []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </Select>
        {cat && <Button variant="ghost" onClick={() => setCat("")}>Clear</Button>}
      </div>
      {q.isLoading ? <SkeletonRows /> : q.isError ? <ErrorState message={String((q.error as Error)?.message)} /> :
        rows.length === 0 ? <EmptyState title="No expenses in range" hint="Add rent, supplies, salary, transport…" /> : (
        <Card className="!p-0"><div className="divide-y divide-line">
          {rows.map((e) => (
            <div key={e.id} className="row-hover flex items-center gap-3 px-5 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warn/10 text-warn">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 2h9l5 5v15H4V2zM9 13h6M9 17h6" /></svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium capitalize text-text">{e.category}{e.notes ? ` · ${e.notes}` : ""}</div>
                <div className="text-[12px] text-dim">{fmtDate(e.date)} · {e.paymentMethod}</div>
              </div>
              <div className="tnum font-display text-sm font-bold text-bad">−{egp(e.amount)}</div>
              <button onClick={() => setVoidId(e.id)} className="text-dim hover:text-bad" title="Void">✕</button>
            </div>
          ))}
        </div></Card>
      )}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add expense"><ExpenseForm onDone={() => setAddOpen(false)} /></Modal>
      <Confirm open={!!voidId} title="Void this expense?" danger busy={del.isPending}
        message="The row is kept for audit but no longer counts. Reversible only by re-entering it." confirmLabel="Void"
        onConfirm={() => voidId && del.mutate(voidId)} onClose={() => setVoidId(null)} />
    </div>
  );
}

// ── Cheques / Settlements ────────────────────────────────────────────────────
export function ChequesScreen() {
  const [addOpen, setAddOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | { kind: "reconcile" | "void"; id: string }>(null);
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const periods = useQuery({ queryKey: ["periods"], queryFn: getSettlementPeriods, enabled: en });
  const cheques = useQuery({ queryKey: ["cheques"], queryFn: getCheques, enabled: en });
  const locations = useQuery({ queryKey: ["locations"], queryFn: getLocations, enabled: en });
  const openPeriod = useMutation({ mutationFn: () => openSettlementPeriod(locations.data![0].id, monthBoundsCairo().from), onSuccess: () => { reportSuccess("Open settlement", "Settlement period ready for this month (rent + share seeded)"); qc.invalidateQueries(); }, onError: (e) => reportError("Open settlement", e) });
  const rec = useMutation({ mutationFn: (id: string) => reconcileCheque(id), onSuccess: () => { reportSuccess("Reconcile cheque", "Cheque reconciled · difference settled"); setConfirm(null); qc.invalidateQueries(); }, onError: (e) => reportError("Reconcile cheque", e) });
  const del = useMutation({ mutationFn: (id: string) => voidCheque(id), onSuccess: () => { reportSuccess("Void cheque", "Cheque voided · removed from totals · kept for audit"); setConfirm(null); qc.invalidateQueries(); }, onError: (e) => reportError("Void cheque", e) });
  if (!en) return <EmptyState title="Sign in to load settlements" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Settlement = revenue − deductions</Eyebrow>
        <div className="flex-1" />
        <Button variant="outline" disabled={!locations.data?.length || openPeriod.isPending} onClick={() => openPeriod.mutate()}>Open this month</Button>
        <Button disabled={!periods.data?.length} onClick={() => setAddOpen(true)}>+ Cheque</Button>
      </div>

      <Eyebrow>Periods</Eyebrow>
      {periods.isLoading ? <SkeletonRows /> : (periods.data?.length ?? 0) === 0 ? <EmptyState title="No settlement periods" hint="Open this month to start." /> : (
        <Card className="!p-0"><div className="divide-y divide-line">
          {periods.data!.map((p) => (
            <div key={p.id} className="row-hover flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text">{fmtDate(p.start)}{p.end ? ` → ${fmtDate(p.end)}` : ""}</div>
                <div className="text-[12px] text-dim">{egp(p.revenue)} − {egp(p.deductions)} deductions</div>
              </div>
              <Badge tone={p.status === "reconciled" ? "good" : p.status === "open" ? "pink" : "neutral"}>{p.status}</Badge>
              <div className="font-display text-sm font-semibold">{egp(p.netExpected)}</div>
            </div>
          ))}
        </div></Card>
      )}

      <Eyebrow>Cheques</Eyebrow>
      {(cheques.data?.length ?? 0) === 0 ? <EmptyState title="No cheques recorded" /> : (
        <Card className="!p-0"><div className="divide-y divide-line">
          {cheques.data!.map((c) => (
            <div key={c.id} className="row-hover flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text">{c.receivedDate ? fmtDate(c.receivedDate) : "pending"}</div>
                <div className="text-[12px] text-dim">expected {egp(c.expected)}{c.received != null ? ` · received ${egp(c.received)}` : ""}</div>
              </div>
              {c.difference != null && <div className={`font-display text-sm font-semibold ${c.difference >= 0 ? "text-good" : "text-bad"}`}>{c.difference >= 0 ? "+" : "−"}{egp(Math.abs(c.difference))}</div>}
              <Badge tone={c.status === "reconciled" ? "good" : "neutral"}>{c.status}</Badge>
              {c.status !== "reconciled" && <button onClick={() => setConfirm({ kind: "reconcile", id: c.id })} className="text-[11px] text-pink hover:underline">reconcile</button>}
              <button onClick={() => setConfirm({ kind: "void", id: c.id })} className="text-dim hover:text-bad" title="Void">✕</button>
            </div>
          ))}
        </div></Card>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Record cheque"><ChequeForm onDone={() => setAddOpen(false)} /></Modal>
      <Confirm open={confirm?.kind === "reconcile"} title="Reconcile this cheque?" busy={rec.isPending}
        message="Marks the cheque reconciled (final stage of the lifecycle)." confirmLabel="Reconcile"
        onConfirm={() => confirm && rec.mutate(confirm.id)} onClose={() => setConfirm(null)} />
      <Confirm open={confirm?.kind === "void"} title="Void this cheque?" danger busy={del.isPending}
        message="Kept for audit; removed from received/owed totals. Reversible only by re-recording." confirmLabel="Void"
        onConfirm={() => confirm && del.mutate(confirm.id)} onClose={() => setConfirm(null)} />
    </div>
  );
}
