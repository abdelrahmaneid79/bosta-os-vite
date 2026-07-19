/** BREAK-EVEN PANEL — the daily "am I actually earning yet?" answer.
 *
 *  Hierarchy is deliberate: ONE hero number (what's still needed, or what's
 *  been earned), then the bar that gives it context, then the three levers
 *  (days left, daily rate required, value of extra sales). Status is carried by
 *  a labelled chip AND an icon, never by colour alone. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DeckTile } from "./deck";
import { SkeletonRows, ErrorState } from "@/components/feedback";
import { egp } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { cn } from "@/core/utils/cn";
import { isEngineConfigured } from "@/core/db/engine";
import { getBreakEven, type BreakEvenSnapshot, type BreakEvenDay } from "@/core/read/break-even";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const bare = (n: number) => egp(n).replace("EGP ", "");

/** Status is a word + a shape, so it reads without relying on colour. */
function statusOf(b: BreakEvenSnapshot): { label: string; colour: string; icon: string } {
  if (b.profit > 0) return { label: "Profitable", colour: "var(--green)", icon: "M20 6L9 17l-5-5" };
  if (b.progressPct >= 85) return { label: "Nearly there", colour: "var(--amber)", icon: "M12 8v5M12 16h.01" };
  return { label: "Below break-even", colour: "var(--red)", icon: "M12 8v5M12 16h.01" };
}

function Metric({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="be-metric">
      <div className="be-metric-v tnum">{value}</div>
      <div className="be-metric-l">{label}</div>
      {hint && <div className="be-metric-h">{hint}</div>}
    </div>
  );
}

export function BreakEvenPanel() {
  const q = useQuery({ queryKey: ["break-even"], queryFn: getBreakEven, enabled: isEngineConfigured });
  const [sel, setSel] = useState<BreakEvenDay | null>(null);
  if (!isEngineConfigured) return null;
  if (q.isLoading) return <DeckTile><SkeletonRows rows={3} /></DeckTile>;
  if (q.isError) return <DeckTile><ErrorState message={String((q.error as Error)?.message ?? "Could not load break-even")} /></DeckTile>;
  const b = q.data!;
  const s = statusOf(b);
  const monthName = MONTHS[Number(b.month.slice(5, 7)) - 1];
  const pastBreakEven = b.profit > 0;
  const barPct = Math.min(100, Math.max(0, b.progressPct));
  // scale the day columns against the best day, so the shape of the month reads
  const peak = b.days.reduce((m, d) => Math.max(m, d.revenue), 0);
  // Where the month SHOULD be by today if break-even were earned evenly —
  // the tick the fill has to keep up with. Clamped so the label stays on-card.
  const pacePct = b.daysInMonth > 0
    ? Math.min(96, Math.max(4, (b.daysElapsed / b.daysInMonth) * 100)) : null;
  // Two thresholds now live on one bar: covering the costs, and covering the
  // costs PLUS what he actually takes out. Scale to the further of the two so
  // neither marker leaves the track.
  const d = b.ownerDraw;
  const axisTop = Math.max(b.breakEvenRevenue, d?.target ?? 0);
  const scaledPct = axisTop > 0 ? Math.min(100, (b.revenue / axisTop) * 100) : 0;
  const drawMarkPct = d && axisTop > 0 ? Math.min(99, (d.target / axisTop) * 100) : null;

  return (
    <DeckTile>
      <div className="be" style={{ "--be-c": s.colour } as React.CSSProperties}>
      <div className="be-head">
        <span className="tname">Break-even · {monthName}</span>
        <span className="be-chip" style={{ color: s.colour, borderColor: s.colour }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" /><path d={s.icon} />
          </svg>
          {s.label}
        </span>
      </div>

      {/* HERO — the one number worth reading first */}
      <div className="be-hero">
        <div className="be-hero-v tnum" style={pastBreakEven
          ? { color: "var(--green)", textShadow: "0 0 28px rgba(66,226,154,.35)" }
          : { color: "rgb(var(--text))" }}>
          <small>EGP</small>{bare(pastBreakEven ? b.profit : b.revenueStillNeeded)}
        </div>
        <div className="be-hero-l">
          {pastBreakEven ? "earned so far this month" : "more to sell before you earn anything"}
        </div>
      </div>

      {/* THE MONTH, DAY BY DAY — one column per day, height = that day's take.
          Hover or tap any day to see where the month stood after it. */}
      <div className="be-run">
        <div className="be-days" role="img"
          aria-label={`${bare(b.revenue)} of ${bare(b.breakEvenRevenue)} break-even reached, ${barPct} percent, day ${b.daysElapsed} of ${b.daysInMonth}`}>
          {b.days.map((d) => {
            const h = peak > 0 ? Math.max(6, Math.round((d.revenue / peak) * 100)) : 6;
            const isToday = d.day === b.daysElapsed;
            return (
              <button type="button" key={d.date}
                className={cn("be-day", d.isFuture && "future", isToday && "today", sel?.day === d.day && "sel")}
                style={{ "--h": `${d.isFuture ? 6 : h}%` } as React.CSSProperties}
                onMouseEnter={() => setSel(d)} onFocus={() => setSel(d)}
                onMouseLeave={() => setSel(null)} onBlur={() => setSel(null)}
                onClick={() => setSel((c) => (c?.day === d.day ? null : d))}
                aria-label={`${d.day} ${monthName}: ${d.isFuture ? "not yet" : `${bare(d.revenue)} sold, ${bare(d.cumulative)} for the month`}`}>
                <i />
              </button>
            );
          })}
        </div>

        {/* the progress line itself — its own layer under the days.
            The bar is scaled to whichever target is further out, so the two
            thresholds can sit on one line without either falling off it. */}
        <div className="be-bar">
          <i style={{ width: `${scaledPct}%` }} />
          {pacePct != null && !pastBreakEven && (
            <span className="be-tick" style={{ left: `${pacePct}%` }} aria-hidden="true" />
          )}
          {drawMarkPct != null && (
            <span className="be-mark" style={{ left: `${drawMarkPct}%` }}
              title={`${bare(d!.target)} covers costs and the ${bare(d!.perMonth)} you take out`} aria-hidden="true" />
          )}
        </div>
      </div>

      {/* one readout that swaps between the month and the picked day */}
      <div className="be-read tnum">
        {sel ? (
          <>
            <b>{fmtDate(sel.date)}</b>
            {sel.isFuture ? <span>still to come</span> : (
              <>
                <span>{bare(sel.revenue)} sold</span>
                <span>{bare(sel.cumulative)} by then</span>
                <span className={sel.cumulative >= sel.pace ? "ok" : "behind"}>
                  {sel.cumulative >= sel.pace ? "on pace" : `${bare(sel.pace - sel.cumulative)} behind pace`}
                </span>
              </>
            )}
          </>
        ) : (
          <>
            <b>Day {b.daysElapsed} of {b.daysInMonth}</b>
            <span>{bare(b.revenue)} sold</span>
            <span>{bare(b.breakEvenRevenue)} needed</span>
          </>
        )}
      </div>

      <div className="be-scale tnum" hidden>
        <span>{bare(b.revenue)} sold</span>
        <span>{bare(b.breakEvenRevenue)} needed</span>
      </div>

      <div className="be-metrics">
        <Metric value={`${b.daysRemaining}`} label={b.daysRemaining === 1 ? "day left" : "days left"} hint={`of ${b.daysInMonth}`} />
        <Metric
          value={b.requiredDailyRunRate != null ? bare(b.requiredDailyRunRate) : "—"}
          label="needed / day"
          hint={b.requiredDailyRunRate != null && b.currentDailyRunRate > 0
            ? (b.requiredDailyRunRate <= b.currentDailyRunRate ? "at your pace ✓" : `you're at ${bare(b.currentDailyRunRate)}`)
            : undefined}
        />
        <Metric value={`+${bare(b.profitPer1000Revenue)}`} label="per 1,000 sold" hint="straight to profit" />
      </div>

      <div className="be-foot">
        {b.currentDailyRunRate > 0 ? (
          <>At today&rsquo;s pace {monthName} finishes near <b className="tnum">{egp(b.projectedRevenue)}</b> —
            about <b className="tnum" style={{ color: b.projectedProfit > 0 ? "var(--green)" : "var(--red)" }}>{egp(b.projectedProfit)}</b> profit.</>
        ) : (
          <>No sales recorded yet this month.</>
        )}
        {d && (
          <span className="be-draw">
            <span className="be-draw-row">
              <b className="tnum">{egp(b.breakEvenRevenue)}</b><i>covers costs</i>
              <b className="tnum">{egp(d.target)}</b><i>covers you too</i>
              {!d.covered && <><b className="tnum" style={{ color: "var(--amber)" }}>{egp(d.stillNeeded)}</b><i>to go{d.requiredDailyRunRate != null ? ` · ${bare(d.requiredDailyRunRate)}/day` : ""}</i></>}
              {d.covered && <b style={{ color: "var(--green)" }}>covered ✓</b>}
            </span>
            <i>you take ~{egp(d.perMonth)}/month · from the bank card</i>
          </span>
        )}
        <span className="be-note">
          Covers {egp(b.fixedCosts.rent)} rent + {egp(b.fixedCosts.ownCosts)} {b.fixedCosts.ownCostsBasis}, plus the mall&rsquo;s 3%.
          Both leave at month end, but the month owes them from day one.
        </span>
      </div>
      </div>
    </DeckTile>
  );
}
