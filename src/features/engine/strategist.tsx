/** Business Strategist — the Insights › Health dashboard. A premium analytics
 *  dashboard (inspired by a SaaS health board, adapted to Bosta's real data):
 *  a KPI strip, an AI strategy briefing, revenue-by-product donut, monthly trend,
 *  a business-health radar, weekday/product bars, recent activity, and a
 *  products-to-watch table. All figures come from the audited snapshot (read-only);
 *  the AI reasons on top and is cached per day. Only writes: objective/context +
 *  cached briefing (rule 9). */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DeckTile, TileHead } from "./deck";
import { Button, Sparkline } from "@/components/ui";
import { SkeletonRows, ErrorState, EmptyState } from "@/components/feedback";
import { Gauge, HealthRadar, Donut, Area, Bars, VIZ_PALETTE } from "./strategist-viz";
import { isEngineConfigured } from "@/core/db/engine";
import { todayCairo } from "@/core/time";
import { egp, egpShort, num } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { useUI } from "@/store/ui";
import { assembleSnapshot } from "@/core/strategist/snapshot";
import { computeCalendar, type CalendarContext } from "@/core/strategist/calendar";
import { getActivityFeed } from "@/core/read/activity";
import { askStrategist, StrategistAuthError } from "@/core/strategist/client";
import { getStrategistConfig, saveObjective, saveContext, getStrategistBriefing, saveStrategistBriefing, type StrategistBriefing } from "@/core/strategist/config";

const dailyPrompt = (cal: CalendarContext) => `It's ${cal.dayOfWeek}, ${cal.today}. Give me my strategy for today — no preamble, no sign-off.

**Today's focus** — one sharp line: the single most important thing to do today.

**Today's tips** — 3 to 5 concrete, prioritized moves for today and this week, tied to what day it is, my live data, the calendar and my objective. Be specific — by product, weight, timing.

**What the data says** — 2 to 3 grounded insights from my revenue trend, seasonality, year-over-year, weekday pattern, margins or cash.

**Watch** — 1 to 2 risks to keep an eye on.

Ground every Bosta figure strictly in my data; use real snack/nut/candy retail expertise and known patterns; invent no external numbers.`;

function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let list: string[] = [];
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, k) => (p.startsWith("**") && p.endsWith("**")) ? <b key={k} style={{ color: "rgb(var(--text))", fontWeight: 700 }}>{p.slice(2, -2)}</b> : <span key={k}>{p}</span>);
  const flush = (i: number) => { if (!list.length) return; blocks.push(<ul key={`u${i}`} style={{ margin: "4px 0 10px", paddingLeft: 18, display: "grid", gap: 5 }}>{list.map((l, j) => <li key={j} style={{ fontSize: 13, lineHeight: 1.5, color: "rgb(var(--muted))" }}>{inline(l)}</li>)}</ul>); list = []; };
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (/^\*\*[^*]+\*\*$/.test(l)) { flush(i); blocks.push(<div key={i} style={{ fontWeight: 800, color: "var(--mag)", fontSize: 11.5, letterSpacing: ".06em", textTransform: "uppercase", margin: "14px 0 5px" }}>{l.slice(2, -2)}</div>); }
    else if (/^#{1,3}\s/.test(l)) { flush(i); blocks.push(<div key={i} style={{ fontWeight: 700, color: "rgb(var(--text))", fontSize: 14.5, margin: "12px 0 4px" }}>{inline(l.replace(/^#{1,3}\s/, ""))}</div>); }
    else if (/^[-*]\s/.test(l)) { list.push(l.replace(/^[-*]\s/, "")); }
    else if (!l) { flush(i); }
    else { flush(i); blocks.push(<p key={i} style={{ fontSize: 13, lineHeight: 1.55, color: "rgb(var(--muted))", margin: "0 0 8px" }}>{inline(l)}</p>); }
  });
  flush(lines.length);
  return <div>{blocks}</div>;
}

function Kpi({ label, value, sub, accent, spark, gauge }: { label: string; value: string; sub?: React.ReactNode; accent: string; spark?: number[]; gauge?: { value: number | null; color: string } }) {
  return (
    <div style={{ border: "1px solid rgb(var(--line))", borderRadius: 18, padding: "14px 16px", background: "rgb(var(--panel))", display: "flex", flexDirection: "column", gap: 6, minHeight: 118 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".04em", color: "rgb(var(--dim))" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: "rgb(var(--text))", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "rgb(var(--muted))" }}>{sub}</div>}
      <div style={{ marginTop: "auto" }}>
        {gauge ? <Gauge value={gauge.value} color={gauge.color} size={92} /> : spark ? <Sparkline data={spark} height={34} /> : <div style={{ height: 3, borderRadius: 999, background: accent, opacity: 0.5, marginTop: 8 }} />}
      </div>
    </div>
  );
}

const grid3 = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 } as React.CSSProperties;
const pct = (p: number | null | undefined) => (p == null ? "—" : `${p > 0 ? "+" : ""}${p}%`);

export function StrategistScreen() {
  const { reportError } = useUI();
  const today = todayCairo();
  const calendar = useMemo(() => computeCalendar(today), [today]);

  const cfg = useQuery({ queryKey: ["strategist-config"], queryFn: getStrategistConfig, enabled: isEngineConfigured });
  const snap = useQuery({ queryKey: ["strategist-snapshot"], queryFn: assembleSnapshot, enabled: isEngineConfigured, staleTime: 5 * 60_000 });
  const cache = useQuery({ queryKey: ["strategist-briefing"], queryFn: getStrategistBriefing, enabled: isEngineConfigured });
  const activity = useQuery({ queryKey: ["strategist-activity"], queryFn: () => getActivityFeed(60, 6), enabled: isEngineConfigured });

  const [objective, setObjective] = useState<string | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [tune, setTune] = useState(false);
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

  const autoRan = useRef(false);
  useEffect(() => {
    if (!isEngineConfigured || autoRan.current) return;
    if (snap.data && cache.isFetched && !cachedToday && !gen.isPending) { autoRan.current = true; gen.mutate(); }
  }, [snap.data, cache.isFetched, cachedToday, gen.isPending]); // eslint-disable-line

  if (!isEngineConfigured) return <EmptyState title="Sign in to open the strategist" hint="Grounded in your real data only — never faked." />;
  if (snap.isLoading) return <SkeletonRows rows={6} />;
  if (snap.isError) return <ErrorState message={String((snap.error as Error)?.message)} onRetry={() => snap.refetch()} />;
  const s = snap.data!;
  const busy = gen.isPending;

  const monthly = s.series.monthlyRevenue;
  const monthlyVals = monthly.map((m) => m.revenue ?? 0);
  const latest = monthly.length ? monthly[monthly.length - 1] : null;
  const overall = s.heuristics.health.overall;
  const hcol = overall == null ? "rgb(var(--faint))" : overall >= 75 ? "var(--green)" : overall >= 55 ? "var(--amber)" : "var(--red)";

  // Revenue-by-product donut: top 5 + "Other"
  const prods = s.products.topByRevenue.filter((p) => p.revenue != null) as { name: string; revenue: number }[];
  const top5 = prods.slice(0, 5);
  const otherRev = prods.slice(5).reduce((a, p) => a + p.revenue, 0);
  const donutSegs = [...top5.map((p) => ({ label: p.name, value: p.revenue })), ...(otherRev > 0 ? [{ label: "Other", value: otherRev }] : [])];
  const prodTotal = donutSegs.reduce((a, x) => a + x.value, 0);

  const dow = s.series.dayOfWeek.filter((d) => d.avg != null).map((d) => ({ label: d.day, value: d.avg! }));
  const watch = [...s.products.bottomByMargin.filter((p) => p.marginPct != null)].slice(0, 6);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(178px, 1fr))", gap: 12 }}>
        <Kpi label="Total revenue" accent="rgb(var(--violet))" value={s.revenue.allTime == null ? "—" : egpShort(s.revenue.allTime)} sub={`${num(s.coverage.daysTraded)} days · ${s.trends.trajectory}`} spark={monthlyVals} />
        <Kpi label={`Latest month${latest ? ` · ${latest.month}` : ""}`} accent="var(--mag)" value={latest?.revenue == null ? "—" : egp(latest.revenue)} sub={<span>MoM {pct(s.trends.momPct)}</span>} spark={monthlyVals.slice(-6)} />
        <Kpi label="Year-over-year" accent="var(--green)" value={pct(s.trends.yoyLatestPct)} sub={<span style={{ color: "rgb(var(--dim))" }}>latest vs a year ago</span>} />
        <Kpi label="Cheque income" accent="rgb(var(--cyan))" value={s.settlement.totalReceived == null ? "—" : egpShort(s.settlement.totalReceived)} sub={`mall takes ${s.settlement.blendedDeductionPct ?? "—"}%`} />
        <Kpi label="Cash on hand" accent="var(--amber)" value={s.cash.onHand == null ? "—" : egp(s.cash.onHand)} sub={<span style={{ color: "rgb(var(--dim))" }}>net position</span>} />
        <Kpi label="Business health" accent={hcol} value={overall == null ? "—" : `${overall}/100`} sub={<span style={{ color: hcol, fontWeight: 700 }}>{s.heuristics.health.status}</span>} gauge={{ value: overall, color: hcol }} />
      </div>

      {/* AI strategy — hero */}
      <div style={{ border: `1px solid color-mix(in srgb, rgb(var(--violet)) 40%, rgb(var(--line)))`, borderRadius: 20, padding: 20, background: "linear-gradient(135deg, color-mix(in srgb, rgb(var(--violet)) 14%, rgb(var(--panel))), rgb(var(--panel)) 60%)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>✦</span>
            <span style={{ fontWeight: 800, fontSize: 15, color: "rgb(var(--text))" }}>AI strategy · {calendar.dayOfWeek}{calendar.isWeekend ? " (weekend)" : ""}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setTune((t) => !t)} style={{ fontSize: 12, padding: "5px 10px", borderRadius: 8, border: "1px solid rgb(var(--line))", background: tune ? "rgb(var(--panel2))" : "transparent", color: "rgb(var(--muted))", cursor: "pointer" }}>⚙ Tune</button>
            <Button size="sm" variant="outline" onClick={() => gen.mutate()} disabled={busy}>{busy ? "Thinking…" : briefing ? "Refresh" : "Generate"}</Button>
          </div>
        </div>
        {tune && (
          <div style={{ display: "grid", gap: 10, margin: "8px 0 14px", padding: 12, border: "1px dashed rgb(var(--line))", borderRadius: 12 }}>
            <textarea className="input" style={{ minHeight: 42, resize: "vertical", width: "100%" }} placeholder="Your objective (optional) — e.g. grow monthly profit 20% without adding cash risk" value={obj} onChange={(e) => setObjective(e.target.value)} onBlur={() => saveObjective(obj)} />
            <textarea className="input" style={{ minHeight: 42, resize: "vertical", width: "100%" }} placeholder="Situational context (optional) — e.g. cashew supplier raised prices 12%" value={ctx} onChange={(e) => setContext(e.target.value)} onBlur={() => saveContext(ctx)} />
            <div style={{ fontSize: 11, color: "rgb(var(--faint))" }}>Tap Refresh after editing to fold these in.</div>
          </div>
        )}
        {!briefing && busy && <div style={{ fontSize: 13, color: "rgb(var(--dim))" }}>Reading your numbers, trends and the calendar to build today's strategy…</div>}
        {!briefing && !busy && <div style={{ fontSize: 13, color: "rgb(var(--dim))" }}>No strategy yet — tap Generate.</div>}
        {briefing && <><Markdown text={briefing.reply} /><div style={{ fontSize: 10.5, color: "rgb(var(--faint))", marginTop: 6 }}>Generated {briefing.generatedAt.slice(0, 16).replace("T", " ")} · grounded in your live data{latest ? ` · freshest ${latest.month}` : ""}.</div></>}
      </div>

      {/* Donut · Trend · Health radar */}
      <div style={grid3}>
        <DeckTile>
          <TileHead name="Revenue by product" right="partial detail" />
          {donutSegs.length ? (
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <Donut segments={donutSegs} centerValue={egpShort(prodTotal)} centerLabel="tracked" size={168} />
              <div style={{ display: "grid", gap: 7, flex: 1, minWidth: 150 }}>
                {donutSegs.map((sg, i) => (
                  <div key={sg.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: VIZ_PALETTE[i % VIZ_PALETTE.length], flexShrink: 0 }} />
                    <span dir="rtl" style={{ color: "rgb(var(--muted))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{sg.label}</span>
                    <span style={{ color: "rgb(var(--dim))", fontVariantNumeric: "tabular-nums" }}>{Math.round((sg.value / prodTotal) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <div style={{ fontSize: 12.5, color: "rgb(var(--dim))" }}>No product-level sales yet — import daily reports to populate.</div>}
        </DeckTile>

        <DeckTile>
          <TileHead name="Revenue trend" right={`${s.trends.monthsOfData} months · YoY ${pct(s.trends.yoyLatestPct)}`} />
          <Area data={monthlyVals} height={150} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgb(var(--dim))", marginTop: 6 }}>
            <span>{monthly[0]?.month ?? ""}</span>
            <span>Best {s.trends.best ? `${s.trends.best.month} · ${egpShort(s.trends.best.revenue)}` : "—"}</span>
            <span>{latest?.month ?? ""}</span>
          </div>
        </DeckTile>

        <DeckTile>
          <TileHead name="Business health" right="weighted" />
          <HealthRadar categories={s.heuristics.health.categories.map((c) => ({ label: c.label, score: c.score }))} overall={overall} status={s.heuristics.health.status} size={210} />
          {s.heuristics.dataGaps.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {s.heuristics.dataGaps.map((g) => <span key={g.title} style={{ fontSize: 10.5, padding: "3px 7px", borderRadius: 999, border: "1px solid rgb(var(--line))", color: g.severity === "high" ? "var(--red)" : g.severity === "medium" ? "var(--amber)" : "rgb(var(--dim))" }}>{g.title} · {g.count}</span>)}
            </div>
          )}
        </DeckTile>
      </div>

      {/* Weekday · Top products · Activity */}
      <div style={grid3}>
        <DeckTile>
          <TileHead name="Revenue by weekday" right="avg/day" />
          {dow.length ? <Bars data={dow} color="rgb(var(--cyan))" fmt={(n) => egpShort(n)} /> : <div style={{ fontSize: 12.5, color: "rgb(var(--dim))" }}>—</div>}
        </DeckTile>
        <DeckTile>
          <TileHead name="Top products" right="by revenue" />
          {top5.length ? <Bars data={top5.map((p) => ({ label: p.name, value: p.revenue }))} color="rgb(var(--violet))" fmt={(n) => egpShort(n)} /> : <div style={{ fontSize: 12.5, color: "rgb(var(--dim))" }}>No product lines yet.</div>}
        </DeckTile>
        <DeckTile>
          <TileHead name="Recent activity" right="latest" />
          {(activity.data ?? []).length === 0 ? <div style={{ fontSize: 12.5, color: "rgb(var(--dim))" }}>No recent activity.</div> : (
            <div style={{ display: "grid", gap: 9 }}>
              {(activity.data ?? []).map((a) => (
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", fontSize: 12.5 }}>
                  <span style={{ color: "rgb(var(--muted))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label}</span>
                  <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <span style={{ color: a.amount >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{a.amount >= 0 ? "+" : ""}{egpShort(Math.abs(a.amount))}</span>
                    <span style={{ color: "rgb(var(--faint))" }}>{fmtDate(a.date, "d MMM")}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </DeckTile>
      </div>

      {/* Products to watch */}
      <DeckTile style={{ padding: 0 }}>
        <div style={{ padding: "14px 16px 0" }}><TileHead name="Products to watch" right="lowest margins · partial detail" /></div>
        <div className="scroll">
          <table className="tbl">
            <thead><tr><th>Product</th><th className="r">Margin</th><th>Cost basis</th><th className="r">Revenue</th></tr></thead>
            <tbody>
              {watch.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "rgb(var(--dim))", padding: "18px" }}>No costed product lines yet.</td></tr>}
              {watch.map((p) => (
                <tr key={p.name}>
                  <td dir="rtl" style={{ fontSize: 13 }}>{p.name}</td>
                  <td className="r" style={{ color: (p.marginPct ?? 0) < 30 ? "var(--amber)" : "rgb(var(--text))", fontWeight: 700 }}>{p.marginPct}%</td>
                  <td><span style={{ fontSize: 11, color: p.costSource === "verified" ? "var(--green)" : "var(--amber)" }}>{p.costSource}</span></td>
                  <td className="r" style={{ color: "rgb(var(--dim))" }}>{p.revenue == null ? "—" : egpShort(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DeckTile>

      {/* Calendar strip */}
      {calendar.upcoming.length > 0 && (
        <DeckTile>
          <TileHead name="Retail calendar ahead" right="plan around these" />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {calendar.upcoming.map((e) => (
              <div key={e.name + e.date} style={{ border: "1px solid rgb(var(--line))", borderRadius: 12, padding: "8px 12px", minWidth: 148 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "rgb(var(--text))" }}>{e.name}{e.approx ? " *" : ""}</div>
                <div style={{ fontSize: 11.5, color: "var(--mag)", fontWeight: 700 }}>in {e.daysUntil} days</div>
                <div style={{ fontSize: 11, color: "rgb(var(--dim))", marginTop: 3, lineHeight: 1.4 }}>{e.why}</div>
              </div>
            ))}
          </div>
        </DeckTile>
      )}
    </div>
  );
}
