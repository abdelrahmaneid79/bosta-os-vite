/** BREAK-EVEN PANEL — the daily "am I actually earning yet?" answer.
 *
 *  Hierarchy is deliberate: ONE hero number (what's still needed, or what's
 *  been earned), then the bar that gives it context, then the three levers
 *  (days left, daily rate required, value of extra sales). Status is carried by
 *  a labelled chip AND an icon, never by colour alone. */
import { useQuery } from "@tanstack/react-query";
import { DeckTile } from "./deck";
import { SkeletonRows, ErrorState } from "@/components/feedback";
import { egp } from "@/core/utils/format";
import { isEngineConfigured } from "@/core/db/engine";
import { getBreakEven, type BreakEvenSnapshot } from "@/core/read/break-even";

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
  if (!isEngineConfigured) return null;
  if (q.isLoading) return <DeckTile><SkeletonRows rows={3} /></DeckTile>;
  if (q.isError) return <DeckTile><ErrorState message={String((q.error as Error)?.message ?? "Could not load break-even")} /></DeckTile>;
  const b = q.data!;
  const s = statusOf(b);
  const monthName = MONTHS[Number(b.month.slice(5, 7)) - 1];
  const pastBreakEven = b.profit > 0;
  const barPct = Math.min(100, Math.max(0, b.progressPct));

  return (
    <DeckTile>
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
        <div className="be-hero-v tnum" style={{ color: pastBreakEven ? "var(--green)" : "rgb(var(--text))" }}>
          <small>EGP</small>{bare(pastBreakEven ? b.profit : b.revenueStillNeeded)}
        </div>
        <div className="be-hero-l">
          {pastBreakEven ? "earned so far this month" : "more to sell before you earn anything"}
        </div>
      </div>

      {/* progress toward the fixed base */}
      <div className="be-bar" role="img"
        aria-label={`${bare(b.revenue)} of ${bare(b.breakEvenRevenue)} break-even reached, ${barPct} percent`}>
        <i style={{ width: `${barPct}%`, background: s.colour }} />
      </div>
      <div className="be-scale tnum">
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
        <span className="be-note">Rent, salary and the mall&rsquo;s {Math.round(0.03 * 100)}% are already taken out.</span>
      </div>
    </DeckTile>
  );
}
