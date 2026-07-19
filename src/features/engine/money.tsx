import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Stat, DeckTile, TileHead } from "./deck";
import { Modal } from "@/components/ui/Modal";
import { Confirm } from "@/components/ui/Confirm";
import { DonutChart, GroupedBarChart, BarChart } from "@/components/charts";
import { EmptyState, SkeletonRows, ErrorState } from "@/components/feedback";
import { DateRangePicker } from "@/components/DateRangePicker";
import { egp } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { cn } from "@/core/utils/cn";
import { isEngineConfigured } from "@/core/db/engine";
import { useActiveRange } from "@/store/filters";
import { getCashLedger, getCashSummary, getMoneyAccounts } from "@/core/read/money";
import { getBankMonths, getBurnMonths, summariseBurn } from "@/core/read/bank";
import { CountUp } from "@/components/ui/motion";
import { getChequeLedger } from "@/core/read/settlements";
import { getExpenses } from "@/core/read/expenses";
import { voidMovement, voidCheque, voidExpense } from "@/core/db/mutations";
import { CashForm, ChequeForm, ExpenseForm } from "./forms";
import { useUI } from "@/store/ui";

const en = isEngineConfigured;
const monthKey = (d: string) => d.slice(0, 7);
const KIND_LABEL: Record<string, string> = {
  cheque: "cheque in", withdrawal: "you took out", expense: "expense",
  purchase: "stock purchase", cash_in: "cash in", cash_out: "cash out",
};

/** The Cash screen only ever saw movements the owner typed in. The bank card
 *  knows what actually happened — how much of each cheque never reached the
 *  bank, and how much he takes out. This strip surfaces that here, where he
 *  looks for cash, and hands off to the full screen for the detail. */
function BankReality() {
  const nav = useNavigate();
  const months = useQuery({ queryKey: ["bank-months"], queryFn: getBankMonths, enabled: en });
  const burnQ = useQuery({ queryKey: ["owner-burn"], queryFn: getBurnMonths, enabled: en });
  const rows = (months.data ?? []).filter((m) => m.movements > 0);
  if (!rows.length) return null;
  const burn = summariseBurn(burnQ.data ?? []);
  const kept = rows.reduce((s2, m) => s2 + (m.chequesNet - m.banked), 0);
  const cashOut = rows.reduce((s2, m) => s2 + m.cashOut, 0);
  const over = burn.pctOfProfit != null && burn.pctOfProfit > 100;
  return (
    <DeckTile onClick={() => nav("/bank")} className="cursor-pointer">
      <TileHead name="From your bank card" right={<span className="text-[12px] font-semibold text-pink">Open →</span>} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Kept from cheques" value={egp(kept)} color="rgb(var(--pink))" sub="never reached the bank" />
        <Stat label="Drawn at machines" value={egp(cashOut)} color="rgb(var(--warn))" sub="cash for stock" />
        <Stat label="You take out" value={burn.months ? egp(burn.tookOutPerMonth) : "—"} color="rgb(var(--warn))" sub="a month, on average" />
        <Stat label="The business makes" value={burn.months ? egp(burn.profitPerMonth) : "—"} color={over ? "rgb(var(--bad))" : "rgb(var(--good))"}
          sub={burn.pctOfProfit != null ? `you take ${Math.round(burn.pctOfProfit)}% of it` : "a month"} />
      </div>
    </DeckTile>
  );
}

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
        <div style={{ flex: 1 }} />
        <DateRangePicker />
        <button className="addbtn" onClick={() => setSheet("withdraw")}>Withdraw</button>
        <button className="qadd" style={{ height: 38 }} onClick={() => setSheet("count")}><span>Count cash</span></button>
      </div>

      <div style={{ marginBottom: 16 }}><BankReality /></div>

      <div className="statgrid">
        <Stat label="Cash on hand" color="rgb(var(--cyan))" value={c ? (c.balance == null ? "—" : <CountUp value={c.balance} format={egp} />) : "—"} sub={<div style={{ fontSize: 11, color: "rgb(var(--dim))", fontWeight: 600, marginTop: 8 }}>{c?.since ? `counted ${fmtDate(c.since)}` : "count to set →"}</div>} />
        <Stat label="Money in" color="var(--green)" value={c ? <CountUp value={c.inflow} format={egp} /> : "—"} />
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
                      <td style={{ textTransform: "capitalize" }}>{m.label} <span style={{ color: "rgb(var(--dim))", fontSize: 12 }}>· {KIND_LABEL[m.kind] ?? m.kind.replace(/_/g, " ")}</span></td>
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
// A settlement cycle's colour by commission era — the mall's deal changed twice.
const chqEra = (start: string): string =>
  start <= "2025-05-31" ? "#F7A23B" : start <= "2025-08-31" ? "#2BD4C4" : "#ff4dbb";
const bareEgp = (n: number) => egp(n).replace("EGP ", "");

// Phone widths — the timeline becomes a swipeable strip instead of a squeeze.
function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width:767px)").matches);
  useEffect(() => {
    const m = window.matchMedia("(max-width:767px)");
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

export function ChequesScreen() {
  const [addOpen, setAddOpen] = useState(false);
  const [voidId, setVoidId] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [trace, setTrace] = useState("");
  const narrow = useNarrow();
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const led = useQuery({ queryKey: ["cheque-ledger"], queryFn: getChequeLedger, enabled: en });
  const del = useMutation({ mutationFn: (id: string) => voidCheque(id), onSuccess: () => { reportSuccess("Void cheque", "Cheque removed · kept for audit"); setVoidId(null); setActive(null); qc.invalidateQueries(); }, onError: (e) => reportError("Void cheque", e) });
  if (!en) return <EmptyState title="Sign in to load cheques" />;

  // Real settlement cheques, oldest → newest. The 3 × 32,000 nuts-deal payments
  // carry no cycle and are a separate stream, so they're excluded here.
  const rows = (led.data ?? [])
    .filter((c) => c.cycleStart && c.cycleEnd && Math.round(c.net) !== 32000)
    .sort((a, b) => (a.cycleStart as string).localeCompare(b.cycleStart as string));
  const totalReceived = rows.reduce((s, r) => s + r.net, 0);
  const totalDays = rows.reduce((s, r) => s + (r.cycleDays ?? 0), 0);
  const avgCycle = rows.length ? totalDays / rows.length : 0;
  const first = rows[0]?.cycleStart ?? undefined;
  const last = rows.length ? rows[rows.length - 1].cycleEnd ?? undefined : undefined;
  const detail = rows.find((c) => c.id === active) ?? (rows.length ? rows[rows.length - 1] : null);
  const traced = trace ? rows.find((c) => (c.cycleStart as string) <= trace && trace <= (c.cycleEnd as string)) ?? null : null;
  // The flat EGP 32,000 cheques (Banque Misr, historical) — a separate stream, not
  // tied to a sales cycle, so they sit apart from the settlement timeline.
  const flat = (led.data ?? [])
    .filter((c) => Math.round(c.net) === 32000)
    .sort((a, b) => (a.receivedDate ?? "").localeCompare(b.receivedDate ?? ""));
  const flatTotal = flat.reduce((s, r) => s + r.net, 0);

  return (
    <div>
      <div style={{ display: "flex", marginBottom: 16 }}>
        <button className="qadd" style={{ height: 38, marginLeft: "auto" }} onClick={() => setAddOpen(true)}><span>+ Add cheque</span></button>
      </div>

      {led.isLoading ? <SkeletonRows /> : led.isError ? <ErrorState message={String((led.error as Error)?.message ?? "Read failed")} /> : rows.length === 0 && flat.length === 0 ? (
        <EmptyState title="No cheques yet" hint="Add your first cheque" />
      ) : (
        <>
          <div className="statgrid">
            <Stat label="Settlement received" color="var(--green)" value={egp(totalReceived)} />
            <Stat label="Cheques" color="rgb(var(--cyan))" value={rows.length} />
            <Stat label="Days covered" color="var(--mag)" value={totalDays} />
            <Stat label="Avg cycle" color="var(--amber)" value={`${avgCycle.toFixed(1)} days`} />
          </div>

          <DeckTile>
            <div>
              <div className="tname">Settlement timeline</div>
              <div style={{ fontSize: 12, color: "rgb(var(--faint))", marginTop: 4 }}>{narrow ? "swipe across · tap a block" : "wider = more days · tap a block"}</div>
            </div>
            <div className="chq-legend" style={{ marginTop: 14 }}>
              <span><i style={{ background: "#F7A23B" }} /> Opening deal</span>
              <span><i style={{ background: "#2BD4C4" }} /> Rent begins</span>
              <span><i style={{ background: "#ff4dbb" }} /> Today&rsquo;s deal</span>
            </div>
            <div className="chq-scroll">
              <div className="chq-bar" style={narrow ? { width: "max-content" } : undefined} role="img" aria-label="Settlement cheques over time; block width shows days covered">
                {rows.map((c) => (
                  <button key={c.id} type="button"
                    className={cn("chq-seg", active === c.id && "on")}
                    style={narrow
                      ? { width: Math.max(22, (c.cycleDays ?? 1) * 3), flexShrink: 0, background: chqEra(c.cycleStart as string) }
                      : { flexGrow: c.cycleDays ?? 1, background: chqEra(c.cycleStart as string) }}
                    onMouseEnter={() => setActive(c.id)} onFocus={() => setActive(c.id)} onClick={() => setActive(c.id)}
                    aria-label={`${egp(c.net)} received ${c.receivedDate ? fmtDate(c.receivedDate, "d MMM yyyy") : "—"}`} />
                ))}
              </div>
            </div>
            <div className="chq-axis"><span>{first ? fmtDate(first, "MMM yyyy") : ""}</span><span>{last ? fmtDate(last, "MMM yyyy") : ""}</span></div>

            {detail && (
              <div className="chq-detail">
                <div className="amt"><small>EGP</small>{bareEgp(detail.net)}</div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div className="win"><span className="dot" style={{ background: chqEra(detail.cycleStart as string) }} />Received <b>{detail.receivedDate ? fmtDate(detail.receivedDate, "d MMM yyyy") : "—"}</b> · covers <b>{fmtDate(detail.cycleStart as string, "d MMM yyyy")} – {fmtDate(detail.cycleEnd as string, "d MMM yyyy")}</b> · {detail.cycleDays} days</div>
                  {detail.gross != null && (
                    <div className="sub">{detail.deductions ? `Sales EGP ${bareEgp(detail.gross)} · mall kept EGP ${bareEgp(detail.deductions)}` : "Matches your sales"}</div>
                  )}
                </div>
                <button className="mbtn" onClick={() => setVoidId(detail.id)}>Void</button>
              </div>
            )}
          </DeckTile>

          <DeckTile>
            <div>
              <div className="tname">Trace a day</div>
              <div style={{ fontSize: 12, color: "rgb(var(--faint))", marginTop: 4 }}>which cheque paid for a day</div>
            </div>
            <input type="date" className="chq-trace-in" style={{ marginTop: 14 }} value={trace} min={first} max={last} onChange={(e) => setTrace(e.target.value)} />
            <div className="chq-answer">
              {!trace ? "Pick a day above."
                : traced ? (
                  <>Paid by your <span className="hl">{egp(traced.net)}</span> cheque, received <b>{traced.receivedDate ? fmtDate(traced.receivedDate, "d MMM yyyy") : "—"}</b> · covers <b>{fmtDate(traced.cycleStart as string, "d MMM yyyy")} – {fmtDate(traced.cycleEnd as string, "d MMM yyyy")}</b>.</>
                ) : "Not settled yet — still on the open tab."}
            </div>
          </DeckTile>

          {flat.length > 0 && (
            <DeckTile>
              <div>
                <div className="tname">Flat 32,000 cheques</div>
                <div style={{ fontSize: 12, color: "rgb(var(--faint))", marginTop: 4 }}>Separate stream · {egp(flatTotal)}</div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
                {flat.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", borderRadius: 12, border: "1px solid var(--stroke)", background: "var(--surface2)" }}>
                    <span style={{ width: 9, height: 9, borderRadius: 999, background: "#7c6cff", flexShrink: 0 }} />
                    <span style={{ fontWeight: 700 }}>{egp(c.net)}</span>
                    <span style={{ fontSize: 12.5, color: "rgb(var(--dim))" }}>received {c.receivedDate ? fmtDate(c.receivedDate, "d MMM yyyy") : "—"}</span>
                    <button className="mbtn" style={{ marginLeft: 2 }} onClick={() => setVoidId(c.id)}>Void</button>
                  </div>
                ))}
              </div>
            </DeckTile>
          )}
        </>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Record cheque"><ChequeForm onDone={() => setAddOpen(false)} /></Modal>
      <Confirm open={!!voidId} title="Void this cheque?" danger busy={del.isPending}
        message="Removed from cheque totals and cash in; kept for audit." confirmLabel="Void"
        onConfirm={() => voidId && del.mutate(voidId)} onClose={() => setVoidId(null)} />
    </div>
  );
}
