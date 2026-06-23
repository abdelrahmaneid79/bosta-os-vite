/** Analytics overview — the visual heart of Reports. Real charts driven by the
 *  global date range: KPI grid, daily revenue (bar/line/monthly), revenue vs
 *  purchases, expense distribution, day-of-week, 7-day rolling average, top
 *  revenue days, and product leaderboards. All data is live; nothing is faked. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, Eyebrow } from "@/components/ui";
import { EmptyState, SkeletonRows, ErrorState, PartialNote } from "@/components/feedback";
import { DateRangePicker } from "@/components/DateRangePicker";
import { usePrefs } from "@/store/prefs";
import { BarChart, LineChart, DonutChart, HBars } from "@/components/charts";
import { egp, egpShort } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { useActiveRange } from "@/store/filters";
import { getAnalytics, type Kpi } from "@/core/read/analytics";

const CURRENCY = new Set(["periodRevenue", "dailyAvg", "avg30", "monthProfit", "owed", "allTime", "totalExp"]);
function fmtKpi(k: Kpi): string {
  if (k.value == null) return "unknown";
  if (k.key === "growth") return `${k.value >= 0 ? "▲ +" : "▼ "}${Math.abs(Math.round(k.value))}%`;
  if (CURRENCY.has(k.key)) return egpShort(k.value);
  return String(Math.round(k.value));
}
const toneClass = (t?: string) => t === "good" ? "text-good" : t === "warn" ? "text-warn" : "text-text";

type ChartMode = "bar" | "line" | "monthly";

export function AnalyticsScreen() {
  const range = useActiveRange();
  const accStart = usePrefs((s) => s.accountingStart);
  const [mode, setMode] = useState<ChartMode>("bar");
  const q = useQuery({ queryKey: ["analytics", range, accStart], queryFn: () => getAnalytics(range, accStart), enabled: isEngineConfigured });
  const partial = range.from < accStart ? accStart : null;

  if (!isEngineConfigured) return <EmptyState title="Sign in to see analytics" />;
  if (q.isLoading) return <div className="space-y-4"><SkeletonRows rows={3} /><SkeletonRows rows={6} /></div>;
  if (q.isError) return <ErrorState message={String((q.error as Error)?.message)} onRetry={() => q.refetch()} />;
  const a = q.data!;
  const hasData = a.daily.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>Overview · {a.rangeLabel}</Eyebrow>
        <DateRangePicker />
      </div>
      {partial && <PartialNote since={partial} />}

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {a.kpis.map((k) => (
          <Card key={k.key} className="!p-4">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-dim">{k.label}</div>
            <div className={`mt-1.5 tnum font-display text-xl font-extrabold ${toneClass(k.tone)}`}>{fmtKpi(k)}</div>
            <div className="mt-1 truncate text-[11px] text-faint">{k.sub}</div>
          </Card>
        ))}
      </div>

      {!hasData ? <EmptyState title="No sales in this range" hint="Pick a wider period or record a sale." /> : (
        <>
          {/* Daily revenue */}
          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <Eyebrow>Daily revenue</Eyebrow>
                <div className="text-[11px] text-dim">{a.daily.length} days · {egp(a.daily.reduce((s, d) => s + d.value, 0))} total</div>
              </div>
              <div className="inline-flex gap-1 rounded-full border border-line bg-panel2 p-1">
                {(["bar", "line", "monthly"] as ChartMode[]).map((m) => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold capitalize transition ${mode === m ? "bg-pink text-ink shadow-pink" : "text-muted hover:text-text"}`}>{m}</button>
                ))}
              </div>
            </div>
            {mode === "line" ? <LineChart data={a.daily} color="rgb(var(--pink))" />
              : mode === "monthly" ? <BarChart data={a.monthlyRevenue} />
              : <BarChart data={a.daily} />}
          </Card>

          {/* Revenue vs purchases + expense distribution */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <Eyebrow>Monthly revenue vs purchases</Eyebrow>
              <div className="mt-3 space-y-3">
                <div><div className="mb-1 text-[11px] font-semibold text-good">Revenue</div><BarChart data={a.monthlyRevenue} height={150} color="rgb(var(--good))" /></div>
                <div><div className="mb-1 text-[11px] font-semibold text-warn">Purchases (stock-in)</div><BarChart data={a.monthlyPurchases} height={120} color="rgb(var(--warn))" /></div>
              </div>
            </Card>
            <Card>
              <Eyebrow>Expense categories</Eyebrow>
              {a.expenseDistribution.length === 0 ? <p className="mt-3 text-sm text-dim">No expenses in range.</p>
                : <div className="mt-3"><DonutChart data={a.expenseDistribution} /></div>}
            </Card>
          </div>

          {/* Day of week + rolling avg */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <Eyebrow>Average by day of week</Eyebrow>
              <div className="mt-3"><BarChart data={a.dayOfWeek} height={180} color="rgb(var(--info))" /></div>
            </Card>
            <Card>
              <Eyebrow>7-day rolling average · last 90 days</Eyebrow>
              <div className="mt-3"><LineChart data={a.rolling} height={180} color="rgb(var(--good))" /></div>
            </Card>
          </div>

          {/* Top days + product leaderboards */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <Eyebrow>Top revenue days</Eyebrow>
              <div className="mt-2 -mb-1 divide-y divide-line">
                {a.topRevenueDays.map((d, i) => (
                  <div key={d.date} className="flex items-center gap-3 py-2.5">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-panel2 tnum text-[11px] font-bold text-dim">{i + 1}</span>
                    <span className="flex-1 text-sm font-medium text-text">{fmtDate(d.date)}</span>
                    <span className="tnum font-display text-sm font-bold text-good">{egp(d.total)}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <Eyebrow>Top products · revenue</Eyebrow>
              <div className="mt-3"><HBars data={a.productsByRevenue} color="rgb(var(--pink))" format={(n) => egpShort(n)} /></div>
            </Card>
            <Card>
              <Eyebrow>Top products · volume</Eyebrow>
              <div className="mt-3"><HBars data={a.productsByVolume} color="rgb(var(--good))" format={(n) => String(Math.round(n))} /></div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
