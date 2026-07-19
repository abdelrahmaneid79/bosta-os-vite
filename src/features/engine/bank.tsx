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
import { fmtDate } from "@/core/utils/date";
import { cn } from "@/core/utils/cn";
import { isEngineConfigured } from "@/core/db/engine";
import { useUI } from "@/store/ui";
import {
  getBankTxns, getBankMonths, getBankReversals, buildOverview,
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
  const [tab, setTab] = useState<"story" | "months" | "rows">("story");
  const [filter, setFilter] = useState<"all" | "business" | "personal" | "check">("all");
  const [edit, setEdit] = useState<BankTxn | null>(null);

  const txnsQ = useQuery({ queryKey: ["bank-txns"], queryFn: getBankTxns, enabled: en });
  const monthsQ = useQuery({ queryKey: ["bank-months"], queryFn: getBankMonths, enabled: en });
  const revQ = useQuery({ queryKey: ["bank-reversals"], queryFn: getBankReversals, enabled: en });

  const txns = txnsQ.data ?? [];
  const months = monthsQ.data ?? [];
  const reversals = revQ.data ?? [];
  const o = useMemo(() => buildOverview(txns, months, reversals), [txns, months, reversals]);

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
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted">
            {o.from && o.to ? `${fmtDate(o.from, "d MMM yyyy")} → ${fmtDate(o.to, "d MMM yyyy")}` : ""} · {o.movements} movements read from your SMS.
            You then drew {egp(o.cashOut)} more out at machines. Personal card spending across the whole period was {egp(o.personalSpend)}.
          </p>
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
        <Stat label="Cheque money in" value={egp(o.chequesNet)} color="rgb(var(--good))" sub={`${active.reduce((s, m) => s + m.chequeCount, 0)} cheques, after the mall's rent and commission`} />
        <Stat label="Reached the bank" value={egp(o.banked)} color="rgb(var(--teal))" sub={`${bankedPct}% of it`} />
        <Stat label="Kept as cash" value={egp(o.keptAsCash)} color="rgb(var(--pink))" sub="never entered this account" />
        <Stat label="Drawn out at machines" value={egp(o.cashOut)} color="rgb(var(--warn))" sub="on top of the cash you kept" />
      </div>

      <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-white/[0.09] bg-white/[0.04] p-1.5">
        {([["story", "The story"], ["months", "Month by month"], ["rows", `Every movement (${txns.length})`]] as const).map(([k, label]) => (
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
            <p className="mb-4 text-[13px] leading-relaxed text-muted">
              Two sources of cash — the part of each cheque you keep, and what you draw at machines.
              Between them they have to cover stock, wages and packaging. What is left over is what you took for yourself.
            </p>
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
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted">What it had to cover</div>
                <p className="mt-3 text-[13px] leading-relaxed text-muted">
                  Stock, wages and packaging come out of this cash — none of it is paid by card.
                  Compare it against the cost of what you actually sold on the Performance screen.
                </p>
              </div>
            </div>
          </DeckTile>

          <DeckTile>
            <TileHead name="Money in vs cash out, by month" />
            <GroupedBarChart data={flow} labelA="Banked" labelB="Cash out" colorA="rgb(var(--good))" colorB="rgb(var(--warn))" height={280} />
          </DeckTile>

          <div className="grid gap-5 lg:grid-cols-2">
            <DeckTile>
              <TileHead name="What the card was spent on" />
              <DonutChart data={mix} />
            </DeckTile>
            <DeckTile>
              <TileHead name="Failed ATM attempts" right={<span className="text-[12px] font-semibold text-muted">{reversals.length}</span>} />
              <p className="mb-3 text-[13px] leading-relaxed text-muted">
                The machine texts a debit, then reverses it. The money never left, so none of this counts as spending.
              </p>
              <div className="mb-3 rounded-2xl border border-white/[0.09] bg-white/[0.03] px-4 py-3">
                <div className="font-display text-xl text-text">{egp(o.reversedTotal)}</div>
                <div className="text-[12px] text-muted">
                  {reversals.filter((r) => r.refundConfirmed).length} of {reversals.length} confirmed refunded by the balance
                </div>
              </div>
              <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {reversals.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2 text-[13px]">
                    <span className="shrink-0 text-muted">{r.dayMonth}</span>
                    <span className="truncate text-muted">{r.merchant ?? ""}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-text">{egp(r.amount)}</span>
                    <span className={cn("shrink-0 text-[11px] font-bold", r.refundConfirmed ? "text-good" : "text-warn")}>
                      {r.refundConfirmed ? "refunded" : "can't tell"}
                    </span>
                  </div>
                ))}
              </div>
            </DeckTile>
          </div>

          <DeckTile>
            <TileHead name="How much of this to trust" />
            <div className="space-y-2.5 text-[13px] leading-relaxed text-muted">
              <p>
                Every SMS states the balance left after it, so the messages chain together. Where the chain is
                unbroken the figures are exact — nothing can hide. <span className="font-semibold text-text">{o.exactMonths} of {o.totalMonths} months</span> are like that.
              </p>
              <p>
                Where the recording skipped a message the chain breaks, and a cheque arriving and cash leaving in the
                same gap cancel each other out — only the net shows. Those months are marked below. It means
                "kept as cash" is a ceiling in those months, not an exact figure.
              </p>
              <p className="text-text">
                A bank statement would settle it completely. This is as far as the text messages can go.
              </p>
            </div>
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
            <p className="mb-3 text-[12px] text-muted">Tap any row to change what it counts as. Your change sticks — re-importing will not undo it.</p>
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
