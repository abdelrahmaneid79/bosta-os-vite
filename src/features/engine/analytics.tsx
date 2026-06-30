/** Analytics overview — the visual heart of Reports. Real charts driven by the
 *  global date range: KPI grid, daily revenue (bar/line/monthly), revenue vs
 *  purchases, expense distribution, day-of-week, 7-day rolling average, top
 *  revenue days, and product leaderboards. All data is live; nothing is faked. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, Eyebrow, Badge } from "@/components/ui";
import { cn } from "@/core/utils/cn";
import { EmptyState, SkeletonRows, ErrorState, PartialNote } from "@/components/feedback";
import { DateRangePicker } from "@/components/DateRangePicker";
import { useBooksStartDate } from "@/store/books";
import { BarChart, LineChart, DonutChart, HBars } from "@/components/charts";
import { egp, egpShort } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { useActiveRange } from "@/store/filters";
import { getAnalytics, type Kpi } from "@/core/read/analytics";
import { getLifetimeProducts } from "@/core/read/products";
import { getBudgetStatus, type BudgetStatus } from "@/core/read/budgets";
import { getRevenueForecast } from "@/core/read/forecast";
import type { RevenueForecast } from "@/core/forecast/logic";
import { Link } from "react-router-dom";

const CURRENCY = new Set(["periodRevenue", "dailyAvg", "avg30", "monthProfit", "owed", "allTime", "totalExp"]);
function fmtKpi(k: Kpi): string {
  if (k.value == null) return "unknown";
  if (k.key === "growth") return `${k.value >= 0 ? "▲ +" : "▼ "}${Math.abs(Math.round(k.value))}%`;
  if (CURRENCY.has(k.key)) return egpShort(k.value);
  return String(Math.round(k.value));
}
const toneClass = (t?: string) => t === "good" ? "text-good" : t === "warn" ? "text-warn" : "text-text";

const BUDGET_TONE: Record<string, { bar: string; text: string; label: string }> = {
  ahead: { bar: "bg-good", text: "text-good", label: "ahead" },
  "on-track": { bar: "bg-good", text: "text-good", label: "on track" },
  behind: { bar: "bg-warn", text: "text-warn", label: "behind" },
  over: { bar: "bg-bad", text: "text-bad", label: "over budget" },
  unknown: { bar: "bg-dim", text: "text-dim", label: "needs data" },
};

const CONF_TONE: Record<string, "good" | "warn" | "neutral"> = { high: "good", estimate: "warn", "low-data": "neutral" };
const CONF_LABEL: Record<string, string> = { high: "high confidence", estimate: "estimate", "low-data": "needs more data" };
const DOW_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

/** Revenue forecast — day-of-week seasonality × recent level, honest confidence. */
function ForecastCard({ f }: { f: RevenueForecast }) {
  const maxF = Math.max(1, ...f.dowFactors);
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <Eyebrow>Revenue forecast</Eyebrow>
        <Badge tone={CONF_TONE[f.confidence]}>{CONF_LABEL[f.confidence]}</Badge>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
        <div className="rounded-2xl border border-line bg-panel2 p-4">
          <div className="text-[12px] font-medium text-muted">Next 7 days</div>
          <div className="mt-1 tnum font-display text-2xl font-extrabold text-text">{egpShort(f.next7)}</div>
          <div className="mt-0.5 text-[11px] text-dim">≈ {egpShort(f.avgPerDay)}/day</div>
        </div>
        <div className="rounded-2xl border border-line bg-panel2 p-4">
          <div className="text-[12px] font-medium text-muted">Next 30 days</div>
          <div className="mt-1 tnum font-display text-2xl font-extrabold text-text">{egpShort(f.next30)}</div>
          <div className="mt-0.5 text-[11px] text-dim">projected</div>
        </div>
        <div className="flex items-end gap-1.5">
          {f.dowFactors.map((v, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="flex h-16 w-5 items-end overflow-hidden rounded-md bg-line"><div className="w-full rounded-md bg-pink/70" style={{ height: `${Math.max(6, (v / maxF) * 100)}%` }} /></div>
              <span className="text-[10px] text-faint">{DOW_LABELS[i]}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-dim">{f.basis}</p>
    </Card>
  );
}

/** Targets vs actual — month-to-date progress with a pace marker. */
function BudgetBars({ b }: { b: BudgetStatus }) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <Eyebrow>Targets · this month</Eyebrow>
        <Link to="/settings" className="text-[12px] font-semibold text-pink">Edit →</Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {b.rows.map((r) => {
          const tone = BUDGET_TONE[r.status] ?? BUDGET_TONE.unknown;
          return (
            <div key={r.key} className="rounded-2xl border border-line bg-panel2 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-muted">{r.label}</span>
                <Badge tone={r.status === "over" ? "bad" : r.status === "behind" ? "warn" : r.status === "unknown" ? "neutral" : "good"}>{tone.label}</Badge>
              </div>
              <div className="mt-1.5 flex items-end gap-1.5">
                <span className="tnum font-display text-xl font-extrabold text-text">{r.actual == null ? "—" : egpShort(r.actual)}</span>
                <span className="pb-0.5 text-[12px] text-dim">/ {egpShort(r.target)}</span>
              </div>
              <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-line">
                <div className={cn("h-full rounded-full transition-all", tone.bar)} style={{ width: `${Math.min(100, r.progressPct)}%` }} />
                <div className="absolute top-[-2px] h-3 w-0.5 bg-text/40" style={{ left: `${Math.min(100, r.pacePct)}%` }} title="month pace" />
              </div>
              <div className="mt-1.5 tnum text-[11px] text-dim">{r.progressPct}% · {r.kind === "expense" ? (r.remaining >= 0 ? `${egpShort(r.remaining)} left` : `${egpShort(-r.remaining)} over`) : `${egpShort(Math.max(0, r.remaining))} to go`}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

type ChartMode = "bar" | "line" | "monthly";

export function AnalyticsScreen() {
  const range = useActiveRange();
  const accStart = useBooksStartDate();
  const [mode, setMode] = useState<ChartMode>("bar");
  const q = useQuery({ queryKey: ["analytics", range, accStart], queryFn: () => getAnalytics(range, accStart), enabled: isEngineConfigured });
  const lifetime = useQuery({ queryKey: ["lifetime-products"], queryFn: getLifetimeProducts, enabled: isEngineConfigured });
  const budgets = useQuery({ queryKey: ["budget-status"], queryFn: getBudgetStatus, enabled: isEngineConfigured });
  const forecast = useQuery({ queryKey: ["revenue-forecast"], queryFn: () => getRevenueForecast(), enabled: isEngineConfigured });
  const partial = range.from < accStart ? accStart : null;

  if (!isEngineConfigured) return <EmptyState title="Sign in to see analytics" />;
  if (q.isLoading) return <div className="space-y-4"><SkeletonRows rows={3} /><SkeletonRows rows={6} /></div>;
  if (q.isError) return <ErrorState message={String((q.error as Error)?.message)} onRetry={() => q.refetch()} />;
  const a = q.data!;
  const hasData = a.daily.length > 0;
  // Product leaderboards: prefer per-line sale_items; fall back to real lifetime
  // POS totals when no product lines exist in range (honest, clearly labelled).
  const lp = lifetime.data ?? [];
  const lifeMode = a.productsByRevenue.length === 0 && lp.length > 0;
  const revLeaders = lifeMode ? lp.slice().sort((x, y) => y.revenue - x.revenue).slice(0, 10).map((p) => ({ label: p.name, value: p.revenue })) : a.productsByRevenue;
  const volLeaders = lifeMode ? lp.slice().sort((x, y) => y.units - x.units).slice(0, 10).map((p) => ({ label: p.name, value: p.units })) : a.productsByVolume;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>Overview · {a.rangeLabel}</Eyebrow>
        <DateRangePicker />
      </div>
      {partial && <PartialNote since={partial} />}

      {budgets.data?.configured && <BudgetBars b={budgets.data} />}

      {forecast.data && forecast.data.tradingDays > 0 && <ForecastCard f={forecast.data} />}

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
              <div className="flex items-center justify-between"><Eyebrow>Top products · revenue</Eyebrow>{lifeMode && <Badge tone="neutral">lifetime</Badge>}</div>
              <div className="mt-3">{revLeaders.length ? <HBars data={revLeaders} color="rgb(var(--pink))" format={(n) => egpShort(n)} /> : <p className="text-sm text-dim">No product sales recorded.</p>}</div>
            </Card>
            <Card>
              <div className="flex items-center justify-between"><Eyebrow>Top products · volume</Eyebrow>{lifeMode && <Badge tone="neutral">lifetime</Badge>}</div>
              <div className="mt-3">{volLeaders.length ? <HBars data={volLeaders} color="rgb(var(--good))" format={(n) => String(Math.round(n))} /> : <p className="text-sm text-dim">No product sales recorded.</p>}</div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
