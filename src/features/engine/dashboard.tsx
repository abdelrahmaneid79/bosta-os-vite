import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, Eyebrow, Pill, Ring, Badge, Button } from "@/components/ui";
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
import { getExpenses } from "@/core/read/expenses";
import { getChequeCycle } from "@/core/read/settlements";
import { getProductProfit } from "@/core/read/products";
import { todayCairo, monthBoundsCairo, isoDaysAgo } from "@/core/time";
import { useBooksStartDate } from "@/store/books";
import type { Insight, Severity } from "@/core/insights/risk";

const en = isEngineConfigured;

/* ═══════════════════════════════════════════════════════════════════════════
   COMMAND DECK — the "Today" screen, recreated from the Claude Design file
   "BostaOS Command Deck.dc.html": its own .ticker / .tile / .hero / .hgauge
   markup and classes (see src/command-deck.css), wired to live Supabase data.
   ═════════════════════════════════════════════════════════════════════════ */

const money2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctDelta = (cur: number, prev: number): number | null => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ── Catmull-Rom → cubic bézier smoothing (the design's `smooth`) ─────────── */
function smoothPath(p: { x: number; y: number }[]): string {
  if (p.length < 3) return "M" + p.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" L");
  let d = `M${p[0].x.toFixed(1)},${p[0].y.toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

/* ── Area chart — violet→magenta→cyan stroke over a magenta fill (the design's
      `renderLine`). Pure SVG, responsive via preserveAspectRatio="none". ───── */
function AreaChart({ series, id, height = 200, strong = false }: { series: number[]; id: string; height?: number; strong?: boolean }) {
  const W = 700, H = height, padL = 4, padR = 6, padT = 14, padB = 8;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const vals = series.length ? series : [0, 0];
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const lo = min - span * 0.16, hi = max + span * 0.16;
  const pts = vals.map((v, i) => ({ x: padL + (i / (vals.length - 1 || 1)) * plotW, y: padT + (1 - (v - lo) / (hi - lo)) * plotH }));
  const line = smoothPath(pts);
  const baseY = padT + plotH;
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${baseY.toFixed(1)} L${pts[0].x.toFixed(1)},${baseY.toFixed(1)} Z`;
  return (
    <svg className="chsvg" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`gf_${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--mag)" stopOpacity={strong ? 0.42 : 0.26} />
          <stop offset="1" stopColor="var(--mag)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`gs_${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--violet)" /><stop offset="0.55" stopColor="var(--mag)" /><stop offset="1" stopColor="var(--cyan)" />
        </linearGradient>
      </defs>
      <path className="ar-fill" fill={`url(#gf_${id})`} d={area} />
      <path className="ln" fill="none" stroke={`url(#gs_${id})`} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" pathLength={1} d={line} />
    </svg>
  );
}

/* ── Health gauge — top semicircle arc (the design's `.hgauge` / `.gv`). ───── */
function HealthGauge({ score, label }: { score: number; label: string }) {
  const clamp = Math.max(0, Math.min(100, score));
  const R = 84, cx = 100, cy = 110;
  const arc = Math.PI * R; // semicircle length
  const path = `M${cx - R},${cy} A${R},${R} 0 0 1 ${cx + R},${cy}`;
  return (
    <div className="hgauge">
      <svg viewBox="0 0 200 122" width="200" height="122">
        <defs>
          <linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--cyan)" /><stop offset="1" stopColor="var(--green)" />
          </linearGradient>
        </defs>
        <path d={path} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={15} strokeLinecap="round" />
        <path className="gv" d={path} stroke="url(#gauge-grad)" style={{ strokeDasharray: `${(clamp / 100) * arc} 999` }} />
      </svg>
      <div className="hscore">{Math.round(clamp)}%</div>
      <div className="hslab">{label}</div>
    </div>
  );
}

const Ic = {
  rev: <path d="M3 3v18h18M7 14l3-3 3 3 5-6" />,
  spend: <path d="M6 2h9l5 5v15H4V2zM9 13h6M9 17h6" />,
  cash: <path d="M3 7h18v11H3zM3 11h18M7 15h2" />,
  bell: <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />,
};

/* ═══ TODAY / COMMAND DECK ═══════════════════════════════════════════════ */
export function DashboardScreen() {
  const today = todayCairo();
  const month = monthBoundsCairo();
  const histFrom = "2024-01-01";
  const accStart = useBooksStartDate();

  const cc = useQuery({ queryKey: ["cc"], queryFn: getCommandCenter, enabled: en });
  const daily = useQuery({ queryKey: ["dailyHist", histFrom], queryFn: () => getDailyRevenue({ from: histFrom, to: today }), enabled: en });
  const spendAll = useQuery({ queryKey: ["dash-spend", histFrom], queryFn: () => getExpenses({ from: histFrom, to: today }), enabled: en });
  const health = useQuery({ queryKey: ["health"], queryFn: getHealthReport, enabled: en });
  const cycle = useQuery({ queryKey: ["cheque-cycle"], queryFn: getChequeCycle, enabled: en });
  const week = useQuery({ queryKey: ["week-products"], queryFn: () => getProductProfit({ from: isoDaysAgo(today, 6), to: today }), enabled: en });

  const d = useMemo(() => {
    const rows = daily.data ?? [];
    // monthly buckets (chronological)
    const bucket = new Map<string, number>();
    for (const r of rows) bucket.set(r.date.slice(0, 7), (bucket.get(r.date.slice(0, 7)) ?? 0) + r.total);
    const keys = [...bucket.keys()].sort();
    const monthly = keys.map((k) => ({ k, v: bucket.get(k)! }));
    // headline month = the latest month that actually has sales (the current
    // calendar month may be empty on day one of accurate books).
    const active = monthly.filter((m) => m.v > 0);
    const cur = active[active.length - 1] ?? { k: month.from.slice(0, 7), v: 0 };
    const prev = active[active.length - 2] ?? { k: "", v: 0 };
    const heroSeries = monthly.slice(-7).map((m) => m.v);
    const lifetimeRev = rows.reduce((s, r) => s + r.total, 0);
    const best = monthly.reduce((b, m) => (m.v > b.v ? m : b), { k: "", v: 0 });
    return {
      monthKey: cur.k, monthRev: cur.v, lastRev: prev.v, monthly, heroSeries, lifetimeRev, best,
      latest: rows.filter((r) => r.total > 0).map((r) => r.date).sort().pop() ?? null,
    };
  }, [daily.data, month.from]);

  const spendRows = spendAll.data ?? [];
  const monthSpend = spendRows.filter((e) => e.date.slice(0, 7) === d.monthKey).reduce((s, e) => s + e.amount, 0);
  const netCash = d.monthRev - monthSpend;
  const marginPct = d.monthRev > 0 ? (netCash / d.monthRev) * 100 : 0;
  const spendRatio = d.monthRev > 0 ? Math.min(100, (monthSpend / d.monthRev) * 100) : 0;

  // lifetime spend-by-category
  const catMap = new Map<string, number>();
  for (const e of spendRows) catMap.set(e.category, (catMap.get(e.category) ?? 0) + e.amount);
  const cats = [...catMap.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5);
  const CATCOL = ["var(--mag)", "var(--violet)", "var(--cyan)", "var(--amber)", "var(--lime)"];

  const cheques = (cycle.data?.cheques ?? []).slice(0, 5);
  const weekTop = [...(week.data ?? [])].sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const weekMax = Math.max(1, ...weekTop.map((p) => p.revenue));

  if (cc.isError) return <ErrorState message={String((cc.error as Error)?.message)} />;
  if (!en) return <EmptyState title="Sign in to load your deck" hint="Wired to your live data only — never faked." />;

  const monthLabel = `${MON[Number(d.monthKey.slice(5, 7)) - 1]} ${d.monthKey.slice(0, 4)}`;
  const revDelta = pctDelta(d.monthRev, d.lastRev);

  return (
    <div className="cdk space-y-5">
      {/* ── ticker ─────────────────────────────────────────────────────── */}
      <div className="ticker">
        <div className="tk">
          <div className="tkic" style={{ background: "rgba(255,61,168,.14)", color: "var(--mag)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">{Ic.rev}</svg>
          </div>
          <div><div className="tkl">Revenue · {monthLabel}</div>
            <div className="tkv tnum">{money2(d.monthRev)}{revDelta != null && <em className={revDelta >= 0 ? "up" : "down"} style={{ color: revDelta >= 0 ? "var(--green)" : "var(--red)" }}>{revDelta >= 0 ? "▲" : "▼"}{Math.abs(revDelta).toFixed(1)}%</em>}</div>
          </div>
        </div>
        <div className="tk">
          <div className="tkic" style={{ background: "rgba(157,107,255,.14)", color: "var(--violet)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">{Ic.spend}</svg>
          </div>
          <div><div className="tkl">Spend · {monthLabel}</div><div className="tkv tnum">{money2(monthSpend)}</div></div>
        </div>
        <div className="tk">
          <div className="tkic" style={{ background: "rgba(39,229,204,.14)", color: "var(--cyan)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">{Ic.cash}</svg>
          </div>
          <div><div className="tkl">Cheques logged</div><div className="tkv tnum">{cheques.length ? (cycle.data?.cheques.length ?? 0) : 0} · EGP {egpShort(cycle.data?.totalReceived ?? 0).replace("EGP ", "")}</div></div>
        </div>
        <div className="tk">
          <span className="live"><span className="livedot" /> LIVE</span>
          <div><div className="tkl">Accurate books</div><div className="tkv" style={{ fontSize: 14 }}>from {fmtDate(accStart, "d MMM yyyy")}</div></div>
        </div>
      </div>

      {/* ── grid ───────────────────────────────────────────────────────── */}
      <div className="grid">
        {/* hero — revenue this month */}
        <div className="tile hero">
          <div className="orb" />
          <div className="heronut"><img src="/assets/bosta-mascot.svg" alt="" /></div>
          <div className="th"><span className="eyebrow">Revenue · {monthLabel}</span></div>
          <div className="hv tnum"><span className="hcur">EGP</span>{money2(d.monthRev)}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
            {revDelta != null && (
              <span className={`delta ${revDelta >= 0 ? "up" : "down"}`}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">{revDelta >= 0 ? <path d="M3 8l3-3 3 3" /> : <path d="M3 4l3 3 3-3" />}</svg>
                {Math.abs(revDelta).toFixed(1)}% vs last month
              </span>
            )}
            <span style={{ fontSize: 12.5, color: "var(--dim)", fontWeight: 500 }}>{d.latest ? `latest sales ${fmtDate(d.latest, "d MMM")}` : "no sales yet"}</span>
          </div>
          <div className="chartbox" style={{ height: 120, marginTop: "auto" }}>
            {daily.isLoading ? null : <AreaChart series={d.heroSeries.length ? d.heroSeries : [0, 0]} id="hero" height={120} strong />}
          </div>
        </div>

        {/* spend */}
        <div className="tile spend">
          <div className="th"><span className="tname">Spend · {monthLabel}</span></div>
          <div className="bn tnum"><small>EGP</small>{money2(monthSpend)}</div>
          <div className="bar" style={{ marginTop: 18 }}><i style={{ width: `${spendRatio}%`, background: "linear-gradient(90deg,var(--violet),var(--mag))" }} /></div>
          <div style={{ fontSize: 12.5, color: "var(--dim)", fontWeight: 500, marginTop: 10 }}>{Math.round(spendRatio)}% of this month's revenue</div>
        </div>

        {/* net cash */}
        <div className="tile netcash">
          <div className="th"><span className="tname">Net cash · {monthLabel}</span></div>
          <div className="bn tnum" style={{ color: netCash >= 0 ? "var(--green)" : "var(--red)" }}><small>EGP</small>{money2(netCash)}</div>
          <div style={{ fontSize: 12.5, color: "var(--dim)", fontWeight: 500, marginTop: 18 }}>{Math.round(marginPct)}% cash margin · after all spend</div>
        </div>

        {/* performance gauge */}
        <div className="tile perf">
          <HealthGauge score={marginPct} label="Net cash margin" />
          <div className="hbody">
            <span className="eyebrow">Performance</span>
            <div className="hhead">You keep {Math.round(marginPct)}% of every pound after all spending this month.</div>
            <div className="hstats">
              <div className="hstat"><div className="l">Lifetime revenue</div><div className="v tnum">{egpShort(d.lifetimeRev)}</div></div>
              <div className="hstat"><div className="l">Cheques settled</div><div className="v tnum">{egpShort(cycle.data?.totalReceived ?? 0)}</div></div>
              <div className="hstat"><div className="l">Best month</div><div className="v tnum">{d.best.k ? `${MON[Number(d.best.k.slice(5, 7)) - 1]} ${d.best.k.slice(0, 4)}` : "—"}</div></div>
            </div>
          </div>
        </div>

        {/* revenue trend */}
        <div className="tile trend">
          <div className="th"><span className="tname">Revenue trend</span><span className="eyebrow" style={{ marginLeft: "auto" }}>monthly · all time</span></div>
          <div className="chartbox" style={{ height: 206, marginTop: 18 }}>
            {daily.isLoading ? <SkeletonRows rows={4} /> : <AreaChart series={d.monthly.map((m) => m.v)} id="trend" height={206} />}
          </div>
        </div>

        {/* this week — top products */}
        <div className="tile catalog">
          <div className="th"><span className="tname">This week</span><span className="eyebrow" style={{ marginLeft: "auto" }}>last 7 days</span></div>
          {week.isLoading ? <SkeletonRows rows={4} /> : weekTop.length === 0 ? <Note>No sales in the last 7 days.</Note> :
            weekTop.map((p) => (
              <div className="lrow" key={p.productId}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="lname" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                  <div className="bar"><i style={{ width: `${(p.revenue / weekMax) * 100}%`, background: "linear-gradient(90deg,var(--mag),var(--violet))" }} /></div>
                </div>
                <div className="lamt tnum">{egpShort(p.revenue).replace("EGP ", "")}</div>
              </div>
            ))}
        </div>

        {/* spend by category */}
        <div className="tile spendcat">
          <div className="th"><span className="tname">Spend by category</span><span className="eyebrow" style={{ marginLeft: "auto" }}>lifetime</span></div>
          {spendAll.isLoading ? <SkeletonRows rows={4} /> : cats.length === 0 ? <Note>No expenses recorded.</Note> :
            cats.map((c, i) => (
              <div className="lrow" key={c.label}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: CATCOL[i % CATCOL.length], flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}><div className="lname" style={{ textTransform: "capitalize" }}>{c.label}</div></div>
                <div className="lamt tnum">{egpShort(c.value).replace("EGP ", "")}</div>
              </div>
            ))}
        </div>

        {/* recent cheques */}
        <div className="tile cheques">
          <div className="th"><span className="tname">Recent cheques</span>
            <span className="tag" style={{ marginLeft: "auto", color: "var(--cyan)", background: "rgba(39,229,204,.12)" }}>{cycle.data?.cheques.length ?? 0} · {egpShort(cycle.data?.totalReceived ?? 0).replace("EGP ", "")}</span>
          </div>
          {cycle.isLoading ? <SkeletonRows rows={4} /> : cheques.length === 0 ? <Note>No cheques logged yet.</Note> :
            cheques.map((c) => (
              <div className="lrow" key={c.id}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="lname">{fmtDate(c.date, "d MMM yyyy")}</div>
                  <div className="lsub">{c.coverFrom ? `covers ${fmtDate(c.coverFrom, "d MMM")}–${fmtDate(c.coverTo, "d MMM")}` : "settlement cheque"}</div>
                </div>
                <div className="lamt tnum" style={{ color: "var(--cyan)" }}>{egpShort(c.amount).replace("EGP ", "")}</div>
              </div>
            ))}
        </div>

        {/* quick insight */}
        <div className="tile qinsight">
          <div className="th"><span className="tname">Quick insight</span>
            <Link className="go" to="/missing"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg></Link>
          </div>
          <div style={{ fontFamily: "'Clash Display'", fontWeight: 600, fontSize: 18, letterSpacing: "-.01em", lineHeight: 1.25, marginTop: 4 }}>
            {d.best.k ? `${MON[Number(d.best.k.slice(5, 7)) - 1]} ${d.best.k.slice(0, 4)} is your strongest month on record` : "Log a few days to unlock insights"}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 14 }}>
            <span className="disp" style={{ fontWeight: 700, fontSize: 26, color: "var(--green)" }}>{egp(d.best.v)}</span>
            {d.best.k && <span className="delta up">peak</span>}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--dim)", marginTop: 10, fontWeight: 500, lineHeight: 1.5 }}>
            Health score {health.data?.overall ?? "—"}/100 · {health.data?.status ?? "computing"}. Net cash margin is running at {Math.round(marginPct)}% this month.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   The remaining screens (Health, Gaps, Activity) keep the existing kit — they
   are separate routes, ported in a later pass.
   ═════════════════════════════════════════════════════════════════════════ */

const dot = (s: string) => (s === "high" ? "bg-bad" : s === "medium" ? "bg-warn" : "bg-dim");
const sevDot = (s: Severity) => (s === "critical" ? "bg-bad" : s === "warning" ? "bg-warn" : "bg-dim");
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

function Note({ children }: { children: React.ReactNode }) {
  return <div className="py-1 text-sm" style={{ color: "var(--dim)" }}>{children}</div>;
}

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
