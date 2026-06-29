import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHead, Eyebrow, StatCard, Button, Select } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { Confirm } from "@/components/ui/Confirm";
import { BarChart } from "@/components/charts";
import { EmptyState, SkeletonRows, ErrorState } from "@/components/feedback";
import { DateRangePicker } from "@/components/DateRangePicker";
import { egp, egpShort } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { useActiveRange } from "@/store/filters";
import { getCashLedger, getCashSummary, getMoneyAccounts } from "@/core/read/money";
import { getChequeCycle } from "@/core/read/settlements";
import { getExpenses, getExpenseCategories } from "@/core/read/expenses";
import { voidMovement, voidCheque, voidExpense } from "@/core/db/mutations";
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
const KIND_LABEL: Record<string, string> = {
  cheque: "cheque in", withdrawal: "withdrawal · not an expense", expense: "expense",
  purchase: "stock purchase", cash_in: "cash in", cash_out: "cash out",
};

// ── Money / Cash ───────────────────────────────────────────────────────────
export function MoneyScreen() {
  const r = useActiveRange();
  const [sheet, setSheet] = useState<null | "count" | "in" | "out" | "withdraw">(null);
  const [voidMv, setVoidMv] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "in" | "out" | "withdrawals">("all");
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const sum = useQuery({ queryKey: ["cash", r], queryFn: () => getCashSummary(r), enabled: en });
  const mv = useQuery({ queryKey: ["cash-ledger", r], queryFn: () => getCashLedger(r), enabled: en });
  const accounts = useQuery({ queryKey: ["money-accounts"], queryFn: getMoneyAccounts, enabled: en });
  const accId = accounts.data?.[0]?.id;
  const c = sum.data;
  const all = mv.data ?? [];
  const movements = all.filter((m) =>
    filter === "all" ? true : filter === "withdrawals" ? m.kind === "withdrawal" : filter === "in" ? m.amount >= 0 : m.amount < 0 && m.kind !== "withdrawal");
  const months = [...new Set(all.map((m) => monthKey(m.date)))].sort();
  const inflowSeries = months.map((ym) => ({ label: fmtDate(ym + "-01", "MMM"), value: all.filter((m) => monthKey(m.date) === ym && m.amount > 0).reduce((s, m) => s + m.amount, 0) }));
  const outflowSeries = months.map((ym) => ({ label: fmtDate(ym + "-01", "MMM"), value: all.filter((m) => monthKey(m.date) === ym && m.amount < 0).reduce((s, m) => s + Math.abs(m.amount), 0) }));
  const del = useMutation({ mutationFn: (id: string) => voidMovement(id, accId!), onSuccess: () => { reportSuccess("Void movement", "Movement voided · balance recalculated"); setVoidMv(null); qc.invalidateQueries(); }, onError: (e) => reportError("Void movement", e) });
  if (!en) return <EmptyState title="Sign in to load money" />;

  const titles = { count: "Count cash", in: "Add cash", out: "Cash out", withdraw: "Owner withdrawal" } as const;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Cash on hand · cheques in − expenses, stock &amp; withdrawals out</Eyebrow>
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
          <Eyebrow>Cash flow · every in &amp; out</Eyebrow>
          <div className="flex-1" />
          <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="max-w-[170px]">
            <option value="all">All flow</option>
            <option value="in">Cash in</option>
            <option value="out">Cash out</option>
            <option value="withdrawals">Withdrawals</option>
          </Select>
        </div>
        {mv.isLoading ? <div className="p-4"><SkeletonRows /></div> : mv.isError ? <div className="p-4"><ErrorState message={String((mv.error as Error)?.message)} /></div> :
          movements.length === 0 ? <div className="p-4"><EmptyState title="No cash flow in range" /></div> : (
          <div className="divide-y divide-line">
            {movements.map((m) => {
              const voidable = m.id.startsWith("mv-");
              return (
              <div key={m.id} className="row-hover flex items-center gap-3 px-5 py-3">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${m.amount >= 0 ? "bg-good/10 text-good" : "bg-bad/10 text-bad"}`}>
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d={m.amount >= 0 ? MI.in : MI.out} /></svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium capitalize text-text">{m.label}</div>
                  <div className="text-[12px] text-dim">{fmtDate(m.date)} · {KIND_LABEL[m.kind] ?? m.kind}</div>
                </div>
                <div className={`tnum font-display text-sm font-bold ${m.amount >= 0 ? "text-good" : "text-bad"}`}>{m.amount >= 0 ? "+" : "−"}{egp(Math.abs(m.amount))}</div>
                {voidable ? <button onClick={() => setVoidMv(m.id.slice(3))} className="text-dim hover:text-bad" title="Void">✕</button> : <span className="w-[14px] flex-shrink-0" />}
              </div>
              );
            })}
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
/** Spend split into two honest buckets: running OPERATING costs (rent, salary,
 *  packaging…) that hit profit, and INVENTORY purchases (cost-of-goods) that
 *  reach profit through per-sale COGS — shown apart so they never blur together. */
export function ExpensesScreen() {
  const r = useActiveRange();
  const [addOpen, setAddOpen] = useState(false);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [cat, setCat] = useState("");
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["expenses", r], queryFn: () => getExpenses(r), enabled: en });
  const cats = useQuery({ queryKey: ["expense-cats"], queryFn: getExpenseCategories, enabled: en });
  const del = useMutation({ mutationFn: (id: string) => voidExpense(id), onSuccess: () => { reportSuccess("Void expense", "Expense voided · profit restored · kept for audit"); setVoidId(null); qc.invalidateQueries(); }, onError: (e) => reportError("Void expense", e) });
  if (!en) return <EmptyState title="Sign in to load expenses" />;

  const all = q.data ?? [];
  const opTotal = all.filter((e) => e.isOperating).reduce((s, e) => s + e.amount, 0);
  const invTotal = all.filter((e) => !e.isOperating).reduce((s, e) => s + e.amount, 0);

  // category breakdown (each group's share is of its own group's subtotal)
  const byCat = new Map<string, { amount: number; isOperating: boolean }>();
  for (const e of all) {
    const cur = byCat.get(e.category) ?? { amount: 0, isOperating: e.isOperating };
    cur.amount += e.amount; byCat.set(e.category, cur);
  }
  const groups = [...byCat.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.amount - a.amount);
  const opCats = groups.filter((g) => g.isOperating);
  const invCats = groups.filter((g) => !g.isOperating);

  const rows = all.filter((e) => !cat || e.category === cat);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Running costs vs inventory · withdrawals are on Cash</Eyebrow>
        <div className="flex-1" />
        <DateRangePicker />
        <Link to="/expenses/import" className="lift rounded-2xl border border-line bg-panel px-4 py-2.5 font-display text-sm font-bold text-text hover:bg-panel2">Import</Link>
        <Button onClick={() => setAddOpen(true)}>+ Expense</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Operating expenses" accent="red" icon={MI.out} value={egp(opTotal)} sub="rent, salary, packaging — hits profit" />
        <StatCard label="Inventory purchases" accent="violet" icon={MI.bag} value={egp(invTotal)} sub="cost of goods — profit via COGS" />
        <StatCard label="Total spend" accent="amber" icon={MI.cash} value={egp(opTotal + invTotal)} sub="in range · all categories" />
      </div>

      {q.isLoading ? <SkeletonRows /> : q.isError ? <ErrorState message={String((q.error as Error)?.message)} /> : all.length === 0 ? (
        <EmptyState title="No expenses in range" hint="Add rent, supplies, salary, transport…" />
      ) : (
        <>
          {/* By-category breakdown, grouped */}
          <div className="grid gap-3 lg:grid-cols-2">
            <CatGroup title="Operating costs" sub="recurring running expenses" total={opTotal} cats={opCats} accent="rgb(var(--bad))"
              active={cat} onPick={(c) => setCat((p) => p === c ? "" : c)} />
            <CatGroup title="Inventory (cost of goods)" sub="stock you buy to resell" total={invTotal} cats={invCats} accent="rgb(var(--violet))"
              active={cat} onPick={(c) => setCat((p) => p === c ? "" : c)} hint="For future buying, use Inventory → Purchases so it feeds real product cost." />
          </div>

          {/* Records */}
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow>{cat ? `${cat} · ${rows.length} record${rows.length === 1 ? "" : "s"}` : `All records · ${rows.length}`}</Eyebrow>
            <div className="flex-1" />
            <Select value={cat} onChange={(e) => setCat(e.target.value)} className="max-w-[200px]">
              <option value="">All categories</option>
              {(cats.data ?? []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </Select>
            {cat && <Button variant="ghost" onClick={() => setCat("")}>Clear</Button>}
          </div>
          <Card className="!p-0"><div className="divide-y divide-line">
            {rows.map((e) => (
              <div key={e.id} className="row-hover flex items-center gap-3 px-5 py-3">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${e.isOperating ? "bg-warn/10 text-warn" : "bg-violet/10 text-violet"}`}>
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d={e.isOperating ? "M6 2h9l5 5v15H4V2zM9 13h6M9 17h6" : MI.bag} /></svg>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium capitalize text-text">{e.category}{e.notes ? ` · ${e.notes}` : ""}</div>
                  <div className="text-[12px] text-dim">{fmtDate(e.date)} · {e.paymentMethod}{e.isOperating ? "" : " · cost of goods"}</div>
                </div>
                <div className="tnum font-display text-sm font-bold text-bad">−{egp(e.amount)}</div>
                <button onClick={() => setVoidId(e.id)} className="text-dim hover:text-bad" title="Void">✕</button>
              </div>
            ))}
          </div></Card>
        </>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add expense"><ExpenseForm onDone={() => setAddOpen(false)} /></Modal>
      <Confirm open={!!voidId} title="Void this expense?" danger busy={del.isPending}
        message="The row is kept for audit but no longer counts. Reversible only by re-entering it." confirmLabel="Void"
        onConfirm={() => voidId && del.mutate(voidId)} onClose={() => setVoidId(null)} />
    </div>
  );
}

/** One spend bucket: subtotal + per-category share bars; tap a row to filter. */
function CatGroup({ title, sub, total, cats, accent, active, onPick, hint }: {
  title: string; sub: string; total: number; accent: string; active: string;
  cats: { category: string; amount: number }[]; onPick: (c: string) => void; hint?: string;
}) {
  return (
    <Card className="!p-0">
      <div className="flex items-center justify-between px-5 pt-4">
        <div><div className="font-display text-sm font-bold text-text">{title}</div><div className="text-[11px] text-dim">{sub}</div></div>
        <div className="tnum font-display text-base font-bold text-text">{egp(total)}</div>
      </div>
      {cats.length === 0 ? (
        <div className="px-5 py-4 text-[12px] text-dim">Nothing in range.</div>
      ) : (
        <div className="mt-2 space-y-1 px-3 pb-3">
          {cats.map((c) => {
            const share = total > 0 ? (c.amount / total) * 100 : 0;
            return (
              <button key={c.category} onClick={() => onPick(c.category)}
                className={`block w-full rounded-xl px-2 py-2 text-left transition hover:bg-panel2 ${active === c.category ? "bg-panel2" : ""}`}>
                <div className="flex items-center justify-between text-[13px]">
                  <span className="truncate capitalize text-text">{c.category}</span>
                  <span className="tnum ml-2 flex-shrink-0 font-display font-semibold text-text">{egp(c.amount)}<span className="ml-1 text-[11px] font-normal text-dim">{Math.round(share)}%</span></span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full" style={{ width: `${Math.max(2, share)}%`, background: accent }} /></div>
              </button>
            );
          })}
        </div>
      )}
      {hint && <div className="border-t border-line px-5 py-2.5 text-[11px] text-dim">{hint}</div>}
    </Card>
  );
}


// ── Cheques — close the running sales tab, cross-referenced to sales ─────────
export function ChequesScreen() {
  const [addOpen, setAddOpen] = useState(false);
  const [voidId, setVoidId] = useState<string | null>(null);
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const cy = useQuery({ queryKey: ["cheque-cycle"], queryFn: getChequeCycle, enabled: en });
  const del = useMutation({ mutationFn: (id: string) => voidCheque(id), onSuccess: () => { reportSuccess("Void cheque", "Cheque removed · kept for audit"); setVoidId(null); qc.invalidateQueries(); }, onError: (e) => reportError("Void cheque", e) });
  if (!en) return <EmptyState title="Sign in to load cheques" />;
  const c = cy.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Cheques close the running sales tab — cross-referenced to your sales</Eyebrow>
        <div className="flex-1" />
        <Button onClick={() => setAddOpen(true)}>+ Cheque</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Total cashed" accent="mint" icon={MI.in} value={c ? egpShort(c.totalReceived) : "—"} sub={`${c?.cheques.length ?? 0} cheques`} />
        <StatCard label="Open tab" accent="amber" icon={MI.bank} value={c ? egpShort(c.openTab.revenue) : "—"} sub={c?.openTab.from ? `since ${fmtDate(c.openTab.from)}` : "awaiting sales"} />
        <StatCard label="Avg mall deduction" accent="violet" icon={MI.out} value={c?.blendedDeductionPct != null ? `${c.blendedDeductionPct}%` : "—"} sub="of covered revenue" />
      </div>

      {c && c.openTab.revenue > 0 && (
        <Card glow accent="#F7A23B">
          <CardHead title="Open tab — awaiting next cheque" accent="amber" icon={MI.bank}
            action={<Button size="sm" onClick={() => setAddOpen(true)}>Cash a cheque</Button>} />
          <div className="text-sm text-muted">Sales since the last cheque ({c.openTab.from ? fmtDate(c.openTab.from) : "—"} → {fmtDate(c.openTab.to)}) total <b className="text-text">{egp(c.openTab.revenue)}</b> over {c.openTab.days} days. When the mall pays, record the cheque to close this tab.</div>
        </Card>
      )}

      {cy.isLoading ? <SkeletonRows /> : (c?.cheques.length ?? 0) === 0 ? <EmptyState title="No cheques recorded" hint="Record a cheque when the mall pays out — it closes the running sales tab and counts as cash in." /> : (
        <Card className="!p-0">
          <div className="px-5 pt-4"><Eyebrow>Cheque history · newest first</Eyebrow></div>
          <div className="mt-2 divide-y divide-line">
            {c!.cheques.map((ch) => (
              <div key={ch.id} className="row-hover flex items-center gap-3 px-5 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-good/10 text-good"><svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d={MI.bank} /></svg></span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-text">{fmtDate(ch.date)}</div>
                  <div className="text-[12px] text-dim">
                    {ch.coverFrom
                      ? `covers ${fmtDate(ch.coverFrom)} → ${fmtDate(ch.coverTo)} · sales ${egp(ch.coverRevenue ?? 0)}${ch.deductionPct == null ? "" : ch.deductionPct >= 0 ? ` · ${ch.deductionPct}% mall cut` : " · paid in arrears (covers earlier sales)"}`
                      : "opening cheque · prior period not on record"}
                  </div>
                </div>
                <div className="tnum font-display text-sm font-bold text-good">+{egp(ch.amount)}</div>
                <button onClick={() => setVoidId(ch.id)} className="text-dim hover:text-bad" title="Void">✕</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {c?.cashEra && (
        <Card>
          <div className="text-[13px] text-dim"><b className="text-text">Before cheque records:</b> {egp(c.cashEra.revenue)} of sales ({fmtDate(c.cashEra.from)} → {fmtDate(c.cashEra.to)}) were settled as cash before cheque tracking began — counted in revenue, never shown as owed.</div>
        </Card>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Record cheque"><ChequeForm onDone={() => setAddOpen(false)} /></Modal>
      <Confirm open={!!voidId} title="Void this cheque?" danger busy={del.isPending}
        message="Removed from cheque totals and cash in; kept for audit." confirmLabel="Void"
        onConfirm={() => voidId && del.mutate(voidId)} onClose={() => setVoidId(null)} />
    </div>
  );
}
