import { useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Stat, DeckTile, TileHead } from "./deck";
import { Modal } from "@/components/ui/Modal";
import { Confirm } from "@/components/ui/Confirm";
import { DonutChart, GroupedBarChart, BarChart } from "@/components/charts";
import { EmptyState, SkeletonRows, ErrorState } from "@/components/feedback";
import { DateRangePicker } from "@/components/DateRangePicker";
import { egp, egpShort } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { useActiveRange } from "@/store/filters";
import { getCashLedger, getCashSummary, getMoneyAccounts } from "@/core/read/money";
import { getChequeCycle, getSettlementStatements } from "@/core/read/settlements";
import { getExpenses } from "@/core/read/expenses";
import { voidMovement, voidCheque, voidExpense, setSettlementStatus } from "@/core/db/mutations";
import { CashForm, ChequeForm, ExpenseForm } from "./forms";
import { useUI } from "@/store/ui";

const en = isEngineConfigured;
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
  // Continuous month axis: every month from first to last, so none are skipped.
  const allMonths: string[] = [];
  if (months.length) {
    let y = +months[0].slice(0, 4), mo = +months[0].slice(5, 7);
    const ly = +months[months.length - 1].slice(0, 4), lm = +months[months.length - 1].slice(5, 7);
    while (y < ly || (y === ly && mo <= lm)) { allMonths.push(`${y}-${String(mo).padStart(2, "0")}`); if (++mo > 12) { mo = 1; y++; } }
  }
  const flowSeries = allMonths.map((ym) => ({
    label: fmtDate(ym + "-01", "MMM ''yy"),
    full: fmtDate(ym + "-01", "MMM yyyy"),
    a: all.filter((m) => monthKey(m.date) === ym && m.amount > 0).reduce((s, m) => s + m.amount, 0),
    b: all.filter((m) => monthKey(m.date) === ym && m.amount < 0).reduce((s, m) => s + Math.abs(m.amount), 0),
  }));
  const del = useMutation({ mutationFn: (id: string) => voidMovement(id, accId!), onSuccess: () => { reportSuccess("Void movement", "Movement voided · balance recalculated"); setVoidMv(null); qc.invalidateQueries(); }, onError: (e) => reportError("Void movement", e) });
  if (!en) return <EmptyState title="Sign in to load money" />;

  const titles = { count: "Count cash", in: "Add cash", out: "Cash out", withdraw: "Owner withdrawal" } as const;
  const flowFilters: { v: typeof filter; label: string }[] = [{ v: "all", label: "All" }, { v: "in", label: "In" }, { v: "out", label: "Out" }, { v: "withdrawals", label: "Withdrawals" }];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ fontSize: 12.5, color: "rgb(var(--dim))", fontWeight: 600 }}>Cheques in − expenses, stock &amp; withdrawals out</div>
        <div style={{ flex: 1 }} />
        <DateRangePicker />
        <button className="addbtn" onClick={() => setSheet("withdraw")}>Withdraw</button>
        <button className="qadd" style={{ height: 38 }} onClick={() => setSheet("count")}><span>Count cash</span></button>
      </div>

      <div className="statgrid">
        <Stat label="Cash on hand" color="rgb(var(--cyan))" value={c ? (c.balance == null ? "—" : egp(c.balance)) : "—"} sub={<div style={{ fontSize: 11, color: "rgb(var(--dim))", fontWeight: 600, marginTop: 8 }}>{c?.since ? `opening ${egpShort(c.opening)} · since ${fmtDate(c.since)}` : "count to set →"}</div>} />
        <Stat label="Money in" color="var(--green)" value={c ? egp(c.inflow) : "—"} />
        <Stat label="Money out" color="var(--red)" value={c ? egp(Math.abs(c.outflow)) : "—"} />
        <Stat label="Withdrawals" color="var(--amber)" value={c ? egp(c.withdrawals) : "—"} />
      </div>

      <div className="row2">
        <DeckTile style={{ padding: 0, display: "flex", flexDirection: "column", height: 460 }}>
          <div style={{ padding: "22px 24px 8px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="tname">Cash flow</span>
            <div className="seg" style={{ marginLeft: "auto" }}>
              {flowFilters.map((f) => <span key={f.v} className={filter === f.v ? "on" : ""} onClick={() => setFilter(f.v)}>{f.label}</span>)}
            </div>
          </div>
          <div className="scroll" style={{ flex: 1, maxHeight: "none" }}>
            {mv.isLoading ? <div style={{ padding: 16 }}><SkeletonRows /></div> : mv.isError ? <div style={{ padding: 16 }}><ErrorState message={String((mv.error as Error)?.message)} /></div> : (
              <table className="tbl">
                <thead><tr><th>Date</th><th>Flow</th><th className="r">Amount</th><th style={{ width: 34 }} /></tr></thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td>{fmtDate(m.date, "EEE d MMM yyyy")}</td>
                      <td style={{ textTransform: "capitalize" }}>{m.label} <span style={{ color: "rgb(var(--dim))", fontSize: 12 }}>· {KIND_LABEL[m.kind] ?? m.kind}</span></td>
                      <td className="r" style={{ color: m.amount >= 0 ? "var(--green)" : "var(--red)" }}>{m.amount >= 0 ? "+" : "−"}{egp(Math.abs(m.amount))}</td>
                      <td>{m.id.startsWith("mv-") ? <button onClick={() => setVoidMv(m.id.slice(3))} title="Void" style={{ color: "rgb(var(--faint))", background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>✕</button> : null}</td>
                    </tr>
                  ))}
                  {movements.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "rgb(var(--faint))", padding: 28 }}>No cash flow in this range.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        </DeckTile>

        <DeckTile style={{ height: 460, display: "flex", flexDirection: "column" }}>
          <TileHead name="Money in vs out" right="by month" />
          {allMonths.length === 0 ? <div style={{ fontSize: 12.5, color: "rgb(var(--faint))", padding: "10px 0" }}>No flow in range.</div> : (
            <>
              <div style={{ display: "flex", gap: 18, margin: "6px 0 12px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: "var(--green)" }}><span style={{ width: 11, height: 11, borderRadius: 3, background: "rgb(var(--good))" }} />Money in</span>
                <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: "var(--red)" }}><span style={{ width: 11, height: 11, borderRadius: 3, background: "rgb(var(--bad))" }} />Money out</span>
              </div>
              <div style={{ flex: 1, display: "flex", alignItems: "stretch", borderRadius: 18, padding: "12px 10px 6px", background: "linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.012))", border: "1px solid var(--stroke)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.06), 0 18px 40px -24px rgba(0,0,0,.85)" }}>
                <GroupedBarChart data={flowSeries} height={320} colorA="rgb(var(--good))" colorB="rgb(var(--bad))" labelA="Money in" labelB="Money out" />
              </div>
            </>
          )}
        </DeckTile>
      </div>

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
  const catData = [...cat.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
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
            <Stat label="Monthly avg spend" color="rgb(var(--violet))" value={em.length ? egp(total / em.length) : "—"} />
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
                        <td style={{ color: "rgb(var(--dim))" }}>{e.notes || "—"}</td>
                        <td className="r">{egp(e.amount)}</td>
                        <td><button onClick={() => setVoidId(e.id)} title="Void" style={{ color: "rgb(var(--faint))", cursor: "pointer", background: "none", border: "none", fontSize: 12 }} onMouseEnter={(ev) => (ev.currentTarget.style.color = "var(--red)")} onMouseLeave={(ev) => (ev.currentTarget.style.color = "rgb(var(--faint))")}>✕</button></td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "rgb(var(--faint))", padding: 28 }}>No expenses in this range.</td></tr>}
                  </tbody>
                </table>
              </div>
            </DeckTile>

            <div style={{ display: "flex", flexDirection: "column", gap: 16, height: 608 }}>
              <DeckTile><TileHead name="Monthly spend" right="in range" /><div style={{ marginTop: 12 }}><BarChart data={spendBars} height={170} color="rgb(var(--warn))" /></div></DeckTile>
              <DeckTile style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                <TileHead name="Top suppliers" />
                <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                  {byVen.length ? byVen.map(([k, v]) => (
                    <div className="lrow" key={k} style={{ cursor: "default" }}><div style={{ flex: 1 }}><div className="lname">{k}</div></div><div className="lamt">{egp(v)}</div></div>
                  )) : <div style={{ fontSize: 12.5, color: "rgb(var(--faint))", padding: "10px 0" }}>No suppliers in range.</div>}
                </div>
              </DeckTile>
            </div>
          </div>

          <DeckTile style={{ marginTop: 16 }}>
            <TileHead name="Spend by category" right="in range" />
            {catData.length ? <div style={{ marginTop: 8 }}><DonutChart data={catData} size={220} /></div> : <div style={{ fontSize: 12.5, color: "rgb(var(--faint))", padding: "10px 0" }}>No categories in range.</div>}
          </DeckTile>
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
        <div style={{ fontSize: 12.5, color: "rgb(var(--dim))", fontWeight: 600 }}>Cheques close the running sales tab — cross-referenced to your sales</div>
        <button className="qadd" style={{ height: 38, marginLeft: "auto" }} onClick={() => setAddOpen(true)}><span>+ Add cheque</span></button>
      </div>

      {c && c.openTab.revenue > 0 && (
        <div className="note" style={{ marginBottom: 16, background: "rgba(255,177,62,.08)", borderColor: "rgba(255,177,62,.25)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" /></svg>
          <div>Open tab: sales since the last cheque ({c.openTab.from ? fmtDate(c.openTab.from) : "—"} → {fmtDate(c.openTab.to)}) total <b style={{ color: "rgb(var(--text))" }}>{egp(c.openTab.revenue)}</b> over {c.openTab.days} days — the next cheque will close it.</div>
        </div>
      )}

      {cy.isLoading ? <SkeletonRows /> : (
        <>
          <div className="statgrid">
            <Stat label="Cheques logged" color="rgb(var(--cyan))" value={chq.length} />
            <Stat label="Total value" color="var(--mag)" value={egp(total)} />
            <Stat label="Average" color="rgb(var(--violet))" value={chq.length ? egp(avg) : "—"} />
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
                      <td style={{ color: "rgb(var(--dim))", fontSize: 12.5 }}>{ch.coverFrom ? `${fmtDate(ch.coverFrom, "d MMM")} → ${fmtDate(ch.coverTo, "d MMM")}${ch.deductionPct != null && ch.deductionPct >= 0 ? ` · ${ch.deductionPct}% cut` : ""}` : "opening cheque"}</td>
                      <td className="r" style={{ color: "var(--green)" }}>{egp(ch.amount)}</td>
                      <td><button onClick={() => setVoidId(ch.id)} title="Void" style={{ color: "rgb(var(--faint))", cursor: "pointer", background: "none", border: "none", fontSize: 12 }} onMouseEnter={(ev) => (ev.currentTarget.style.color = "var(--red)")} onMouseLeave={(ev) => (ev.currentTarget.style.color = "rgb(var(--faint))")}>✕</button></td>
                    </tr>
                  ))}
                  {chq.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "rgb(var(--faint))", padding: 28 }}>No cheques recorded yet.</td></tr>}
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

const MINI_BTN: CSSProperties = {
  padding: "3px 9px", borderRadius: 8, border: "1px solid var(--stroke)",
  background: "rgba(255,255,255,.04)", color: "rgb(var(--muted))", fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
};

// ── Settlements — monthly statement (READ-ONLY over the engine caches) ───────
/** Per month: revenue − flat rent − 3% charge = net expected, vs cheque
 *  received. Every figure is read from the trigger-maintained caches; the only
 *  write is an admin-triggered period status transition (never auto-reconcile). */
export function SettlementsScreen() {
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settlement-statements"], queryFn: getSettlementStatements, enabled: en });
  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: "received" | "reconciled" | "open" }) => setSettlementStatus(v.id, v.status),
    onSuccess: (_d, v) => { reportSuccess("Settlement status", `Period marked ${v.status}`); qc.invalidateQueries(); },
    onError: (e) => reportError("Settlement status", e),
  });
  if (!en) return <EmptyState title="Sign in to load settlements" />;
  const rows = q.data ?? [];
  const tol = (r: { revenue: number }) => Math.max(5, 0.005 * r.revenue); // reconciliation tolerance
  const totNet = rows.reduce((s, r) => s + r.netExpected, 0);
  const totRecv = rows.reduce((s, r) => s + (r.chequeReceived ?? 0), 0);
  const outstanding = rows.filter((r) => r.chequeReceived == null && r.netExpected > 0).reduce((s, r) => s + r.netExpected, 0);

  const STATUS_COLOR: Record<string, string> = { open: "rgb(var(--dim))", expected: "var(--amber)", received: "rgb(var(--cyan))", reconciled: "var(--green)" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 12.5, color: "rgb(var(--dim))", fontWeight: 600 }}>Revenue − flat rent − 3% charge = net expected, vs the cheque received</div>
      </div>
      {q.isLoading ? <SkeletonRows /> : q.isError ? <ErrorState message={String((q.error as Error)?.message)} /> : (
        <>
          <div className="statgrid">
            <Stat label="Months" color="rgb(var(--cyan))" value={rows.length} />
            <Stat label="Net expected · all" color="var(--mag)" value={egp(totNet)} />
            <Stat label="Cheques received · all" color="var(--green)" value={egp(totRecv)} />
            <Stat label="Outstanding (no cheque)" color="var(--amber)" value={egp(outstanding)} />
          </div>
          <DeckTile style={{ padding: 0 }}>
            <div style={{ padding: "22px 24px 8px" }}><span className="tname">Monthly settlement statement</span></div>
            <div className="scroll">
              <table className="tbl">
                <thead><tr>
                  <th>Month</th><th className="r">Revenue</th><th className="r">Rent</th><th className="r">3% charge</th>
                  <th className="r">Net expected</th><th className="r">Cheque received</th><th className="r">Difference</th><th>Status</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const ok = r.difference != null && Math.abs(r.difference) <= tol(r);
                    return (
                      <tr key={r.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.month, "MMM yyyy")}</td>
                        <td className="r">{egp(r.revenue)}</td>
                        <td className="r" style={{ color: "rgb(var(--dim))" }}>−{egp(r.rent)}</td>
                        <td className="r" style={{ color: "rgb(var(--dim))" }}>−{egp(r.charge)}{r.other ? ` −${egp(r.other)}` : ""}</td>
                        <td className="r" style={{ fontWeight: 700 }}>{egp(r.netExpected)}</td>
                        <td className="r">{r.chequeReceived != null ? egp(r.chequeReceived) : <span style={{ color: "rgb(var(--faint))" }}>— none —</span>}</td>
                        <td className="r" style={{ color: r.difference == null ? "rgb(var(--faint))" : ok ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                          {r.difference == null ? "—" : `${r.difference >= 0 ? "+" : "−"}${egp(Math.abs(r.difference))}`}
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ textTransform: "capitalize", color: STATUS_COLOR[r.status] ?? "rgb(var(--dim))", fontWeight: 600, fontSize: 12.5 }}>{r.status}</span>
                            {r.status !== "reconciled" && r.chequeReceived != null && (
                              <>
                                {r.status === "open" && <button style={MINI_BTN} disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: "received" })}>Mark received</button>}
                                <button style={MINI_BTN} disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: "reconciled" })}>Reconcile</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "rgb(var(--faint))", padding: 28 }}>No settlement periods yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </DeckTile>
        </>
      )}
    </div>
  );
}
