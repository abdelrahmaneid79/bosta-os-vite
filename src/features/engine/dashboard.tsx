import { useState, useRef, useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHead, Eyebrow, Pill, Ring, Badge, Button, StatCard, IconChip, DeltaChip, Sparkline, Tabs, type Accent } from "@/components/ui";
import { DonutChart } from "@/components/charts";
import { getExpenses } from "@/core/read/expenses";
import { cn } from "@/core/utils/cn";
import { useLayoutStore } from "@/store/layout";
import { WIDGET_TITLES, type WidgetId } from "@/core/dashboardLayout";
import { EmptyState, SkeletonRows, ErrorState } from "@/components/feedback";
import { egp, egpShort } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { getCommandCenter } from "@/core/read/dashboard";
import { getMissingData } from "@/core/read/missing";
import { getRiskInsights } from "@/core/read/insights";
import { getActivityFeed, type ActivityEvent } from "@/core/read/activity";
import { getHealthReport } from "@/core/read/health";
import { getDailyRevenue } from "@/core/read/sales";
import { getProfitReadout } from "@/core/read/profit";
import { todayCairo, monthBoundsCairo, lastMonthBoundsCairo, isoDaysAgo, isoRange } from "@/core/time";
import { useBooksStartDate } from "@/store/books";
import type { Insight, Severity } from "@/core/insights/risk";

const en = isEngineConfigured;

const I = {
  revenue: "M3 3v18h18M7 14l3-3 3 3 5-6",
  profit: "M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  cash: "M3 7h18v11H3zM3 11h18M7 15h2",
  owed: "M12 8v4l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
  stock: "M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  sale: "M3 3v18h18M7 14l3-3 3 3 5-6",
} as const;

const delta = (cur: number, prev: number): number | null => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

/* ─ Interactive revenue chart ──────────────────────────────────────────────
   Selectable period (3M/6M/12M/All) with automatic granularity, a labeled
   value axis, dated x-axis, and hover read-out. Pure SVG + a little state. */
type Period = "3M" | "6M" | "12M" | "All";
const PERIOD_OPTS: { value: Period; label: string }[] = [
  { value: "3M", label: "3M" }, { value: "6M", label: "6M" }, { value: "12M", label: "12M" }, { value: "All", label: "All" },
];
interface ChartPoint { key: string; label: string; full: string; value: number }

const monthsAgoIso = (iso: string, m: number) => { const d = new Date(iso + "T00:00:00"); d.setMonth(d.getMonth() - m); return d.toISOString().slice(0, 10); };
const mondayOf = (iso: string) => { const d = new Date(iso + "T00:00:00"); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return d.toISOString().slice(0, 10); };

function buildPoints(daily: { date: string; total: number }[], period: Period, today: string): { points: ChartPoint[]; gran: "day" | "week" | "month"; prevTotal: number } {
  const byDay = new Map(daily.map((d) => [d.date, d.total]));
  const dates = daily.map((d) => d.date).sort();
  const earliest = dates[0] ?? today;
  const sumRange = (a: string, b: string) => daily.reduce((s, d) => (d.date >= a && d.date <= b ? s + d.total : s), 0);

  let from: string, gran: "day" | "week" | "month";
  if (period === "3M") { from = monthsAgoIso(today, 3); gran = "day"; }
  else if (period === "6M") { from = monthsAgoIso(today, 6); gran = "week"; }
  else if (period === "12M") { from = monthsAgoIso(today, 12); gran = "month"; }
  else { from = earliest; gran = "month"; }
  if (from < earliest && period !== "All") { /* keep window even if empty for honesty */ }

  const points: ChartPoint[] = [];
  if (gran === "day") {
    for (const d of isoRange(from, today)) points.push({ key: d, label: fmtDate(d, "d MMM"), full: fmtDate(d, "EEE d MMM yyyy"), value: byDay.get(d) ?? 0 });
  } else if (gran === "week") {
    let ws = mondayOf(from);
    while (ws <= today) {
      const we = isoDaysAgo(ws, -6);
      points.push({ key: ws, label: fmtDate(ws, "d MMM"), full: `Week of ${fmtDate(ws, "d MMM yyyy")}`, value: sumRange(ws, we > today ? today : we) });
      ws = isoDaysAgo(ws, -7);
    }
  } else {
    const start = new Date(from + "T00:00:00"); start.setDate(1);
    const end = new Date(today + "T00:00:00");
    for (const d = start; d <= end; d.setMonth(d.getMonth() + 1)) {
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      let v = 0; for (const r of daily) if (r.date.slice(0, 7) === ym) v += r.total;
      points.push({ key: ym, label: fmtDate(ym + "-01", "MMM"), full: fmtDate(ym + "-01", "MMM yyyy"), value: v });
    }
  }
  // previous equal-length window (for the period delta)
  const spanDays = Math.max(1, Math.round((Date.parse(today) - Date.parse(from)) / 86400000));
  const prevTotal = sumRange(isoDaysAgo(from, spanDays), isoDaysAgo(from, 1));
  return { points, gran, prevTotal };
}

function RevenueChart({ daily, latestDay }: { daily: { date: string; total: number }[]; latestDay: string | null }) {
  const today = todayCairo();
  const [period, setPeriod] = useState<Period>("12M");
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { points, gran, prevTotal } = useMemo(() => buildPoints(daily, period, today), [daily, period, today]);

  const W = 760, H = 230, padL = 52, padR = 12, padTop = 16, padBot = 28;
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.value));
  const niceMax = niceCeil(max);
  const x = (i: number) => (n <= 1 ? padL : padL + (i * (W - padL - padR)) / (n - 1));
  const y = (v: number) => padTop + (1 - v / niceMax) * (H - padTop - padBot);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${(H - padBot).toFixed(1)} L${x(0).toFixed(1)},${(H - padBot).toFixed(1)} Z`;
  const total = points.reduce((s, p) => s + p.value, 0);
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((g) => niceMax * g);
  const xStep = Math.max(1, Math.ceil(n / 7));

  function onMove(e: React.MouseEvent) {
    const r = ref.current?.getBoundingClientRect(); if (!r) return;
    const f = (e.clientX - r.left) / r.width;
    const plotStart = padL / W, plotEnd = (W - padR) / W;
    const i = Math.round(((f - plotStart) / (plotEnd - plotStart)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }
  const hp = hover != null ? points[hover] : null;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow accent="text-pink">Revenue · {period === "All" ? "all time" : `last ${period}`}</Eyebrow>
          <div className="mt-1.5 flex items-end gap-2.5">
            <div className="tnum font-display text-[32px] font-extrabold leading-none text-text">{egp(total)}</div>
            <DeltaChip pct={delta(total, prevTotal)} />
          </div>
          <div className="mt-1 text-[12.5px] text-dim">
            {gran === "month" ? "monthly" : gran === "week" ? "weekly" : "daily"} · {latestDay ? `latest sales ${fmtDate(latestDay, "d MMM yyyy")}` : "—"}
          </div>
        </div>
        <Tabs value={period} options={PERIOD_OPTS} onChange={(p) => { setPeriod(p); setHover(null); }} />
      </div>

      <div ref={ref} className="relative mt-3" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 230 }}>
          <defs>
            <linearGradient id="rev-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--pink))" stopOpacity="0.28" />
              <stop offset="100%" stopColor="rgb(var(--pink))" stopOpacity="0" />
            </linearGradient>
          </defs>
          {gridVals.map((v, i) => (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} style={{ stroke: "rgb(var(--line2))" }} strokeWidth={1} />
              <text x={padL - 8} y={y(v) + 3.5} textAnchor="end" style={{ fontSize: 10.5, fontWeight: 600, fill: "rgb(var(--faint))" }}>{egpShort(v).replace("EGP ", "")}</text>
            </g>
          ))}
          <path d={area} fill="url(#rev-fill)" />
          <path d={line} fill="none" stroke="rgb(var(--pink))" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {points.map((p, i) => (i % xStep === 0 || i === n - 1) ? (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 600, fill: "rgb(var(--dim))" }}>{p.label}</text>
          ) : null)}
          {hp && (
            <g>
              <line x1={x(hover!)} x2={x(hover!)} y1={padTop} y2={H - padBot} style={{ stroke: "rgb(var(--pink))" }} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
              <circle cx={x(hover!)} cy={y(hp.value)} r={4.5} fill="rgb(var(--pink))" stroke="rgb(var(--panel))" strokeWidth={2} />
            </g>
          )}
        </svg>
        {hp && (
          <div className="pointer-events-none absolute -translate-x-1/2 rounded-xl border border-line bg-panel px-3 py-2 shadow-pop"
            style={{ left: `${(x(hover!) / W) * 100}%`, top: 0 }}>
            <div className="text-[11px] font-medium text-dim">{hp.full}</div>
            <div className="tnum font-display text-sm font-extrabold text-text">{egp(hp.value)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Round a max up to a clean axis bound (1/2/2.5/5 × 10^k). */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / mag;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * mag;
}

const dot = (s: string) => s === "high" ? "bg-bad" : s === "medium" ? "bg-warn" : "bg-dim";
const sevDot = (s: Severity) => s === "critical" ? "bg-bad" : s === "warning" ? "bg-warn" : "bg-dim";
const confLabel: Record<Insight["confidence"], string> = { high: "", estimate: "estimate", "low-data": "needs data" };
const kindGlyph: Record<ActivityEvent["kind"], string> = { sale: "🟢", purchase: "📦", expense: "🧾", cash: "💵", withdrawal: "🏷️", cheque: "🏦" };

/** Compact insight row — title, why, action, honest confidence chip. */
export function InsightRow({ i }: { i: Insight }) {
  return (
    <Link to={i.route} className="row-hover block rounded-2xl border border-line p-3.5">
      <div className="flex items-start gap-2.5">
        <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${sevDot(i.severity)}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm font-bold text-text">{i.title}</span>
            {confLabel[i.confidence] && <Badge tone={i.confidence === "low-data" ? "neutral" : "warn"}>{confLabel[i.confidence]}</Badge>}
            {i.metric && <span className="ml-auto tnum text-[11px] text-dim">{i.metric}</span>}
          </div>
          <div className="mt-1 text-[12.5px] leading-relaxed text-muted">{i.detail}</div>
          <div className="mt-1.5 text-[12px] font-semibold text-pink">→ {i.action}</div>
        </div>
      </div>
    </Link>
  );
}

/* ─ Today / Command Center ─────────────────────────────────────────────── */
export function DashboardScreen() {
  const month = monthBoundsCairo();
  const last = lastMonthBoundsCairo();
  const today = todayCairo();
  const histFrom = "2024-01-01"; // wide enough to cover all history for the chart's "All" view
  const cc = useQuery({ queryKey: ["cc"], queryFn: getCommandCenter, enabled: en });
  const miss = useQuery({ queryKey: ["missing"], queryFn: getMissingData, enabled: en });
  const insights = useQuery({ queryKey: ["risk-insights"], queryFn: getRiskInsights, enabled: en });
  const feed = useQuery({ queryKey: ["activity"], queryFn: () => getActivityFeed(30, 6), enabled: en });
  const health = useQuery({ queryKey: ["health"], queryFn: getHealthReport, enabled: en });
  const daily = useQuery({ queryKey: ["dailyHist", histFrom], queryFn: () => getDailyRevenue({ from: histFrom, to: today }), enabled: en });
  const accStart = useBooksStartDate();
  const profitM = useQuery({ queryKey: ["profit", month, accStart], queryFn: () => getProfitReadout(month, accStart), enabled: en });
  const spend = useQuery({ queryKey: ["dash-spend", histFrom], queryFn: () => getExpenses({ from: histFrom, to: today }), enabled: en });
  const c = cc.data;
  if (cc.isError) return <ErrorState message={String((cc.error as Error)?.message)} />;

  const rows = daily.data ?? [];
  const byDay = new Map(rows.map((p) => [p.date, p.total]));
  const monthRev = isoRange(month.from, today).reduce((s, d) => s + (byDay.get(d) ?? 0), 0);
  const lastRev = rows.filter((p) => p.date >= last.from && p.date <= last.to).reduce((s, p) => s + p.total, 0);
  const latestDay = rows.filter((p) => p.total > 0).map((p) => p.date).sort().pop() ?? null;

  // Monthly buckets for the trend chart (last 12 calendar months).
  const monthly = new Map<string, number>();
  for (const p of rows) { const k = p.date.slice(0, 7); monthly.set(k, (monthly.get(k) ?? 0) + p.total); }
  const monthsAxis: string[] = [];
  { const d = new Date(today + "T00:00:00"); for (let i = 11; i >= 0; i--) { const m = new Date(d.getFullYear(), d.getMonth() - i, 1); monthsAxis.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`); } }
  const trendPoints = monthsAxis.map((k) => ({ label: fmtDate(k + "-01", "MMM"), value: monthly.get(k) ?? 0 }));
  const trendTotal = trendPoints.reduce((s, p) => s + p.value, 0);
  const sparkSeries = trendPoints.map((p) => p.value);

  const pM = profitM.data;
  const attention = (miss.data?.length ?? 0) + (insights.data?.filter((i) => i.severity !== "info").length ?? 0);
  const loading = !c && cc.isLoading;

  const widgets: Record<WidgetId, ReactNode> = {
    kpis: (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Revenue · 12 months" accent="pink" icon={I.revenue} value={loading ? "—" : egpShort(trendTotal)} delta={delta(monthRev, lastRev)} sub={`this month ${egpShort(monthRev)}`}>
          <Sparkline data={sparkSeries} accent="pink" height={36} />
        </StatCard>
        <StatCard label="Cash on hand" accent="blue" icon={I.cash} value={loading ? "—" : c?.cashBalance == null ? "—" : egpShort(c.cashBalance)} sub="current balance" />
        <StatCard label="Net profit · month" accent="mint" icon={I.profit} value={pM ? (pM.netProfit == null ? "needs costs" : egpShort(pM.netProfit)) : "—"} sub={pM?.netMargin != null ? `${Math.round(pM.netMargin)}% margin` : "after costs"} />
        <StatCard label="Awaiting cheque" accent="amber" icon={I.owed} value={loading ? "—" : egpShort(c?.owed ?? 0)} sub="sales since last cheque" />
      </div>
    ),
    trend: (
      <Card glow>
        <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
          <div className="min-w-0">
            {daily.isLoading ? <div className="h-[300px] animate-pulse rounded-2xl bg-panel2" /> : <RevenueChart daily={rows} latestDay={latestDay} />}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
            <MiniStat label="This month" value={loading ? "—" : egp(monthRev)} accent="pink" delta={delta(monthRev, lastRev)} icon={I.revenue} />
            <MiniStat label="Stock value" value={loading ? "—" : egp(c?.stockValue ?? 0)} accent="blue" icon={I.stock} />
            <MiniStat label="Cash on hand" value={loading ? "—" : egp(c?.cashBalance ?? 0)} accent="mint" icon={I.cash} />
          </div>
        </div>
      </Card>
    ),
    attention: (
      <Card>
        <CardHead title={`Needs attention${attention > 0 ? ` · ${attention}` : ""}`} accent="amber" icon={I.bolt}
          action={<Link to="/missing" className="text-xs font-semibold text-pink">Open Gaps →</Link>} />
        {!en ? <Note>Sign in to load.</Note> : miss.isLoading ? <SkeletonRows rows={3} /> :
          (miss.data?.length ?? 0) === 0 ? <div className="flex items-center gap-2 py-1 text-sm font-medium text-good"><span className="h-2 w-2 rounded-full bg-good" /> All clear — nothing needs you right now.</div> : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {miss.data!.slice(0, 6).map((i) => (
              <Link key={i.key} to={i.route} className="row-hover flex items-center gap-2.5 rounded-2xl border border-line p-3">
                <span className={`h-2 w-2 rounded-full ${dot(i.severity)}`} />
                <span className="flex-1 text-sm font-medium text-text">{i.title}</span>
                <span className="tnum text-[12px] font-semibold text-dim">{i.count}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    ),
    risks: (
      <Card>
        <CardHead title="Risks & signals" accent="red" icon={I.bolt}
          action={(insights.data?.length ?? 0) > 3 ? <Link to="/missing" className="text-xs font-semibold text-pink">All {insights.data!.length} →</Link> : undefined} />
        {insights.isLoading ? <SkeletonRows rows={2} /> : (insights.data?.length ?? 0) === 0
          ? <div className="flex items-center gap-2 py-1 text-sm font-medium text-good"><span className="h-2 w-2 rounded-full bg-good" /> No risks flagged.</div>
          : <div className="space-y-2">{insights.data!.slice(0, 3).map((i) => <InsightRow key={i.key} i={i} />)}</div>}
      </Card>
    ),
    activity: (
      <Card>
        <CardHead title="Recent activity" accent="mint" icon={I.cash}
          action={<Link to="/activity" className="text-xs font-semibold text-pink">All →</Link>} />
        {!en ? <Note>Sign in to load.</Note>
          : feed.isLoading ? <SkeletonRows rows={4} />
          : (feed.data?.length ?? 0) === 0 ? <Note>No events recorded yet.</Note>
          : (
          <div className="-my-1 divide-y divide-line">
            {feed.data!.map((e) => (
              <Link key={`${e.kind}-${e.id}`} to={e.route} className="row-hover -mx-2 flex items-center gap-3 rounded-2xl px-2 py-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-panel2 text-base">{kindGlyph[e.kind]}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-text">{e.label}</div>
                  <div className="text-[11.5px] text-dim">{fmtDate(e.date)}</div>
                </div>
                {e.amount !== 0 && (
                  <div className={`tnum font-display text-sm font-bold ${e.amount > 0 ? "text-good" : "text-muted"}`}>
                    {e.amount > 0 ? "+" : "−"}{egp(Math.abs(e.amount))}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </Card>
    ),
    health: (
      <Card glow accent="#9B6CFF" className="flex items-center gap-5">
        <Ring value={health.data?.overall ?? null} size={104} stroke={12}>
          <span className="tnum font-display text-[26px] font-extrabold text-text">{health.data?.overall ?? "—"}</span>
          <span className="text-[10px] font-semibold text-dim">/ 100</span>
        </Ring>
        <div className="min-w-0 flex-1">
          <Eyebrow accent="text-violet">Business health</Eyebrow>
          <div className="font-display text-xl font-extrabold text-text">{health.data?.status ?? "—"}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {health.data?.level != null && <Pill tone="warn">⚡ Level {health.data.level}</Pill>}
            {health.data && health.data.streakDays > 0 && <Pill tone="pink">🔥 {health.data.streakDays}-day streak</Pill>}
          </div>
        </div>
        <Link to="/health" className="lift flex-shrink-0 rounded-2xl border border-line bg-panel px-3.5 py-2 text-xs font-semibold text-text hover:bg-panel2">Open →</Link>
      </Card>
    ),
    spend: (() => {
      const rowsE = spend.data ?? [];
      const opTotal = rowsE.filter((e) => e.isOperating).reduce((s, e) => s + e.amount, 0);
      const invTotal = rowsE.filter((e) => !e.isOperating).reduce((s, e) => s + e.amount, 0);
      const byCat = new Map<string, number>();
      for (const e of rowsE) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount);
      const donut = [...byCat.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
      return (
        <Card>
          <CardHead title="Where money goes" sub="all spend by category · since launch" accent="violet" icon="M6 2h9l5 5v15H4V2zM9 13h6M9 17h6"
            action={<Link to="/expenses" className="text-xs font-semibold text-pink">Open Expenses →</Link>} />
          {spend.isLoading ? <SkeletonRows rows={3} /> : donut.length === 0 ? <Note>No expenses recorded yet.</Note> : (
            <div className="grid items-center gap-6 lg:grid-cols-[1.15fr_1fr]">
              <DonutChart data={donut} size={208} />
              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="Operating costs" value={egp(opTotal)} accent="amber" icon={I.owed} />
                <MiniStat label="Inventory" value={egp(invTotal)} accent="violet" icon={I.stock} />
                <MiniStat label="Total spend" value={egp(opTotal + invTotal)} accent="pink" icon={I.revenue} />
                <MiniStat label="Cash on hand" value={loading ? "—" : egpShort(c?.cashBalance ?? 0)} accent="mint" icon={I.cash} />
              </div>
            </div>
          )}
        </Card>
      );
    })(),
  };

  return <CustomizableDashboard widgets={widgets} />;
}

function MiniStat({ label, value, accent, delta, icon }: { label: string; value: string; accent: Accent; delta?: number | null; icon?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel2 p-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon && <IconChip d={icon} accent={accent} size="sm" />}
          <span className="text-[12px] font-medium text-muted">{label}</span>
        </div>
        <DeltaChip pct={delta ?? undefined} />
      </div>
      <div className="mt-2 tnum font-display text-xl font-extrabold text-text">{value}</div>
    </div>
  );
}

/** Drag-to-reorder, click-to-hide dashboard. Layout saved per-browser. */
function CustomizableDashboard({ widgets }: { widgets: Record<WidgetId, ReactNode> }) {
  const { layout, reorder, toggle, reset } = useLayoutStore();
  const [edit, setEdit] = useState(false);
  const [drag, setDrag] = useState<WidgetId | null>(null);
  const [over, setOver] = useState<WidgetId | null>(null);
  const hidden = layout.filter((x) => !x.on);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-dim">{edit ? "Drag cards to reorder · tap Hide to remove" : "Your dashboard"}</div>
        <button onClick={() => setEdit((e) => !e)}
          className={`lift rounded-2xl border px-3.5 py-2 text-xs font-bold transition ${edit ? "border-pink bg-pink text-ink shadow-pink" : "border-line bg-panel text-muted hover:text-text"}`}>
          {edit ? "✓ Done" : "✎ Customize"}
        </button>
      </div>

      {layout.filter((x) => x.on).map((item) => (
        <div key={item.id}
          draggable={edit}
          onDragStart={() => setDrag(item.id)}
          onDragEnd={() => { setDrag(null); setOver(null); }}
          onDragOver={(e) => { if (edit && drag) { e.preventDefault(); setOver(item.id); } }}
          onDrop={(e) => { e.preventDefault(); if (drag && drag !== item.id) reorder(drag, item.id); setDrag(null); setOver(null); }}
          className={cn("animate-rise", edit && "rounded-3xl border border-dashed p-2 transition", edit && (over === item.id ? "border-pink bg-pink/5" : "border-line"), drag === item.id && "opacity-40")}
        >
          {edit && (
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className="cursor-grab text-dim active:cursor-grabbing" title="Drag">⠿</span>
              <span className="flex-1 text-[11px] font-bold uppercase tracking-wider text-faint">{WIDGET_TITLES[item.id]}</span>
              <button onClick={() => toggle(item.id)} className="rounded-lg bg-panel2 px-2.5 py-1 text-[11px] font-semibold text-muted hover:text-bad">Hide</button>
            </div>
          )}
          <div className={edit ? "pointer-events-none" : ""}>{widgets[item.id]}</div>
        </div>
      ))}

      {edit && (
        <Card>
          <div className="flex items-center justify-between">
            <Eyebrow>Hidden widgets</Eyebrow>
            <button onClick={reset} className="text-xs font-semibold text-pink hover:underline">Reset to default</button>
          </div>
          {hidden.length === 0 ? <p className="mt-2 text-sm text-dim">All widgets are visible. Drag the cards above to reorder.</p> : (
            <div className="mt-2 flex flex-wrap gap-2">
              {hidden.map((h) => (
                <button key={h.id} onClick={() => toggle(h.id)} className="rounded-2xl border border-line bg-panel2 px-3.5 py-2 text-[12px] font-semibold text-muted hover:border-pink/40 hover:text-text">+ {WIDGET_TITLES[h.id]}</button>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
function Note({ children }: { children: React.ReactNode }) { return <div className="py-1 text-sm text-dim">{children}</div>; }

/* ─ Health Center (game-style, real signals) ───────────────────────────── */
export function HealthScreen() {
  const q = useQuery({ queryKey: ["health"], queryFn: getHealthReport, enabled: en });
  if (!en) return <EmptyState title="Sign in to compute health" hint="Built from your real data only — never faked." />;
  if (q.isLoading) return <SkeletonRows rows={5} />;
  if (q.isError) return <ErrorState message={String((q.error as Error)?.message)} />;
  const h = q.data!;

  return (
    <div className="space-y-4">
      <Card glow>
        <div className="grid items-center gap-6 sm:grid-cols-[auto_1fr]">
          <Ring value={h.overall} size={150} stroke={13}>
            <span className="tnum font-display text-4xl font-extrabold leading-none text-text">{h.overall ?? "—"}</span>
            <span className="text-[11px] font-semibold text-dim">/ 100</span>
          </Ring>
          <div>
            <Eyebrow>Overall business health</Eyebrow>
            <div className="mb-2 font-display text-2xl font-extrabold text-text">{h.status}</div>
            <div className="mb-4 flex flex-wrap gap-2">
              {h.level != null && <Pill tone="warn">⚡ Level {h.level}</Pill>}
              {h.streakDays > 0 && <Pill tone="pink">🔥 {h.streakDays}-day streak</Pill>}
            </div>
            <div className="grid grid-cols-2 gap-5">
              <Col title="Helping" tone="text-good" rows={h.helping} dotClass="bg-good" />
              <Col title="Hurting" tone="text-bad" rows={h.hurting} dotClass="bg-bad" />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {h.categories.map((cat) => (
          <Card key={cat.key}>
            <div className="flex items-center gap-3">
              <Ring value={cat.score} size={56} stroke={7}><span className="tnum font-display text-xs font-bold text-text">{cat.score ?? "—"}</span></Ring>
              <div className="min-w-0">
                <div className="font-display text-sm font-bold">{cat.label}</div>
                {cat.trend != null && <span className={`tnum text-[11px] font-semibold ${cat.trend >= 0 ? "text-good" : "text-bad"}`}>{cat.trend >= 0 ? "▲ +" : "▼ −"}{Math.abs(cat.trend)}% this month</span>}
              </div>
            </div>
            <div className="mt-3 text-[12.5px] leading-relaxed text-muted">{cat.reason}</div>
            <div className="mt-3 border-t border-line pt-2.5 text-[11px] font-semibold text-good">↑ {cat.lift}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
function Col({ title, tone, rows, dotClass }: { title: string; tone: string; rows: { label: string; score: number }[]; dotClass: string }) {
  return (
    <div>
      <div className={`mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] ${tone}`}>{title}</div>
      {rows.length ? rows.map((r) => (
        <div key={r.label} className="text-[13px] text-muted"><span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${dotClass}`} /> {r.label} · {r.score}</div>
      )) : <div className="text-[13px] text-dim">—</div>}
    </div>
  );
}

/* ─ Gaps: risks & signals + data gaps ──────────────────────────────────── */
export function MissingScreen() {
  const q = useQuery({ queryKey: ["missing"], queryFn: getMissingData, enabled: en });
  const ins = useQuery({ queryKey: ["risk-insights"], queryFn: getRiskInsights, enabled: en });
  if (!en) return <EmptyState title="Sign in to scan for gaps" />;
  if (q.isLoading || ins.isLoading) return <SkeletonRows rows={5} />;
  if (q.isError) return <ErrorState message={String((q.error as Error)?.message)} />;
  if (ins.isError) return <ErrorState message={String((ins.error as Error)?.message)} />;
  const issues = q.data ?? [];
  const risks = ins.data ?? [];
  if (issues.length === 0 && risks.length === 0) return <EmptyState title="All clear 🎉" hint="No risks flagged and your data looks complete." />;
  return (
    <div className="space-y-5">
      {risks.length > 0 && (
        <div className="space-y-2">
          <Eyebrow>Risks &amp; signals · {risks.length}</Eyebrow>
          {risks.map((i) => <InsightRow key={i.key} i={i} />)}
        </div>
      )}
      {issues.length > 0 && (
        <div className="space-y-3">
          <Eyebrow>Data gaps · {issues.length}</Eyebrow>
          {issues.map((i) => (
            <Card key={i.key}>
              <div className="flex items-start gap-3">
                <span className={`mt-1 h-2.5 w-2.5 rounded-full ${dot(i.severity)}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-display font-bold">{i.title}</span>
                    <Pill tone={i.severity === "high" ? "bad" : i.severity === "medium" ? "warn" : "neutral"}>{i.count}</Pill>
                  </div>
                  <div className="mt-1 text-sm text-muted">{i.detail}</div>
                  <div className="mt-1.5 text-[12px] font-semibold text-pink">→ {i.action}</div>
                </div>
                <Link to={i.route} className="lift flex-shrink-0 rounded-2xl border border-line bg-panel px-3.5 py-2 text-xs font-semibold text-text hover:bg-panel2">Fix</Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─ Activity — full business event feed ────────────────────────────────── */
export function ActivityScreen() {
  const feed = useQuery({ queryKey: ["activity-full"], queryFn: () => getActivityFeed(60, 200), enabled: en });
  if (!en) return <EmptyState title="Sign in to see activity" />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>Recent activity</Eyebrow>
        <Button variant="outline" size="sm" disabled={feed.isFetching} onClick={() => feed.refetch()}>{feed.isFetching ? "Refreshing…" : "Refresh"}</Button>
      </div>
      {feed.isLoading ? <SkeletonRows rows={8} />
        : feed.isError ? <ErrorState message={String((feed.error as Error)?.message)} onRetry={() => feed.refetch()} />
        : (feed.data?.length ?? 0) === 0 ? <EmptyState title="No events yet" hint="Record a sale, purchase, expense, or cash movement and it appears here." />
        : (
        <Card><div className="-my-1 divide-y divide-line">
          {feed.data!.map((e) => (
            <Link key={`${e.kind}-${e.id}`} to={e.route} className="row-hover -mx-2 flex items-center gap-3 rounded-2xl px-2 py-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-panel2 text-base">{kindGlyph[e.kind]}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text">{e.label}</div>
                <div className="text-[11.5px] capitalize text-dim">{e.kind} · {fmtDate(e.date)}</div>
              </div>
              {e.amount !== 0 && (
                <div className={`tnum font-display text-sm font-bold ${e.amount > 0 ? "text-good" : "text-muted"}`}>{e.amount > 0 ? "+" : "−"}{egp(Math.abs(e.amount))}</div>
              )}
            </Link>
          ))}
        </div></Card>
      )}
    </div>
  );
}
