/** Bank card — what the bank saw, next to what the cheque book says.
 *
 *  The story this screen has to tell, in the order it needs telling:
 *    1. The mall pays you X. You put Y of it in the bank and kept the rest.
 *    2. You then drew more cash out to buy stock.
 *    3. Almost none of this card is personal spending.
 *  Everything else is detail behind that.
 *
 *  Honesty rules baked into the layout: any month whose SMS chain has a break
 *  is marked, because in those months a deposit going in and cash coming out
 *  cancel each other and only the net is visible. Months with an intact chain
 *  are exact and say so. Nothing here is estimated or filled in.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Stat, DeckTile, TileHead } from "./deck";
import { Modal } from "@/components/ui/Modal";
import { GroupedBarChart, DonutChart } from "@/components/charts";
import { EmptyState, SkeletonRows, ErrorState } from "@/components/feedback";
import { egp } from "@/core/utils/format";
import { CountUp } from "@/components/ui/motion";
import { fmtDate } from "@/core/utils/date";
import { cn } from "@/core/utils/cn";
import { isEngineConfigured } from "@/core/db/engine";
import { useUI } from "@/store/ui";
import {
  getBankTxns, getBankMonths, getBankReversals, buildOverview,
  getBurnMonths, summariseBurn,
  BANK_CATEGORIES, catLabel, type BankTxn, type BankSide,
} from "@/core/read/bank";
import { setBankCategory, setBankNote } from "@/core/db/mutations";

const en = isEngineConfigured;

const SIDE_STYLE: Record<BankSide, string> = {
  business: "bg-good/15 text-good ring-good/25",
  personal: "bg-pink/12 text-pink ring-pink/25",
  check:    "bg-warn/15 text-warn ring-warn/25",
  ignore:   "bg-white/[0.06] text-muted ring-white/10",
};
const SIDE_LABEL: Record<BankSide, string> = {
  business: "Business", personal: "Personal", check: "Check this", ignore: "Ignore",
};

function Pill({ side }: { side: BankSide }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-bold ring-1", SIDE_STYLE[side])}>
      {SIDE_LABEL[side]}
    </span>
  );
}

export function BankScreen() {
  const qc = useQueryClient();
  const { reportSuccess, reportError } = useUI();
  const [tab, setTab] = useState<"story" | "burn" | "months" | "rows">("story");
  const [filter, setFilter] = useState<"all" | "business" | "personal" | "check">("all");
  const [edit, setEdit] = useState<BankTxn | null>(null);

  const txnsQ = useQuery({ queryKey: ["bank-txns"], queryFn: getBankTxns, enabled: en });
  const monthsQ = useQuery({ queryKey: ["bank-months"], queryFn: getBankMonths, enabled: en });
  const revQ = useQuery({ queryKey: ["bank-reversals"], queryFn: getBankReversals, enabled: en });
  const burnQ = useQuery({ queryKey: ["owner-burn"], queryFn: getBurnMonths, enabled: en });

  const txns = txnsQ.data ?? [];
  const months = monthsQ.data ?? [];
  const reversals = revQ.data ?? [];
  const o = useMemo(() => buildOverview(txns, months, reversals), [txns, months, reversals]);
  const burnRows = burnQ.data ?? [];
  const burn = useMemo(() => summariseBurn(burnRows), [burnRows]);

  const save = useMutation({
    mutationFn: ({ id, category, side }: { id: string; category: string; side: BankSide }) => setBankCategory(id, category, side),
    onSuccess: () => { reportSuccess("Recategorised", "Saved — the import will not overwrite it"); setEdit(null); qc.invalidateQueries({ queryKey: ["bank-txns"] }); qc.invalidateQueries({ queryKey: ["bank-months"] }); },
    onError: (e) => reportError("Recategorise", e),
  });
  const note = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => setBankNote(id, text),
    onSuccess: () => { reportSuccess("Note saved", "Saved"); qc.invalidateQueries({ queryKey: ["bank-txns"] }); },
    onError: (e) => reportError("Save note", e),
  });

  if (!en) return <EmptyState title="Sign in to load the bank card" />;
  if (txnsQ.isLoading || monthsQ.isLoading) return <SkeletonRows rows={8} />;
  if (txnsQ.error) return <ErrorState message={(txnsQ.error as Error).message} onRetry={() => void txnsQ.refetch()} />;
  if (!txns.length) return <EmptyState title="No bank data loaded yet" hint="The card ****8300 SMS history has not been imported." />;

  const active = months.filter((m) => m.movements > 0);
  const bankedPct = o.chequesNet > 0 ? Math.round((100 * o.banked) / o.chequesNet) : 0;
  const rows = txns.filter((t) => filter === "all" || t.side === filter);

  const flow = active.map((m) => ({
    label: fmtDate(m.month + "-01", "MMM ''yy"),
    full: fmtDate(m.month + "-01", "MMM yyyy"),
    a: Math.round(m.banked),
    b: Math.round(m.cashOut),
  }));
  const mix = BANK_CATEGORIES
    .map((c) => ({ label: c.label, value: Math.round(txns.filter((t) => t.category === c.key && t.direction === "debit").reduce((s, t) => s + t.amount, 0)) }))
    .filter((d) => d.value > 0).sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-5">
      {/* ── headline: the one sentence that matters ─────────────────────── */}
      <DeckTile className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-pink/15 blur-3xl" />
        <div className="relative">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Banque Misr · card ****8300</div>
          <h2 className="mt-1 font-display text-2xl leading-tight text-text sm:text-[28px]">
            The mall paid you {egp(o.chequesNet)}. You banked {egp(o.banked)} of it
            <span className="text-muted"> and kept </span>
            <span className="text-pink">{egp(o.keptAsCash)}</span>
            <span className="text-muted"> as cash.</span>
          </h2>
          <div className="mt-3 flex flex-wrap gap-2 text-[12px] font-semibold">
            {o.from && o.to && <span className="rounded-full bg-white/[0.06] px-3 py-1.5 text-muted">{fmtDate(o.from, "MMM yy")} → {fmtDate(o.to, "MMM yy")}</span>}
            <span className="rounded-full bg-white/[0.06] px-3 py-1.5 text-muted">{o.movements} movements</span>
            <span className="rounded-full bg-white/[0.06] px-3 py-1.5 text-muted">personal card {egp(o.personalSpend)}</span>
          </div>
          <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full rounded-full bg-gradient-to-r from-good to-teal transition-[width] duration-500" style={{ width: `${Math.min(100, bankedPct)}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] font-semibold">
            <span className="text-good">{bankedPct}% banked</span>
            <span className="text-pink">{100 - bankedPct}% kept as cash</span>
          </div>
        </div>
      </DeckTile>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Cheque money in" value={<CountUp value={o.chequesNet} format={egp} />} color="rgb(var(--good))" sub={`${active.reduce((s, m) => s + m.chequeCount, 0)} cheques, after the mall's rent and commission`} />
        <Stat label="Reached the bank" value={<CountUp value={o.banked} format={egp} />} color="rgb(var(--teal))" sub={`${bankedPct}% of it`} />
        <Stat label="Kept as cash" value={<CountUp value={o.keptAsCash} format={egp} />} color="rgb(var(--pink))" sub="never entered this account" />
        <Stat label="Drawn out at machines" value={<CountUp value={o.cashOut} format={egp} />} color="rgb(var(--warn))" sub="on top of the cash you kept" />
      </div>

      <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-white/[0.09] bg-white/[0.04] p-1.5">
        {([["story", "The story"], ["burn", "What you took out"], ["months", "Month by month"], ["rows", `Every movement (${txns.length})`]] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={cn("rounded-xl px-4 py-2 text-[13px] font-semibold transition active:scale-95 motion-reduce:active:scale-100",
              tab === k ? "bg-gradient-to-br from-pink to-violet text-white shadow-pink" : "text-muted hover:text-text")}>
            {label}
          </button>
        ))}
      </div>

      {tab === "story" && (
        <div className="space-y-5">
          <DeckTile>
            <TileHead name="Where the cash goes" />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-good/20 bg-good/[0.06] p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-good">Cash you handled</div>
                <div className="mt-3 space-y-2 text-[13px]">
                  <Line label="Kept from cheques" value={o.keptAsCash} />
                  <Line label="Drawn at machines" value={o.cashOut} />
                  <Line label="Total" value={o.keptAsCash + o.cashOut} strong />
                </div>
              </div>
              <div className="rounded-2xl border border-white/[0.09] bg-white/[0.03] p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted">It had to cover</div>
                <div className="mt-3 space-y-2 text-[13px]">
                  <div className="flex justify-between"><span className="text-muted">Stock</span><span className="font-semibold text-text">paid in cash</span></div>
                  <div className="flex justify-between"><span className="text-muted">Wages</span><span className="font-semibold text-text">paid in cash</span></div>
                  <div className="flex justify-between"><span className="text-muted">Packaging</span><span className="font-semibold text-text">paid in cash</span></div>
                  <button type="button" onClick={() => setTab("burn")} className="mt-1 w-full rounded-xl bg-white/[0.05] px-3 py-2 text-left text-[12.5px] font-bold text-pink transition hover:bg-white/[0.08]">What was left → </button>
                </div>
              </div>
            </div>
          </DeckTile>

          <DeckTile>
            <TileHead name="Money in vs cash out, by month" />
            <GroupedBarChart data={flow} labelA="Banked" labelB="Cash out" colorA="rgb(var(--good))" colorB="rgb(var(--warn))" height={280} />
          </DeckTile>

          <DeckTile>
            <TileHead name="What the card was spent on" />
            <DonutChart data={mix} />
          </DeckTile>

          <DeckTile>
            <TileHead name="How exact is this" />
            <div className="space-y-1.5">
              <div className="flex items-center justify-between rounded-xl bg-good/[0.07] px-4 py-3">
                <span className="text-[13px] font-semibold text-text">Exact months</span>
                <span className="text-[13px] font-bold tabular-nums text-good">{o.exactMonths} of {o.totalMonths}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-warn/[0.07] px-4 py-3">
                <span className="text-[13px] font-semibold text-text">Months with gaps</span>
                <span className="text-[12px] font-bold text-warn">kept = ceiling</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-4 py-3">
                <span className="text-[13px] font-semibold text-text">To settle it fully</span>
                <span className="text-[12px] font-bold text-muted">bank statement</span>
              </div>
            </div>
          </DeckTile>
        </div>
      )}

      {tab === "burn" && (
        <div className="space-y-5">
          <DeckTile className="relative overflow-hidden">
            <div className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-warn/12 blur-3xl" />
            <div className="relative">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Over {burn.months} months</div>
              <h3 className="mt-1 font-display text-2xl leading-tight text-text sm:text-[28px]">
                The business made {egp(burn.profitPerMonth)} a month.
                <br className="hidden sm:block" /> You took out{" "}
                <span className={cn(burn.pctOfProfit != null && burn.pctOfProfit > 100 ? "text-bad" : "text-warn")}>
                  {egp(burn.tookOutPerMonth)}
                </span>.
              </h3>
              {burn.pctOfProfit != null && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3.5 py-1.5 text-[12.5px] font-bold">
                  <span className={cn(burn.pctOfProfit > 100 ? "text-bad" : "text-warn")}>{Math.round(burn.pctOfProfit)}% of profit</span>
                  <span className="text-muted">·</span>
                  <span className="text-muted">{burn.pctOfProfit > 98 ? "no cushion left in" : "rest stays in"}</span>
                </div>
              )}
              <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                <div className="h-full bg-gradient-to-r from-warn to-pink" style={{ width: `${Math.min(100, burn.pctOfProfit ?? 0)}%` }} />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] font-semibold">
                <span className="text-muted">what you took</span>
                <span className="text-muted">what the business made</span>
              </div>
            </div>
          </DeckTile>

          <div className="grid gap-5 lg:grid-cols-2">
            <DeckTile>
              <TileHead name="What the business earned" />
              <div className="space-y-2 text-[13px]">
                <Line label="Sales" value={burn.revenue} />
                <Line label="Less the mall's rent and commission" value={-burn.mallDeductions} />
                <Line label="Less what the stock cost you" value={-burn.cogs} />
                <Line label="Less wages, packaging, the rest" value={-burn.runningCosts} />
                <Line label="Profit" value={burn.profit} strong />
              </div>
            </DeckTile>
            <DeckTile>
              <TileHead name="What you actually took" />
              <div className="space-y-2 text-[13px]">
                <Line label="Cash you had (kept + drawn)" value={burn.cashAvailable} />
                <Line label="Less what the business needed" value={-burn.cashTheBusinessNeeded} />
                <Line label="Cash left over" value={burn.drawings} />
                <Line label="Plus personal card spending" value={burn.personalCardSpend} />
                <Line label="Taken out" value={burn.tookOut} strong />
              </div>
            </DeckTile>
          </div>

          <DeckTile>
            <TileHead name="Month by month" />
            <p className="mb-3 text-[12px] font-semibold text-muted">Months swing on stock timing. Read the year.</p>
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="border-b border-white/[0.09] text-left text-[11px] uppercase tracking-wider text-muted">
                    <th className="px-3 py-2.5 font-bold">Month</th>
                    <th className="px-3 py-2.5 text-right font-bold">Profit</th>
                    <th className="px-3 py-2.5 text-right font-bold">You took</th>
                    <th className="px-3 py-2.5 font-bold" />
                  </tr>
                </thead>
                <tbody>
                  {burnRows.filter((r) => !r.cogsMissing && (r.revenue > 0 || r.cashAvailable > 0)).map((r) => {
                    const took = r.drawingsResidual + r.personalCardSpend;
                    return (
                      <tr key={r.month} className="border-b border-white/[0.05] last:border-0">
                        <td className="px-3 py-2.5 font-semibold text-text">{fmtDate(r.month + "-01", "MMM yyyy")}</td>
                        <td className={cn("px-3 py-2.5 text-right tabular-nums", r.profit < 0 ? "text-bad" : "text-good")}>{egp(r.profit)}</td>
                        <td className={cn("px-3 py-2.5 text-right tabular-nums", took > r.profit ? "font-semibold text-warn" : "text-muted")}>{egp(took)}</td>
                        <td className="px-3 py-2.5 text-[11px] text-muted">
                          {took > r.profit ? "took more than it made" : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {burn.excludedMonths > 0 && (
              <p className="mt-3 text-[12px] text-muted">
                {burn.excludedMonths} month{burn.excludedMonths > 1 ? "s are" : " is"} left out — sales are recorded
                but the product breakdown is not, so there is no cost of sales to subtract and the profit would be nonsense.
              </p>
            )}
          </DeckTile>

          <DeckTile>
            <TileHead name="Could shrink this number" />
            <div className="space-y-1.5">
              <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-4 py-3">
                <span className="text-[13px] font-semibold text-text">Stock bought, not yet sold</span>
                <span className="text-[12px] font-bold text-warn">not tracked yet</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-4 py-3">
                <span className="text-[13px] font-semibold text-text">Wages on file</span>
                <span className="text-[13px] font-bold tabular-nums text-warn">{egp(45950)} / 13 mo</span>
              </div>
            </div>
            <p className="mt-3 text-[12px] font-semibold text-muted">Record purchases and wages → this becomes exact.</p>
          </DeckTile>
        </div>
      )}

      {tab === "months" && (
        <DeckTile>
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-white/[0.09] text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-3 py-2.5 font-bold">Month</th>
                  <th className="px-3 py-2.5 text-right font-bold">Cheques</th>
                  <th className="px-3 py-2.5 text-right font-bold">Banked</th>
                  <th className="px-3 py-2.5 text-right font-bold">Kept as cash</th>
                  <th className="px-3 py-2.5 text-right font-bold">Cash out</th>
                  <th className="px-3 py-2.5 text-right font-bold">Personal</th>
                  <th className="px-3 py-2.5 font-bold">Reliability</th>
                </tr>
              </thead>
              <tbody>
                {active.map((m) => {
                  const pct = m.chequesNet > 0 ? Math.round((100 * m.banked) / m.chequesNet) : null;
                  return (
                    <tr key={m.month} className="border-b border-white/[0.05] last:border-0">
                      <td className="px-3 py-2.5 font-semibold text-text">{fmtDate(m.month + "-01", "MMM yyyy")}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">{m.chequesNet ? egp(m.chequesNet) : "—"}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-good">{m.banked ? egp(m.banked) : "—"}</td>
                      {/* A negative figure is real and worth showing: more arrived
                          than this month's cheques, because a cheque from the month
                          before landed here. Clamping it to zero would hide that. */}
                      <td className={cn("px-3 py-2.5 text-right tabular-nums", m.keptAsCash > 0 ? "font-semibold text-pink" : "text-muted")}>
                        {!m.chequesNet ? "—" : m.keptAsCash < 0
                          ? <span title="A cheque from the previous month landed in this one">+{egp(-m.keptAsCash)} early</span>
                          : <>{egp(m.keptAsCash)}{pct != null && <span className="ml-1.5 text-[11px] text-muted">{pct}% in</span>}</>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-warn">{m.cashOut ? egp(m.cashOut) : "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">{m.personalSpend ? egp(m.personalSpend) : "—"}</td>
                      <td className="px-3 py-2.5">
                        {m.unreadableBreaks === 0
                          ? <span className="text-[12px] font-semibold text-good">exact</span>
                          : <span className="text-[12px] text-warn">{m.unreadableBreaks} gap{m.unreadableBreaks > 1 ? "s" : ""} — kept is a ceiling</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DeckTile>
      )}

      {tab === "rows" && (
        <div className="space-y-4">
          <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-white/[0.09] bg-white/[0.04] p-1.5">
            {([["all", "All"], ["business", "Business"], ["personal", "Personal"], ["check", "Check these"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter(k)}
                className={cn("rounded-xl px-3.5 py-1.5 text-[12px] font-semibold transition active:scale-95 motion-reduce:active:scale-100",
                  filter === k ? "bg-white/[0.12] text-text" : "text-muted hover:text-text")}>
                {label}
              </button>
            ))}
          </div>
          <DeckTile>
            <p className="mb-3 text-[12px] font-semibold text-muted">Tap a row to recategorise. Edits stick.</p>
            <div className="space-y-1">
              {rows.slice(0, 400).map((t) => (
                <button key={t.id} type="button" onClick={() => setEdit(t)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.05] active:scale-[0.995] motion-reduce:active:scale-100">
                  <div className="w-[74px] shrink-0 text-[12px] tabular-nums text-muted">{t.date ? fmtDate(t.date, "d MMM ''yy") : "—"}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-text">{t.merchant ?? "(name never on screen)"}</div>
                    <div className="truncate text-[11px] text-muted">
                      {catLabel(t.category)}
                      {t.place ? ` · ${t.place}` : ""}
                      {t.edited ? " · you set this" : ""}
                      {t.balanceDerived ? " · balance worked out, not read" : ""}
                      {t.note ? ` · ${t.note}` : ""}
                    </div>
                  </div>
                  {t.depositAmount != null && (
                    <span className="shrink-0 rounded-full bg-good/15 px-2 py-0.5 text-[11px] font-bold text-good">
                      +{egp(t.depositAmount)} in
                    </span>
                  )}
                  <Pill side={t.side} />
                  <div className="w-[92px] shrink-0 text-right text-[13px] font-semibold tabular-nums text-text">
                    {t.direction === "credit" ? "+" : "−"}{egp(t.amount)}
                  </div>
                </button>
              ))}
            </div>
            {rows.length > 400 && <p className="mt-3 text-center text-[12px] text-muted">Showing the first 400 of {rows.length}.</p>}
          </DeckTile>
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.merchant ?? "Movement"}>
        {edit && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white/[0.04] px-4 py-3 text-[13px]">
              <div className="flex justify-between"><span className="text-muted">Date</span><span className="font-semibold text-text">{edit.date ? fmtDate(edit.date, "d MMM yyyy") : "unknown"}</span></div>
              <div className="mt-1 flex justify-between"><span className="text-muted">Amount</span><span className="font-semibold tabular-nums text-text">{egp(edit.amount)}</span></div>
              <div className="mt-1 flex justify-between"><span className="text-muted">Balance after</span><span className="tabular-nums text-muted">{egp(edit.balanceAfter)}</span></div>
              {edit.place && <div className="mt-1 flex justify-between"><span className="text-muted">Where</span><span className="text-muted">{edit.place}</span></div>}
            </div>
            <div>
              <div className="mb-2 text-[12px] font-bold uppercase tracking-wider text-muted">Counts as</div>
              <div className="grid grid-cols-2 gap-1.5">
                {BANK_CATEGORIES.map((c) => (
                  <button key={c.key} type="button" disabled={save.isPending}
                    onClick={() => save.mutate({ id: edit.id, category: c.key, side: c.side })}
                    className={cn("rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition active:scale-95 motion-reduce:active:scale-100 disabled:opacity-50",
                      edit.category === c.key ? "bg-gradient-to-br from-pink to-violet text-white shadow-pink" : "bg-white/[0.05] text-muted hover:text-text")}>
                    {c.label}
                    {c.hint && <span className="mt-0.5 block text-[10px] font-normal opacity-70">{c.hint}</span>}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-bold uppercase tracking-wider text-muted" htmlFor="bank-note">Note</label>
              <input id="bank-note" defaultValue={edit.note ?? ""} placeholder="What was this?"
                onBlur={(e) => { if (e.target.value !== (edit.note ?? "")) note.mutate({ id: edit.id, text: e.target.value }); }}
                className="w-full rounded-xl border border-white/[0.1] bg-white/[0.04] px-3.5 py-2.5 text-[14px] text-text outline-none placeholder:text-muted/60 focus:border-pink/50" />
            </div>
            {edit.raw && <p className="rounded-xl bg-white/[0.03] px-3.5 py-2.5 text-[11px] leading-relaxed text-muted">{edit.raw}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Line({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between", strong && "border-t border-white/[0.09] pt-2 font-bold")}>
      <span className={strong ? "text-text" : "text-muted"}>{label}</span>
      <span className="tabular-nums text-text">{egp(value)}</span>
    </div>
  );
}
