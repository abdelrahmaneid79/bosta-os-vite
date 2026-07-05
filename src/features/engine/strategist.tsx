/** Business Strategist — the rebuilt Insights › Health screen. A proactive DAILY
 *  TIPS DASHBOARD (not a chat): on open it generates today's briefing from the
 *  audited snapshot + the owner's objective/context + the real calendar, and
 *  reasons ON TOP of the heuristic engines. TRENDS and DATA-CONFIDENCE panels are
 *  rendered deterministically from the snapshot. The briefing is cached per day
 *  (a saved insight) so opening the tab doesn't re-bill the model every visit.
 *  The ONLY writes are the objective/context text + the cached briefing. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DeckTile, TileHead } from "./deck";
import { Button, Sparkline } from "@/components/ui";
import { SkeletonRows, ErrorState, EmptyState } from "@/components/feedback";
import { isEngineConfigured } from "@/core/db/engine";
import { todayCairo } from "@/core/time";
import { egp, num } from "@/core/utils/format";
import { useUI } from "@/store/ui";
import { assembleSnapshot } from "@/core/strategist/snapshot";
import { computeCalendar, type CalendarContext } from "@/core/strategist/calendar";
import { askStrategist, StrategistAuthError } from "@/core/strategist/client";
import { getStrategistConfig, saveObjective, saveContext, getStrategistBriefing, saveStrategistBriefing, type StrategistBriefing } from "@/core/strategist/config";

const dailyPrompt = (cal: CalendarContext) => `It's ${cal.dayOfWeek}, ${cal.today}. Give me my daily briefing as a dashboard — no preamble, no sign-off.

**Today's focus** — one sharp line: the single most important thing to do today.

**Today's tips** — 3 to 5 concrete, prioritized moves for today and this week. Tie each to what day it is (weekend vs weekday), my live data, the retail calendar, and my objective. Be specific — by product, weight, and timing.

**What the data says** — 2 to 3 grounded insights from my revenue trend, seasonality, year-over-year, weekday pattern, margins or cash.

**Watch** — 1 to 2 risks or things to keep an eye on.

Ground every Bosta figure strictly in my data; use real snack/nut/candy retail expertise and known patterns; invent no external numbers.`;

/** Tiny, dependency-free markdown → JSX (headers, bold, bullets, paragraphs). */
function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let list: string[] = [];
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, k) => (p.startsWith("**") && p.endsWith("**")) ? <b key={k} style={{ color: "var(--text)", fontWeight: 700 }}>{p.slice(2, -2)}</b> : <span key={k}>{p}</span>);
  const flush = (i: number) => { if (!list.length) return; blocks.push(<ul key={`u${i}`} style={{ margin: "6px 0 12px", paddingLeft: 18, display: "grid", gap: 6 }}>{list.map((l, j) => <li key={j} style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--muted)" }}>{inline(l)}</li>)}</ul>); list = []; };
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (/^#{1,3}\s/.test(l)) { flush(i); blocks.push(<div key={i} style={{ fontWeight: 700, color: "var(--text)", fontSize: 15, margin: "14px 0 4px" }}>{inline(l.replace(/^#{1,3}\s/, ""))}</div>); }
    else if (/^\*\*[^*]+\*\*$/.test(l)) { flush(i); blocks.push(<div key={i} style={{ fontWeight: 800, color: "var(--mag)", fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", margin: "16px 0 6px" }}>{l.slice(2, -2)}</div>); }
    else if (/^[-*]\s/.test(l)) { list.push(l.replace(/^[-*]\s/, "")); }
    else if (!l) { flush(i); }
    else { flush(i); blocks.push(<p key={i} style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)", margin: "0 0 8px" }}>{inline(l)}</p>); }
  });
  flush(lines.length);
  return <div>{blocks}</div>;
}

export function StrategistScreen() {
  const { reportError } = useUI();
  const today = todayCairo();
  const calendar = useMemo(() => computeCalendar(today), [today]);

  const cfg = useQuery({ queryKey: ["strategist-config"], queryFn: getStrategistConfig, enabled: isEngineConfigured });
  const snap = useQuery({ queryKey: ["strategist-snapshot"], queryFn: assembleSnapshot, enabled: isEngineConfigured, staleTime: 5 * 60_000 });
  const cache = useQuery({ queryKey: ["strategist-briefing"], queryFn: getStrategistBriefing, enabled: isEngineConfigured });

  const [objective, setObjective] = useState<string | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const obj = objective ?? cfg.data?.objective ?? "";
  const ctx = context ?? cfg.data?.context ?? "";

  const [fresh, setFresh] = useState<StrategistBriefing | null>(null);
  const cachedToday = cache.data && cache.data.date === today ? cache.data : null;
  const briefing = fresh ?? cachedToday;

  const gen = useMutation({
    mutationFn: async (): Promise<StrategistBriefing> => {
      if (!snap.data) throw new Error("Snapshot not ready yet.");
      await Promise.all([saveObjective(obj), saveContext(ctx)]);
      const reply = await askStrategist({ objective: obj, context: ctx, snapshot: snap.data, calendar, messages: [{ role: "user", content: dailyPrompt(calendar) }] });
      const b: StrategistBriefing = { date: today, reply, generatedAt: new Date().toISOString() };
      await saveStrategistBriefing(b);
      return b;
    },
    onSuccess: (b) => setFresh(b),
    onError: (e) => reportError("Strategist", e instanceof StrategistAuthError ? e.message : e),
  });

  // Auto-generate today's briefing once, only if there isn't already one for today.
  const autoRan = useRef(false);
  useEffect(() => {
    if (!isEngineConfigured || autoRan.current) return;
    if (snap.data && cache.isFetched && !cachedToday && !gen.isPending) { autoRan.current = true; gen.mutate(); }
  }, [snap.data, cache.isFetched, cachedToday, gen.isPending]); // eslint-disable-line

  if (!isEngineConfigured) return <EmptyState title="Sign in to open the strategist" hint="Grounded in your real data only — never faked." />;

  const s = snap.data;
  const busy = gen.isPending;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Objective + Context */}
      <div className="row2">
        <DeckTile>
          <TileHead name="Your objective" right="steers today's tips" />
          <textarea className="input" style={{ minHeight: 62, resize: "vertical", width: "100%" }} placeholder="e.g. grow monthly profit 20% without adding cash risk; prep for Ramadan"
            value={obj} onChange={(e) => setObjective(e.target.value)} onBlur={() => saveObjective(obj)} />
        </DeckTile>
        <DeckTile>
          <TileHead name="Situational context" right="real-world facts you know" />
          <textarea className="input" style={{ minHeight: 62, resize: "vertical", width: "100%" }} placeholder="e.g. cashew supplier raised prices 12%; running a weekend promo"
            value={ctx} onChange={(e) => setContext(e.target.value)} onBlur={() => saveContext(ctx)} />
        </DeckTile>
      </div>

      {/* Daily briefing — the dashboard */}
      <DeckTile>
        <TileHead
          name={`Today's briefing · ${calendar.dayOfWeek}${calendar.isWeekend ? " (weekend)" : ""}`}
          right={s ? <Button size="sm" variant="outline" onClick={() => gen.mutate()} disabled={busy}>{busy ? "Thinking…" : briefing ? "Refresh" : "Generate"}</Button> : "loading data…"}
        />
        {snap.isLoading && <SkeletonRows rows={4} />}
        {snap.isError && <ErrorState message={String((snap.error as Error)?.message)} onRetry={() => snap.refetch()} />}
        {s && !briefing && busy && <div style={{ fontSize: 13, color: "var(--dim)", padding: "8px 0" }}>Reading your numbers and the calendar to build today's tips…</div>}
        {s && !briefing && !busy && <div style={{ fontSize: 13, color: "var(--dim)", padding: "8px 0" }}>No briefing yet — tap Generate for today's tips.</div>}
        {briefing && (
          <>
            <Markdown text={briefing.reply} />
            <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 6 }}>Generated {briefing.generatedAt.slice(0, 16).replace("T", " ")} · grounded in your live data · Refresh after changing objective/context.</div>
          </>
        )}
      </DeckTile>

      {/* Calendar strip */}
      {s && calendar.upcoming.length > 0 && (
        <DeckTile>
          <TileHead name="Retail calendar ahead" right="plan around these" />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {calendar.upcoming.map((e) => (
              <div key={e.name + e.date} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "8px 12px", minWidth: 150 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{e.name}{e.approx ? " *" : ""}</div>
                <div style={{ fontSize: 11.5, color: "var(--mag)", fontWeight: 700 }}>in {e.daysUntil} days</div>
                <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 3, lineHeight: 1.4 }}>{e.why}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--faint)", marginTop: 8 }}>* Islamic dates are moon-sighting approximations.</div>
        </DeckTile>
      )}

      {/* Trends + Data confidence */}
      {s && (
        <div className="row2">
          <DeckTile>
            <TileHead name="Trends" right="full history" />
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <div className="eyebrow" style={{ color: "var(--dim)", marginBottom: 6 }}>Monthly revenue</div>
                <Sparkline data={s.series.monthlyRevenue.map((m) => m.revenue ?? 0)} height={54} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--dim)", marginTop: 4 }}>
                  <span>{s.trends.monthsOfData} months · {s.trends.trajectory}</span>
                  <span>MoM {s.revenue.momGrowthPct == null ? "—" : `${s.revenue.momGrowthPct > 0 ? "+" : ""}${s.revenue.momGrowthPct}%`}</span>
                </div>
              </div>
              <TrendRow label="Year-over-year · latest month" value={s.trends.yoyLatestPct == null ? "—" : `${s.trends.yoyLatestPct > 0 ? "+" : ""}${s.trends.yoyLatestPct}%`} />
              <TrendRow label="Best month" value={s.trends.best ? `${s.trends.best.month} · ${egp(s.trends.best.revenue)}` : "—"} />
              <TrendRow label="Best weekday" value={bestDay(s.series.dayOfWeek)} />
              <TrendRow label="Awaiting cheque (open tab)" value={s.settlement.openTabRevenue == null ? "—" : `${egp(s.settlement.openTabRevenue)} · ${s.settlement.openTabDays ?? 0}d`} />
              <div>
                <div className="eyebrow" style={{ color: "var(--dim)", margin: "4px 0 6px" }}>Top margin movers <span style={{ color: "var(--faint)", textTransform: "none", fontWeight: 500 }}>· partial detail days</span></div>
                {s.products.topByMargin.slice(0, 4).map((p) => <ProdRow key={p.name} p={p} good />)}
                {s.products.bottomByMargin.slice(0, 3).map((p) => <ProdRow key={p.name} p={p} />)}
              </div>
            </div>
          </DeckTile>

          <DeckTile>
            <TileHead name="Data confidence" right="what's solid vs thin" />
            <div style={{ display: "grid", gap: 6 }}>
              <TrendRow label="Business health" value={`${s.heuristics.health.overall ?? "—"}/100 · ${s.heuristics.health.status}`} />
              <TrendRow label="This-month profit" value={s.profit.complete ? `${egp(s.profit.thisMonthNet ?? 0)} (complete)` : `withheld · ${s.profit.missingCostLines} lines lack cost`} />
              <TrendRow label="Days traded" value={num(s.coverage.daysTraded)} />
              <div style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: 1.45, margin: "2px 0 6px" }}>{s.coverage.productDetail}</div>
              <div className="eyebrow" style={{ color: "var(--dim)", margin: "4px 0 4px" }}>Open data gaps</div>
              {s.heuristics.dataGaps.length === 0 && <div style={{ fontSize: 12.5, color: "var(--green)" }}>None — books are clean.</div>}
              {s.heuristics.dataGaps.map((g) => (
                <div key={g.title} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                  <span style={{ color: g.severity === "high" ? "var(--red)" : g.severity === "medium" ? "var(--amber)" : "var(--muted)" }}>{g.title}</span>
                  <span style={{ color: "var(--dim)", fontVariantNumeric: "tabular-nums" }}>{g.count}</span>
                </div>
              ))}
            </div>
          </DeckTile>
        </div>
      )}
    </div>
  );
}

function TrendRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12.5 }}><span style={{ color: "var(--muted)" }}>{label}</span><span style={{ color: "var(--text)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</span></div>;
}
function ProdRow({ p, good }: { p: { name: string; marginPct: number | null; costSource: string }; good?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12.5, padding: "2px 0" }}>
      <span style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }} dir="rtl">{p.name}</span>
      <span style={{ color: good ? "var(--green)" : "var(--amber)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{p.marginPct == null ? "—" : `${p.marginPct}%`}{p.costSource === "estimate" ? "*" : ""}</span>
    </div>
  );
}
function bestDay(dow: { day: string; avg: number | null }[]): string {
  const best = [...dow].filter((d) => d.avg != null).sort((a, b) => (b.avg! - a.avg!))[0];
  return best ? `${best.day} · ${egp(best.avg!)}` : "—";
}
