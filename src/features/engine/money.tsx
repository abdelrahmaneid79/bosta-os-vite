import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHead, Eyebrow, StatCard, Button, Select } from "@/components/ui";
import { Stat, DeckTile, TileHead, MBars } from "./deck";
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
import { getExpenses } from "@/core/read/expenses";
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
        <StatCard label="Cash on hand" accent="blue" icon={MI.cash} value={c ? (c.balance == null ? "—" : egpShort(c.balance)) : "—"} sub={c?.since ? `opening ${egpShort(c.opening)} · since ${fmtDate(c.since)}` : "current drawer"} />
        <StatCard label="Money in" accent="mint" icon={MI.in} value={c ? egpShort(c.inflow) : "—"} sub="in range" />
        <StatCard label="Money out" accent="red" icon={MI.out} value={c ? egpShort(Math.abs(c.outflow)) : "—"} sub="in range" />
        <StatCard label="Withdrawals" accent="amber" icon={MI.bag} value={c ? egpShort(c.withdrawals) : "—"} sub="not an expense" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setSheet("count")}>Count cash</Button>
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
  const navigate = useNavigate();
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["expenses", r], queryFn: () => getExpenses(r), enabled: en });
  const del = useMutation({ mutationFn: (id: string) => voidExpense(id), onSuccess: () => { reportSuccess("Void expense", "Expense voided · profit restored · kept for audit"); setVoidId(null); qc.invalidateQueries(); }, onError: (e) => reportError("Void expense", e) });
  if (!en) return <EmptyState title="Sign in to load expenses" />;

  const all = q.data ?? [];
  const total = all.reduce((s, e) => s + e.amount, 0);
  const cat = new Map<string, number>(), ven = new Map<string, number>(), mon = new Map<string, number>();
  for (const e of all) {
    cat.set(e.category, (cat.get(e.category) ?? 0) + e.amount);
    if (e.notes) ven.set(e.notes, (ven.get(e.notes) ?? 0) + e.amount);
    mon.set(e.date.slice(0, 7), (mon.get(e.date.slice(0, 7)) ?? 0) + e.amount);
  }
  const topCat = [...cat.entries()].sort((a, b) => b[1] - a[1])[0];
  const topShare = topCat && total ? Math.round((topCat[1] / total) * 100) : 0;
  const byVen = [...ven.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const em = [...mon.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const spendBars = em.map(([m, v]) => ({ label: fmtDate(m + "-01", "MMM"), full: fmtDate(m + "-01", "MMM yyyy"), value: v }));
  const rows = all.slice().sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <DateRangePicker />
        <div style={{ flex: 1 }} />
        <button className="addbtn" onClick={() => navigate("/expenses/import")}>Import</button>
        <button className="qadd" style={{ height: 38 }} onClick={() => setAddOpen(true)}><span>+ Add expense</span></button>
      </div>

      {q.isLoading ? <SkeletonRows /> : q.isError ? <ErrorState message={String((q.error as Error)?.message)} /> : (
        <>
          <div className="statgrid c3">
            <Stat label="Total spend" color="var(--amber)" value={egp(total)} />
            <Stat label="Top category" color="var(--mag)" value={topCat ? <span style={{ textTransform: "capitalize" }}>{topCat[0]} · {topShare}%</span> : "—"} />
            <Stat label="Monthly avg spend" color="var(--violet)" value={em.length ? egp(total / em.length) : "—"} />
          </div>

          <div className="row2">
            <DeckTile style={{ padding: 0, display: "flex", flexDirection: "column", height: 608 }}>
              <div style={{ padding: "22px 24px 8px", display: "flex", alignItems: "center", gap: 10 }}>
                <span className="tname">Expenses</span>
                <button className="addbtn" style={{ marginLeft: "auto" }} onClick={() => setAddOpen(true)}>+ Add expense</button>
              </div>
              <div className="scroll" style={{ flex: 1, maxHeight: "none" }}>
                <table className="tbl">
                  <thead><tr><th>Date</th><th>Category</th><th>Vendor</th><th className="r">Amount</th><th style={{ width: 34 }} /></tr></thead>
                  <tbody>
                    {rows.map((e) => (
                      <tr key={e.id}>
                        <td>{fmtDate(e.date, "EEE d MMM yyyy")}</td>
                        <td style={{ textTransform: "capitalize" }}>{e.category}</td>
                        <td style={{ color: "var(--dim)" }}>{e.notes || "—"}</td>
                        <td className="r">{egp(e.amount)}</td>
                        <td><button onClick={() => setVoidId(e.id)} title="Void" style={{ color: "var(--faint)", cursor: "pointer", background: "none", border: "none", fontSize: 12 }} onMouseEnter={(ev) => (ev.currentTarget.style.color = "var(--red)")} onMouseLeave={(ev) => (ev.currentTarget.style.color = "var(--faint)")}>✕</button></td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--faint)", padding: 28 }}>No expenses in this range.</td></tr>}
                  </tbody>
                </table>
              </div>
            </DeckTile>

            <div style={{ display: "flex", flexDirection: "column", gap: 16, height: 608 }}>
              <DeckTile><TileHead name="Monthly spend" right="in range" /><MBars data={spendBars} height={150} gradient="linear-gradient(180deg,var(--amber),rgba(255,61,168,.4))" /></DeckTile>
              <DeckTile style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                <TileHead name="Top suppliers" />
                <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                  {byVen.length ? byVen.map(([k, v]) => (
                    <div className="lrow" key={k} style={{ cursor: "default" }}><div style={{ flex: 1 }}><div className="lname">{k}</div></div><div className="lamt">{egp(v)}</div></div>
                  )) : <div style={{ fontSize: 12.5, color: "var(--faint)", padding: "10px 0" }}>No suppliers in range.</div>}
                </div>
              </DeckTile>
            </div>
          </div>
        </>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add expense"><ExpenseForm onDone={() => setAddOpen(false)} /></Modal>
      <Confirm open={!!voidId} title="Void this expense?" danger busy={del.isPending}
        message="The row is kept for audit but no longer counts. Reversible only by re-entering it." confirmLabel="Void"
        onConfirm={() => voidId && del.mutate(voidId)} onClose={() => setVoidId(null)} />
    </div>
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

  const chq = c?.cheques ?? [];
  const total = c?.totalReceived ?? 0;
  const avg = chq.length ? total / chq.length : 0;
  const largest = chq.length ? Math.max(...chq.map((x) => x.amount)) : 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 12.5, color: "var(--dim)", fontWeight: 600 }}>Cheques close the running sales tab — cross-referenced to your sales</div>
        <button className="qadd" style={{ height: 38, marginLeft: "auto" }} onClick={() => setAddOpen(true)}><span>+ Add cheque</span></button>
      </div>

      {c && c.openTab.revenue > 0 && (
        <div className="note" style={{ marginBottom: 16, background: "rgba(255,177,62,.08)", borderColor: "rgba(255,177,62,.25)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" /></svg>
          <div>Open tab: sales since the last cheque ({c.openTab.from ? fmtDate(c.openTab.from) : "—"} → {fmtDate(c.openTab.to)}) total <b style={{ color: "var(--text)" }}>{egp(c.openTab.revenue)}</b> over {c.openTab.days} days — the next cheque will close it.</div>
        </div>
      )}

      {cy.isLoading ? <SkeletonRows /> : (
        <>
          <div className="statgrid">
            <Stat label="Cheques logged" color="var(--cyan)" value={chq.length} />
            <Stat label="Total value" color="var(--mag)" value={egp(total)} />
            <Stat label="Average" color="var(--violet)" value={chq.length ? egp(avg) : "—"} />
            <Stat label="Largest" color="var(--green)" value={chq.length ? egp(largest) : "—"} />
          </div>
          <DeckTile style={{ padding: 0 }}>
            <div style={{ padding: "22px 24px 8px", display: "flex", alignItems: "center", gap: 10 }}>
              <span className="tname">All cheques</span>
              <button className="addbtn" style={{ marginLeft: "auto" }} onClick={() => setAddOpen(true)}>+ Add cheque</button>
            </div>
            <div className="scroll">
              <table className="tbl">
                <thead><tr><th>Date</th><th>Coverage</th><th className="r">Amount</th><th style={{ width: 34 }} /></tr></thead>
                <tbody>
                  {chq.map((ch) => (
                    <tr key={ch.id}>
                      <td>{fmtDate(ch.date, "EEE d MMM yyyy")}</td>
                      <td style={{ color: "var(--dim)", fontSize: 12.5 }}>{ch.coverFrom ? `${fmtDate(ch.coverFrom, "d MMM")} → ${fmtDate(ch.coverTo, "d MMM")}${ch.deductionPct != null && ch.deductionPct >= 0 ? ` · ${ch.deductionPct}% cut` : ""}` : "opening cheque"}</td>
                      <td className="r" style={{ color: "var(--green)" }}>{egp(ch.amount)}</td>
                      <td><button onClick={() => setVoidId(ch.id)} title="Void" style={{ color: "var(--faint)", cursor: "pointer", background: "none", border: "none", fontSize: 12 }} onMouseEnter={(ev) => (ev.currentTarget.style.color = "var(--red)")} onMouseLeave={(ev) => (ev.currentTarget.style.color = "var(--faint)")}>✕</button></td>
                    </tr>
                  ))}
                  {chq.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--faint)", padding: 28 }}>No cheques recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </DeckTile>
        </>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Record cheque"><ChequeForm onDone={() => setAddOpen(false)} /></Modal>
      <Confirm open={!!voidId} title="Void this cheque?" danger busy={del.isPending}
        message="Removed from cheque totals and cash in; kept for audit." confirmLabel="Void"
        onConfirm={() => voidId && del.mutate(voidId)} onClose={() => setVoidId(null)} />
    </div>
  );
}
