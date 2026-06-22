import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, Eyebrow, Pill, Ring, Badge, Button } from "@/components/ui";
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
import { todayCairo, monthBoundsCairo, isoDaysAgo, isoRange } from "@/core/time";
import { DateRangePicker } from "@/components/DateRangePicker";
import { useActiveRange } from "@/store/filters";
import { AskBostaPanel } from "./AskBosta";
import type { Insight, Severity } from "@/core/insights/risk";

const en = isEngineConfigured;

/** 14-day sales bar chart — pure SVG, no deps. Highlights today and the peak. */
function Sparkbars({ series }: { series: { date: string; total: number }[] }) {
  const max = Math.max(1, ...series.map((p) => p.total));
  const today = todayCairo();
  return (
    <div className="flex h-24 items-end gap-1">
      {series.map((p) => {
        const h = Math.max(3, (p.total / max) * 100);
        const isToday = p.date === today;
        return (
          <div key={p.date} className="group relative flex flex-1 flex-col items-center justify-end" title={`${fmtDate(p.date)} · ${egp(p.total)}`}>
            <div className={`w-full rounded-t-md transition-all ${isToday ? "bg-pink" : p.total > 0 ? "bg-pink/35 group-hover:bg-pink/60" : "bg-line2"}`} style={{ height: `${h}%` }} />
          </div>
        );
      })}
    </div>
  );
}
const dot = (s: string) => s === "high" ? "bg-bad" : s === "medium" ? "bg-warn" : "bg-dim";
const sevDot = (s: Severity) => s === "critical" ? "bg-bad" : s === "warning" ? "bg-warn" : "bg-dim";
const confLabel: Record<Insight["confidence"], string> = { high: "", estimate: "estimate", "low-data": "needs data" };

const kindGlyph: Record<ActivityEvent["kind"], string> = {
  sale: "🟢", purchase: "📦", expense: "🧾", cash: "💵", withdrawal: "🏷️", cheque: "🏦",
};

/** Compact insight row — title, why, action, and an honest confidence chip. */
export function InsightRow({ i }: { i: Insight }) {
  return (
    <Link to={i.route} className="row-hover block rounded-xl border border-line2 p-3">
      <div className="flex items-start gap-2.5">
        <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${sevDot(i.severity)}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm font-semibold text-text">{i.title}</span>
            {confLabel[i.confidence] && <Badge tone={i.confidence === "low-data" ? "neutral" : "warn"}>{confLabel[i.confidence]}</Badge>}
            {i.metric && <span className="ml-auto font-mono text-[11px] text-dim">{i.metric}</span>}
          </div>
          <div className="mt-1 text-[12.5px] leading-relaxed text-muted">{i.detail}</div>
          <div className="mt-1.5 text-[12px] text-pink">→ {i.action}</div>
        </div>
      </div>
    </Link>
  );
}

/* ─ Today / Command Center ─────────────────────────────────────────────── */
export function DashboardScreen() {
  const month = monthBoundsCairo();
  const today = todayCairo();
  const chartFrom = isoDaysAgo(today, 13);
  const cc = useQuery({ queryKey: ["cc"], queryFn: getCommandCenter, enabled: en });
  const miss = useQuery({ queryKey: ["missing"], queryFn: getMissingData, enabled: en });
  const insights = useQuery({ queryKey: ["risk-insights"], queryFn: getRiskInsights, enabled: en });
  const feed = useQuery({ queryKey: ["activity"], queryFn: () => getActivityFeed(30, 8), enabled: en });
  const health = useQuery({ queryKey: ["health"], queryFn: getHealthReport, enabled: en });
  const daily = useQuery({ queryKey: ["daily14", chartFrom], queryFn: () => getDailyRevenue({ from: chartFrom, to: today }), enabled: en });
  const profit = useQuery({ queryKey: ["profit", month], queryFn: () => getProfitReadout(month), enabled: en });
  const c = cc.data;
  if (cc.isError) return <ErrorState message={String((cc.error as Error)?.message)} />;

  const byDay = new Map((daily.data ?? []).map((p) => [p.date, p.total]));
  const series = isoRange(chartFrom, today).map((d) => ({ date: d, total: byDay.get(d) ?? 0 }));
  const p = profit.data;
  const attention = (miss.data?.length ?? 0) + (insights.data?.filter((i) => i.severity !== "info").length ?? 0);

  // ── widget registry: every Today block is a customizable widget ──────────
  const widgets: Record<WidgetId, ReactNode> = {
    ask: <AskBostaPanel />,
    today: (
      <Card glow>
        <div className="flex items-start justify-between">
          <div>
            <Eyebrow>Today · {fmtDate(today, "EEE d MMM")}</Eyebrow>
            <div className="mt-1 flex items-end gap-3">
              <div className="font-display text-4xl font-semibold leading-none text-white">{c ? egp(c.todayRevenue) : "—"}</div>
              <div className="pb-1 text-sm text-muted">sold today</div>
            </div>
            <div className="mt-1 text-sm text-good">{c ? `${egp(c.monthRevenue)} this month` : "—"}</div>
          </div>
          <Link to="/sales" className="rounded-lg bg-pink px-3 py-1.5 font-display text-xs font-semibold text-ink shadow-pink">+ Sale</Link>
        </div>
        <div className="mt-4">
          {daily.isLoading ? <div className="h-24 animate-pulse rounded-lg bg-line2" /> : <Sparkbars series={series} />}
          <div className="mt-1.5 flex justify-between text-[10px] text-dim"><span>{fmtDate(chartFrom, "d MMM")}</span><span>last 14 days</span><span>today</span></div>
        </div>
      </Card>
    ),
    kpis: (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Net profit · month" value={p ? (p.netProfit == null ? "unknown" : egpShort(p.netProfit)) : "—"} accent="text-good" to="/reports" />
        <Kpi label="Cash on hand" value={c ? (c.cashBalance == null ? "—" : egpShort(c.cashBalance)) : "—"} to="/money" />
        <Kpi label="Stock value" value={c ? egpShort(c.stockValue) : "—"} to="/stock" />
        <Kpi label="Owed to you" value={c ? egpShort(c.owed) : "—"} accent={c && c.owed > 0 ? "text-warn" : "text-text"} to="/cheques" />
      </div>
    ),
    attention: (
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <Eyebrow>Needs attention{attention > 0 ? ` · ${attention}` : ""}</Eyebrow>
          <Link to="/missing" className="text-xs text-pink">Open Gaps →</Link>
        </div>
        {!en ? <Note>Sign in to load.</Note> : miss.isLoading ? <SkeletonRows rows={3} /> :
          (miss.data?.length ?? 0) === 0 ? <div className="py-2 text-sm text-good">● All clear — nothing needs you right now.</div> : (
          <div className="grid gap-1 sm:grid-cols-2">
            {miss.data!.slice(0, 6).map((i) => (
              <Link key={i.key} to={i.route} className="row-hover flex items-center gap-2.5 rounded-lg p-2">
                <span className={`h-2 w-2 rounded-full ${dot(i.severity)}`} />
                <span className="flex-1 text-sm text-text">{i.title}</span>
                <span className="text-[11px] text-dim">{i.count}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    ),
    risks: (
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <Eyebrow>Risks &amp; signals</Eyebrow>
          {(insights.data?.length ?? 0) > 3 && <Link to="/missing" className="text-xs text-pink">All {insights.data!.length} →</Link>}
        </div>
        {insights.isLoading ? <SkeletonRows rows={2} /> : (insights.data?.length ?? 0) === 0
          ? <div className="py-2 text-sm text-good">● No risks flagged.</div>
          : <div className="space-y-2">{insights.data!.slice(0, 3).map((i) => <InsightRow key={i.key} i={i} />)}</div>}
      </Card>
    ),
    activity: (
      <Card className="!p-0">
        <div className="flex items-center justify-between px-4 pt-4">
          <Eyebrow>Recent activity</Eyebrow>
          <Link to="/activity" className="text-[11px] text-pink">All →</Link>
        </div>
        {!en ? <div className="px-4 pb-4 pt-2 text-sm text-dim">Sign in to load.</div>
          : feed.isLoading ? <div className="px-4 pb-4"><SkeletonRows rows={4} /></div>
          : (feed.data?.length ?? 0) === 0 ? <div className="px-4 pb-4 pt-2 text-sm text-dim">No events recorded yet.</div>
          : (
          <div className="mt-2 divide-y divide-line2">
            {feed.data!.map((e) => (
              <Link key={`${e.kind}-${e.id}`} to={e.route} className="row-hover flex items-center gap-3 px-4 py-2.5">
                <span className="text-base">{kindGlyph[e.kind]}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-text">{e.label}</div>
                  <div className="text-[11px] text-dim">{fmtDate(e.date)}</div>
                </div>
                {e.amount !== 0 && (
                  <div className={`font-display text-sm font-semibold ${e.amount > 0 ? "text-good" : "text-muted"}`}>
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
      <Card glow className="flex items-center gap-5">
        <Ring value={health.data?.overall ?? null} size={96} stroke={11}>
          <span className="font-display text-2xl font-semibold text-white">{health.data?.overall ?? "—"}</span>
          <span className="text-[10px] text-dim">/ 100</span>
        </Ring>
        <div className="flex-1">
          <Eyebrow>Business health</Eyebrow>
          <div className="font-display text-lg font-semibold text-good">{health.data?.status ?? "—"}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {health.data?.level != null && <Pill tone="warn">⚡ Level {health.data.level}</Pill>}
            {health.data && health.data.streakDays > 0 && <Pill tone="pink">🔥 {health.data.streakDays}-day streak</Pill>}
          </div>
        </div>
        <Link to="/health" className="rounded-lg border border-line px-3 py-1.5 text-xs text-text hover:bg-line2">Open →</Link>
      </Card>
    ),
    quick: (
      <Card>
        <Eyebrow>Quick actions</Eyebrow>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link to="/sales" className="lift rounded-xl bg-pink px-4 py-2.5 font-display text-sm font-semibold text-ink shadow-pink">+ Sale</Link>
          <Link to="/stock" className="lift rounded-xl border border-line bg-panel2 px-4 py-2.5 font-display text-sm font-semibold text-text">+ Product</Link>
          <Link to="/purchases" className="lift rounded-xl border border-line bg-panel2 px-4 py-2.5 font-display text-sm font-semibold text-text">+ Purchase</Link>
          <Link to="/expenses" className="lift rounded-xl border border-line bg-panel2 px-4 py-2.5 font-display text-sm font-semibold text-text">Add expense</Link>
          <Link to="/money" className="lift rounded-xl border border-line bg-panel2 px-4 py-2.5 font-display text-sm font-semibold text-text">Count cash</Link>
          <Link to="/sales/import" className="lift rounded-xl border border-line bg-panel2 px-4 py-2.5 font-display text-sm font-semibold text-text">Import receipt</Link>
        </div>
      </Card>
    ),
  };

  return <CustomizableDashboard widgets={widgets} />;
}

/** Renders the Today widgets in the owner's saved order, with an edit mode to
 *  reorder, hide/show and reset — persisted per-browser. */
function CustomizableDashboard({ widgets }: { widgets: Record<WidgetId, ReactNode> }) {
  const { layout, move, toggle, reset } = useLayoutStore();
  const [edit, setEdit] = useState(false);
  const hidden = layout.filter((x) => !x.on);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-display text-sm font-semibold text-dim">Your dashboard</div>
        <button onClick={() => setEdit((e) => !e)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${edit ? "border-pink bg-pink/15 text-pink" : "border-line bg-panel2 text-muted hover:text-text"}`}>
          {edit ? "✓ Done" : "✎ Customize"}
        </button>
      </div>

      {layout.filter((x) => x.on).map((item) => (
        <div key={item.id} className={edit ? "rounded-2xl border border-dashed border-pink/40 p-2" : ""}>
          {edit && (
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className="flex-1 font-mono text-[11px] uppercase tracking-wider text-faint">{WIDGET_TITLES[item.id]}</span>
              <button onClick={() => move(item.id, "up")} className="rounded-md bg-line2 px-2 py-1 text-xs text-muted hover:text-text" title="Move up">↑</button>
              <button onClick={() => move(item.id, "down")} className="rounded-md bg-line2 px-2 py-1 text-xs text-muted hover:text-text" title="Move down">↓</button>
              <button onClick={() => toggle(item.id)} className="rounded-md bg-line2 px-2 py-1 text-xs text-muted hover:text-bad" title="Hide">Hide</button>
            </div>
          )}
          {widgets[item.id]}
        </div>
      ))}

      {edit && (
        <Card>
          <div className="flex items-center justify-between">
            <Eyebrow>Hidden widgets</Eyebrow>
            <button onClick={reset} className="text-xs text-pink hover:underline">Reset to default</button>
          </div>
          {hidden.length === 0 ? <p className="mt-2 text-sm text-dim">All widgets are visible.</p> : (
            <div className="mt-2 flex flex-wrap gap-2">
              {hidden.map((h) => (
                <button key={h.id} onClick={() => toggle(h.id)} className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12px] text-muted hover:border-pink/40 hover:text-text">+ {WIDGET_TITLES[h.id]}</button>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
function Kpi({ label, value, accent = "text-text", to }: { label: string; value: string; accent?: string; to: string }) {
  return (
    <Link to={to} className="lift flex flex-col justify-between rounded-2xl border border-line bg-panel2 p-3.5 transition hover:border-pink/40">
      <div className="text-[11px] text-dim">{label}</div>
      <div className={`mt-2 font-display text-xl font-semibold ${accent}`}>{value}</div>
    </Link>
  );
}
function Note({ children }: { children: React.ReactNode }) { return <div className="py-2 text-sm text-dim">{children}</div>; }

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
          <Ring value={h.overall} size={150} stroke={12}>
            <span className="font-display text-4xl font-semibold leading-none text-white">{h.overall ?? "—"}</span>
            <span className="text-[11px] text-dim">/ 100</span>
          </Ring>
          <div>
            <Eyebrow>Overall business health</Eyebrow>
            <div className="mb-2 font-display text-2xl font-semibold text-good">{h.status}</div>
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
          <Card key={cat.key} className="!p-4">
            <div className="flex items-center gap-3">
              <Ring value={cat.score} size={52} stroke={6}><span className="font-display text-xs font-semibold text-text">{cat.score ?? "—"}</span></Ring>
              <div className="min-w-0">
                <div className="font-display text-sm font-semibold">{cat.label}</div>
                {cat.trend != null && <span className={`font-mono text-[11px] ${cat.trend >= 0 ? "text-good" : "text-bad"}`}>{cat.trend >= 0 ? "▲ +" : "▼ −"}{Math.abs(cat.trend)}% this month</span>}
              </div>
            </div>
            <div className="mt-3 text-[12.5px] leading-relaxed text-muted">{cat.reason}</div>
            <div className="mt-3 border-t border-line2 pt-2.5 font-mono text-[10.5px] text-good">↑ {cat.lift}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
function Col({ title, tone, rows, dotClass }: { title: string; tone: string; rows: { label: string; score: number }[]; dotClass: string }) {
  return (
    <div>
      <div className={`eyebrow mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] ${tone}`}>{title}</div>
      {rows.length ? rows.map((r) => (
        <div key={r.label} className="text-[13px] text-muted"><span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${dotClass}`} /> {r.label} · {r.score}</div>
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
                    <span className="font-display font-semibold">{i.title}</span>
                    <Pill tone={i.severity === "high" ? "bad" : i.severity === "medium" ? "warn" : "neutral"}>{i.count}</Pill>
                  </div>
                  <div className="mt-1 text-sm text-muted">{i.detail}</div>
                  <div className="mt-1.5 text-[12px] text-pink">→ {i.action}</div>
                </div>
                <Link to={i.route} className="flex-shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs text-text hover:bg-line2">Fix</Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─ Activity — full business event feed (verify writes here) ─────────────── */
export function ActivityScreen() {
  const range = useActiveRange();
  const feed = useQuery({ queryKey: ["activity-full", range], queryFn: () => getActivityFeed(60, 200, range), enabled: en });
  if (!en) return <EmptyState title="Sign in to see activity" />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>Activity in range</Eyebrow>
        <div className="flex items-center gap-2">
          <DateRangePicker />
          <Button variant="outline" disabled={feed.isFetching} onClick={() => feed.refetch()}>{feed.isFetching ? "Refreshing…" : "Refresh"}</Button>
        </div>
      </div>
      {feed.isLoading ? <SkeletonRows rows={8} />
        : feed.isError ? <ErrorState message={String((feed.error as Error)?.message)} onRetry={() => feed.refetch()} />
        : (feed.data?.length ?? 0) === 0 ? <EmptyState title="No events yet" hint="Record a sale, purchase, expense, or cash movement and it appears here." />
        : (
        <Card className="!p-0"><div className="divide-y divide-line2">
          {feed.data!.map((e) => (
            <Link key={`${e.kind}-${e.id}`} to={e.route} className="row-hover flex items-center gap-3 px-4 py-2.5">
              <span className="text-base">{kindGlyph[e.kind]}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-text">{e.label}</div>
                <div className="text-[11px] text-dim capitalize">{e.kind} · {fmtDate(e.date)}</div>
              </div>
              {e.amount !== 0 && (
                <div className={`font-display text-sm font-semibold ${e.amount > 0 ? "text-good" : "text-muted"}`}>{e.amount > 0 ? "+" : "−"}{egp(Math.abs(e.amount))}</div>
              )}
            </Link>
          ))}
        </div></Card>
      )}
    </div>
  );
}
