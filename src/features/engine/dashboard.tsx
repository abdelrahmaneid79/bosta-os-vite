import { useMemo, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, Eyebrow, Pill, Badge, Button } from "@/components/ui";
import { MBars, DeckTile, TileHead } from "./deck";
import { EmptyState, SkeletonRows, ErrorState } from "@/components/feedback";
import { egp, egpShort } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { getMissingData } from "@/core/read/missing";
import { getRiskInsights } from "@/core/read/insights";
import { getActivityFeed, type ActivityEvent } from "@/core/read/activity";
import { getHealthReport, type HealthCategory } from "@/core/read/health";
import { getDailyRevenue } from "@/core/read/sales";
import { getExpenses } from "@/core/read/expenses";
import { getChequeCycle } from "@/core/read/settlements";
import { todayCairo, monthBoundsCairo } from "@/core/time";
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
      `renderLine`): responsive SVG + hover crosshair/dot/tooltip + optional axis. */
interface ChartPt { label: string; value: number; full?: string }
function AreaChart({ data, id, height = 200, strong = false, axis = false }: { data: ChartPt[]; id: string; height?: number; strong?: boolean; axis?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const W = 700, H = height, padL = 4, padR = 6, padT = 14, padB = axis ? 24 : 8;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const d = data.length ? data : [{ label: "", value: 0 }, { label: "", value: 0 }];
  const vals = d.map((x) => x.value);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const lo = min < 0 ? min - span * 0.14 : 0;               // revenue starts the axis at 0
  const hi = max <= 0 ? 1 : max + span * 0.14;
  const pts = vals.map((v, i) => ({ x: padL + (i / (vals.length - 1 || 1)) * plotW, y: padT + (1 - (v - lo) / (hi - lo)) * plotH }));
  const line = smoothPath(pts);
  const baseY = padT + plotH;
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${baseY.toFixed(1)} L${pts[0].x.toFixed(1)},${baseY.toFixed(1)} Z`;
  const onMove = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect(); if (!r) return;
    const rel = ((e.clientX - r.left) / r.width - padL / W) / (plotW / W);
    setHover(Math.max(0, Math.min(vals.length - 1, Math.round(rel * (vals.length - 1)))));
  };
  const hp = hover != null ? d[hover] : null;
  const xStep = Math.max(1, Math.ceil(vals.length / 6));
  const chart = (
    <div ref={ref} className="chartbox" style={{ height: H, cursor: "crosshair" }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg className="chsvg" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`gf_${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--mag)" stopOpacity={strong ? 0.42 : 0.26} /><stop offset="1" stopColor="var(--mag)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`gs_${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--violet)" /><stop offset="0.55" stopColor="var(--mag)" /><stop offset="1" stopColor="var(--cyan)" />
          </linearGradient>
        </defs>
        {axis && [0, 0.5, 1].map((g, i) => <line key={i} x1={padL} y1={padT + plotH * g} x2={W - padR} y2={padT + plotH * g} className="grid-line" />)}
        <path className="ar-fill" fill={`url(#gf_${id})`} d={area} />
        <path className="ln" fill="none" stroke={`url(#gs_${id})`} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" pathLength={1} d={line} />
      </svg>
      {axis && <div className="chaxis">{d.map((p, i) => (i % xStep === 0 || i === d.length - 1) ? <span key={i} style={{ left: `${(pts[i].x / W) * 100}%` }}>{p.label}</span> : null)}</div>}
      {hp && (<>
        <div className="cross" style={{ left: `${(pts[hover!].x / W) * 100}%` }} />
        <div className="cdot" style={{ left: `${(pts[hover!].x / W) * 100}%`, top: pts[hover!].y }} />
        <div className="ctip" style={{ left: `${(pts[hover!].x / W) * 100}%`, top: pts[hover!].y }}><b>EGP {money2(hp.value)}</b><span>{hp.full ?? hp.label}</span></div>
      </>)}
    </div>
  );
  if (!axis) return chart;
  return (
    <div style={{ position: "relative", paddingLeft: 46 }}>
      <div className="chyax" style={{ bottom: padB }}>{[hi, (hi + lo) / 2, lo].map((v, i) => <span key={i}>{egpShort(v).replace("EGP ", "")}</span>)}</div>
      {chart}
    </div>
  );
}

/* ── Health gauge — top semicircle arc (the design's `.hgauge` / `.gv`). ───── */
function HealthGauge({ score, label, suffix = "%", color }: { score: number; label: string; suffix?: string; color?: string }) {
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
        <path className="gv" d={path} stroke={color ?? "url(#gauge-grad)"} style={{ strokeDasharray: `${(clamp / 100) * arc} 999` }} />
      </svg>
      <div className="hscore" style={color ? { color } : undefined}>{Math.round(clamp)}{suffix}</div>
      <div className="hslab" style={color ? { color } : undefined}>{label}</div>
    </div>
  );
}

const Ic = {
  rev: <path d="M3 3v18h18M7 14l3-3 3 3 5-6" />,
  spend: <path d="M6 2h9l5 5v15H4V2zM9 13h6M9 17h6" />,
  cash: <path d="M3 7h18v11H3zM3 11h18M7 15h2" />,
  bell: <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />,
  profit: <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
  bank: <path d="M3 21h18M5 21V10M19 21V10M3 10l9-6 9 6M9 21v-6h6v6" />,
  star: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
};

/* ═══ TODAY / COMMAND DECK ═══════════════════════════════════════════════ */
export function DashboardScreen() {
  const today = todayCairo();
  const month = monthBoundsCairo();
  const histFrom = "2024-01-01";
  const [trendR, setTrendR] = useState<"1D" | "1W" | "1M" | "3M" | "6M" | "All" | "Custom">("3M");
  const [cFrom, setCFrom] = useState("");
  const [cTo, setCTo] = useState("");

  const daily = useQuery({ queryKey: ["dailyHist", histFrom], queryFn: () => getDailyRevenue({ from: histFrom, to: today }), enabled: en });
  const spendAll = useQuery({ queryKey: ["dash-spend", histFrom], queryFn: () => getExpenses({ from: histFrom, to: today }), enabled: en });
  const health = useQuery({ queryKey: ["health"], queryFn: getHealthReport, enabled: en });
  const cycle = useQuery({ queryKey: ["cheque-cycle"], queryFn: getChequeCycle, enabled: en });

  const rows = daily.data ?? [];
  const byDay = useMemo(() => new Map(rows.map((r) => [r.date, r.total])), [rows]);
  const d = useMemo(() => {
    const bucket = new Map<string, number>();
    for (const r of rows) bucket.set(r.date.slice(0, 7), (bucket.get(r.date.slice(0, 7)) ?? 0) + r.total);
    const monthly = [...bucket.keys()].sort().map((k) => ({ k, v: bucket.get(k)! }));
    const active = monthly.filter((m) => m.v > 0);
    const cur = active[active.length - 1] ?? { k: month.from.slice(0, 7), v: 0 };
    const prev = active[active.length - 2] ?? { k: "", v: 0 };
    const lifetimeRev = rows.reduce((s, r) => s + r.total, 0);
    const best = monthly.reduce((b, m) => (m.v > b.v ? m : b), { k: "", v: 0 });
    const dates = rows.map((r) => r.date).sort();
    const latest = rows.filter((r) => r.total > 0).map((r) => r.date).sort().pop() ?? today;
    return { monthKey: cur.k, monthRev: cur.v, lastRev: prev.v, monthly, lifetimeRev, best, earliest: dates[0] ?? today, latest };
  }, [rows, month.from, today]);

  if (daily.isError) return <ErrorState message={String((daily.error as Error)?.message)} />;
  if (!en) return <EmptyState title="Sign in to load your deck" hint="Wired to your live data only — never faked." />;

  const monthNum = +d.monthKey.slice(5, 7), yearNum = +d.monthKey.slice(0, 4);
  const monthLabel = `${MON[monthNum - 1]} ${yearNum}`, monthShort = MON[monthNum - 1], prevMonthShort = MON[(monthNum + 10) % 12];
  const revDelta = pctDelta(d.monthRev, d.lastRev);
  const mTo2 = `${d.monthKey}-${String(new Date(yearNum, monthNum, 0).getDate()).padStart(2, "0")}`;
  const monthDays = isoRangeDays(`${d.monthKey}-01`, mTo2 <= today ? mTo2 : today);
  const tradingDays = monthDays.filter((x) => (byDay.get(x) ?? 0) > 0).length || monthDays.length;
  const avgPerDay = tradingDays ? d.monthRev / tradingDays : 0;
  const heroData: ChartPt[] = monthDays.map((x) => ({ label: fmtDate(x, "d MMM"), full: fmtDate(x, "d MMM yyyy"), value: byDay.get(x) ?? 0 }));

  const spendRows = spendAll.data ?? [];
  const monthSpend = spendRows.filter((e) => e.date.slice(0, 7) === d.monthKey).reduce((s, e) => s + e.amount, 0);
  const netCash = d.monthRev - monthSpend;
  const marginPct = d.monthRev > 0 ? Math.round((netCash / d.monthRev) * 100) : 0;
  const spendRatio = d.monthRev > 0 ? Math.min(100, Math.round((monthSpend / d.monthRev) * 100)) : 0;
  const gaugeCol = marginPct >= 55 ? "var(--green)" : marginPct >= 35 ? "var(--amber)" : "var(--red)";

  const catMap = new Map<string, number>();
  for (const e of spendRows) catMap.set(e.category, (catMap.get(e.category) ?? 0) + e.amount);
  const cats = [...catMap.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5);
  const catMax = Math.max(1, ...cats.map((c) => c.value));
  const CATCOL = ["var(--mag)", "var(--violet)", "var(--cyan)", "var(--amber)", "var(--lime)"];

  const venMap = new Map<string, number>();
  for (const e of spendRows) if (e.notes) venMap.set(e.notes, (venMap.get(e.notes) ?? 0) + e.amount);
  const topVen = [...venMap.entries()].sort((a, b) => b[1] - a[1])[0];
  const stockSpend = spendRows.filter((e) => !e.isOperating).reduce((s, e) => s + e.amount, 0);
  const venPct = topVen && stockSpend ? Math.round((topVen[1] / stockSpend) * 100) : 0;

  const cheques = (cycle.data?.cheques ?? []).slice(0, 4);
  const hs = health.data;

  // this week — daily bars ending at the latest recorded day
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekDays = isoRangeDays(isoShift(d.latest, -6), d.latest);
  const weekBars = weekDays.map((x) => ({ label: WD[new Date(x + "T00:00:00").getDay()], full: fmtDate(x, "EEE d MMM"), value: byDay.get(x) ?? 0 }));
  const weekTotal = weekBars.reduce((s, b) => s + b.value, 0);
  const priorTotal = isoRangeDays(isoShift(d.latest, -13), isoShift(d.latest, -7)).reduce((s, x) => s + (byDay.get(x) ?? 0), 0);
  const weekDelta = pctDelta(weekTotal, priorTotal);

  // trend — daily over the selected window
  const trendTo = trendR === "Custom" ? (cTo || d.latest) : d.latest;
  const trendFrom = trendR === "Custom" ? (cFrom || d.earliest)
    : trendR === "All" ? d.earliest
    : (() => { const n = { "1D": 1, "1W": 7, "1M": 30, "3M": 90, "6M": 180 }[trendR]; const f = isoShift(trendTo, -(n - 1)); return f < d.earliest ? d.earliest : f; })();
  const trendData: ChartPt[] = isoRangeDays(trendFrom, trendTo).map((x) => ({ label: fmtDate(x, "d MMM"), full: fmtDate(x, "d MMM yyyy"), value: byDay.get(x) ?? 0 }));

  return (
    <div className="cdk space-y-5">
      {/* ── ticker ─────────────────────────────────────────────────────── */}
      <div className="ticker">
        <div className="tk">
          <div className="tkic" style={{ background: "rgba(255,61,168,.14)", color: "var(--mag)" }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">{Ic.rev}</svg></div>
          <div><div className="tkl">Revenue · {monthShort}</div><div className="tkv tnum">{money2(d.monthRev)}{revDelta != null && <em style={{ color: revDelta >= 0 ? "var(--green)" : "var(--red)", fontStyle: "normal", fontSize: 11, fontWeight: 700 }}> {revDelta >= 0 ? "▲" : "▼"}{Math.abs(revDelta).toFixed(1)}%</em>}</div></div>
        </div>
        <div className="tk">
          <div className="tkic" style={{ background: "rgba(157,107,255,.14)", color: "var(--violet)" }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">{Ic.spend}</svg></div>
          <div><div className="tkl">Spend · {monthShort}</div><div className="tkv tnum">{money2(monthSpend)}</div></div>
        </div>
        <div className="tk">
          <div className="tkic" style={{ background: "rgba(39,229,204,.14)", color: "var(--cyan)" }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">{Ic.bank}</svg></div>
          <div><div className="tkl">Cheques logged</div><div className="tkv tnum">{cycle.data?.cheques.length ?? 0} · EGP {egpShort(cycle.data?.totalReceived ?? 0).replace("EGP ", "")}</div></div>
        </div>
        <div className="tk">
          <span className="live"><span className="livedot" /> LIVE</span>
          <div><div className="tkl">Books to</div><div className="tkv" style={{ fontSize: 14 }}>{fmtDate(d.latest, "d MMM yyyy")}</div></div>
        </div>
      </div>

      {/* ── grid ───────────────────────────────────────────────────────── */}
      <div className="deckgrid">
        {/* hero — revenue for the latest reporting month */}
        <div className="tile hero">
          <div className="orb" />
          <div className="heronut"><img src="/assets/bosta-mascot.svg" alt="" /></div>
          <div className="th"><span className="eyebrow">Revenue · {monthLabel}</span></div>
          <div style={{ fontSize: 12.5, color: "var(--dim)", fontWeight: 500, marginTop: 2 }}>Latest reporting month · {tradingDays} trading days</div>
          <div className="hv tnum" style={{ marginTop: "auto" }}><span className="hcur">EGP</span>{money2(d.monthRev)}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            {revDelta != null && (
              <span className={`delta ${revDelta >= 0 ? "up" : "down"}`}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">{revDelta >= 0 ? <path d="M3 8l3-3 3 3" /> : <path d="M3 4l3 3 3-3" />}</svg>
                {Math.abs(revDelta).toFixed(1)}%
              </span>
            )}
            <span style={{ fontSize: 12.5, color: "var(--dim)", fontWeight: 500 }}>{d.lastRev > 0 ? `vs EGP ${money2(d.lastRev)} in ${prevMonthShort}` : "first month"} · EGP {money2(avgPerDay)}/day avg</span>
          </div>
          <div style={{ marginTop: 14 }}>{daily.isLoading ? null : <AreaChart data={heroData} id="hero" height={110} strong />}</div>
        </div>

        {/* spend */}
        <div className="tile spend">
          <div className="th"><span className="tname">Spend · {monthShort}</span></div>
          <div className="bn tnum"><small>EGP</small>{money2(monthSpend)}</div>
          <div className="bar" style={{ marginTop: 18 }}><i style={{ width: `${spendRatio}%`, background: "linear-gradient(90deg,var(--violet),var(--mag))" }} /></div>
          <div style={{ fontSize: 12.5, color: "var(--dim)", fontWeight: 500, marginTop: 10 }}>{spendRatio}% of {monthShort} revenue · mostly stock</div>
        </div>

        {/* net cash */}
        <div className="tile netcash">
          <div className="th"><span className="tname">Net cash · {monthShort}</span></div>
          <div className="bn tnum" style={{ color: netCash >= 0 ? "var(--green)" : "var(--red)" }}><small>EGP</small>{money2(netCash)}</div>
          <div style={{ fontSize: 12.5, color: "var(--dim)", fontWeight: 500, marginTop: 18 }}>{marginPct}% cash margin · revenue − recorded spend</div>
        </div>

        {/* performance gauge */}
        <div className="tile perf">
          <HealthGauge score={marginPct} suffix="%" color={gaugeCol} label="Net cash margin" />
          <div className="hbody">
            <span className="eyebrow">Performance · lifetime</span>
            <div className="hhead">EGP {money2(d.lifetimeRev)} earned to date — {hs?.status ? hs.status.toLowerCase() : "steady"} cash conversion.</div>
            <div className="hstats">
              <div className="hstat"><div className="l">Lifetime revenue</div><div className="v tnum">{egpShort(d.lifetimeRev).replace("EGP ", "")}</div></div>
              <div className="hstat"><div className="l">Cheques settled</div><div className="v tnum">{egpShort(cycle.data?.totalReceived ?? 0).replace("EGP ", "")}</div></div>
              <div className="hstat"><div className="l">Best month</div><div className="v tnum">{d.best.k ? `${MON[+d.best.k.slice(5, 7) - 1]} ${d.best.k.slice(2, 4)}` : "—"}</div></div>
            </div>
          </div>
        </div>

        {/* revenue trend — daily */}
        <div className="tile trend">
          <div className="th"><span className="tname">Revenue trend</span>
            <div className="seg big" style={{ marginLeft: "auto" }}>
              {(["1D", "1W", "1M", "3M", "6M", "All"] as const).map((r) => <span key={r} className={trendR === r ? "on" : ""} onClick={() => setTrendR(r)}>{r}</span>)}
              <span className={"cust" + (trendR === "Custom" ? " on" : "")} onClick={() => setTrendR("Custom")}>Custom</span>
            </div>
          </div>
          {trendR === "Custom" && (
            <div className="crange" style={{ marginTop: 12 }}>
              <span style={{ fontSize: 12, color: "var(--dim)", fontWeight: 600 }}>From</span>
              <input type="date" value={cFrom || d.earliest} min={d.earliest} max={d.latest} onChange={(e) => setCFrom(e.target.value)} />
              <span style={{ fontSize: 12, color: "var(--dim)", fontWeight: 600 }}>to</span>
              <input type="date" value={cTo || d.latest} min={d.earliest} max={d.latest} onChange={(e) => setCTo(e.target.value)} />
            </div>
          )}
          <div style={{ marginTop: 18 }}>{daily.isLoading ? <SkeletonRows rows={4} /> : <AreaChart data={trendData} id="trend" height={206} axis />}</div>
        </div>

        {/* this week */}
        <div className="tile catalog">
          <div className="th"><span className="tname">This week</span><span className="eyebrow" style={{ marginLeft: "auto" }}>last 7 days</span></div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
            <span className="disp" style={{ fontWeight: 700, fontSize: 27, letterSpacing: "-.02em" }}>EGP {money2(weekTotal)}</span>
            {weekDelta != null && <span className={`delta ${weekDelta >= 0 ? "up" : "down"}`}>{weekDelta >= 0 ? "+" : ""}{weekDelta.toFixed(1)}%</span>}
          </div>
          <div style={{ fontSize: 12, color: "var(--dim)", marginTop: 6, fontWeight: 500 }}>{fmtDate(weekDays[0], "d MMM")}–{fmtDate(d.latest, "d MMM")} · vs EGP {money2(priorTotal)} prior 7 days</div>
          <div style={{ marginTop: 14 }}><MBars data={weekBars} height={120} /></div>
        </div>

        {/* spend by category */}
        <div className="tile spendcat">
          <div className="th"><span className="tname">Spend by category</span><span className="eyebrow" style={{ marginLeft: "auto" }}>lifetime</span></div>
          {spendAll.isLoading ? <SkeletonRows rows={4} /> : cats.length === 0 ? <Note>No expenses recorded.</Note> :
            cats.map((c, i) => (
              <div className="lrow" key={c.label}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: CATCOL[i % CATCOL.length], flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="lname" style={{ textTransform: "capitalize" }}>{c.label}</div>
                  <div className="bar"><i style={{ width: `${(c.value / catMax) * 100}%`, background: CATCOL[i % CATCOL.length] }} /></div>
                </div>
                <div className="lamt tnum">{money2(c.value)}</div>
              </div>
            ))}
        </div>

        {/* recent cheques */}
        <div className="tile cheques">
          <div className="th"><span className="tname">Recent cheques</span><span className="tag" style={{ marginLeft: "auto", color: "var(--cyan)", background: "rgba(39,229,204,.12)" }}>{cycle.data?.cheques.length ?? 0} · {egpShort(cycle.data?.totalReceived ?? 0).replace("EGP ", "")}</span></div>
          {cycle.isLoading ? <SkeletonRows rows={4} /> : cheques.length === 0 ? <Note>No cheques logged yet.</Note> :
            cheques.map((c) => (
              <div className="lrow" key={c.id}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="lname">Cheque deposited</div>
                  <div className="lsub">{fmtDate(c.date, "d MMM yyyy")}</div>
                </div>
                <div className="lamt tnum" style={{ color: "var(--cyan)" }}>{money2(c.amount)}</div>
              </div>
            ))}
        </div>

        {/* quick insight */}
        <div className="tile qinsight">
          <div className="th"><span className="tname">Quick insight</span><Link className="go" to="/missing"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg></Link></div>
          <div style={{ fontFamily: "'Clash Display'", fontWeight: 600, fontSize: 18, letterSpacing: "-.01em", lineHeight: 1.25, marginTop: 4 }}>
            {d.best.k ? `${MON[+d.best.k.slice(5, 7) - 1]} ${d.best.k.slice(0, 4)} was the strongest month on record` : "Log a few days to unlock insights"}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 14 }}>
            <span className="disp" style={{ fontWeight: 700, fontSize: 26, color: "var(--green)" }}>EGP {money2(d.best.v)}</span>
            {d.best.k && <span className="delta up">peak</span>}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--dim)", marginTop: 10, fontWeight: 500, lineHeight: 1.5 }}>
            {topVen ? `Top supplier is ${topVen[0]} at EGP ${money2(topVen[1])} across all purchases — ${venPct}% of stock spend.` : "Add supplier notes on purchases to surface your top supplier."}
          </div>
        </div>
      </div>
    </div>
  );
}

const isoShift = (iso: string, days: number): string => { const dt = new Date(iso + "T00:00:00"); dt.setDate(dt.getDate() + days); return dt.toISOString().slice(0, 10); };

/** Inclusive list of ISO dates between two bounds. */
function isoRangeDays(from: string, to: string): string[] {
  const out: string[] = []; const d = new Date(from + "T00:00:00"); const end = new Date(to + "T00:00:00");
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return out;
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

/* ─ Business Health — Command Deck layout (identical to the design) ───────── */
export function HealthScreen() {
  const today = todayCairo();
  const q = useQuery({ queryKey: ["health"], queryFn: getHealthReport, enabled: en });
  const daily = useQuery({ queryKey: ["dailyHist", "2024-01-01"], queryFn: () => getDailyRevenue({ from: "2024-01-01", to: today }), enabled: en });
  const exp = useQuery({ queryKey: ["dash-spend", "2024-01-01"], queryFn: () => getExpenses({ from: "2024-01-01", to: today }), enabled: en });
  if (!en) return <EmptyState title="Sign in to compute health" hint="Built from your real data only — never faked." />;
  if (q.isLoading) return <SkeletonRows rows={5} />;
  if (q.isError) return <ErrorState message={String((q.error as Error)?.message)} />;
  const h = q.data!;
  const score = h.overall ?? 0;
  const col = score >= 75 ? "var(--green)" : score >= 55 ? "var(--amber)" : "var(--red)";
  const R = 80, C = 2 * Math.PI * R;

  const rev = new Map<string, number>(); for (const r of daily.data ?? []) rev.set(r.date.slice(0, 7), (rev.get(r.date.slice(0, 7)) ?? 0) + r.total);
  const spend = new Map<string, number>(); for (const e of exp.data ?? []) spend.set(e.date.slice(0, 7), (spend.get(e.date.slice(0, 7)) ?? 0) + e.amount);
  const months = [...rev.keys()].sort().slice(-6);
  const net6 = months.map((m) => ({ label: MON[+m.slice(5, 7) - 1], full: `${MON[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`, value: (rev.get(m) ?? 0) - (spend.get(m) ?? 0) }));

  const scored = h.categories.filter((c): c is HealthCategory & { score: number } => c.score != null);
  const strengths = scored.filter((c) => c.score >= 65);
  const risks = scored.filter((c) => c.score < 65);
  const cc = (s: number) => (s >= 70 ? "var(--green)" : s >= 45 ? "var(--amber)" : "var(--red)");
  const summary = `Overall health is ${h.status.toLowerCase()} at ${score}/100${strengths[0] ? `, led by ${strengths[0].label.toLowerCase()}` : ""}${risks[0] ? ` and held back by ${risks[0].label.toLowerCase()}` : ""}.`;
  const li = (c: HealthCategory, good: boolean) => (
    <div className="bhitem" key={c.key}>
      <svg viewBox="0 0 24 24" fill="none" stroke={good ? "var(--green)" : "var(--amber)"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {good ? <path d="M20 6 9 17l-5-5" /> : <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />}
      </svg>
      <div><b style={{ color: "var(--text)", fontWeight: 600 }}>{c.label}</b> — {c.reason}</div>
    </div>
  );

  return (
    <div>
      <div className="bh">
        <DeckTile>
          <div className="bhscore">
            <div className="pulse" style={{ borderColor: col }} />
            <div className="pulse" style={{ borderColor: col, animationDelay: "1.6s" }} />
            <svg width={200} height={200} viewBox="0 0 200 200">
              <circle cx={100} cy={100} r={80} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth={14} />
              <circle cx={100} cy={100} r={80} fill="none" stroke={col} strokeWidth={14} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - score / 100)} transform="rotate(-90 100 100)" style={{ filter: `drop-shadow(0 0 9px ${col})` }} />
            </svg>
            <div style={{ position: "absolute", textAlign: "center" }}>
              <div className="bhbig" style={{ color: col }}>{score}</div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: col }}>{h.status}</div>
            </div>
          </div>
          <div style={{ textAlign: "center", fontSize: 13, color: "var(--muted)", marginTop: 16, lineHeight: 1.55 }}>{summary}</div>
          <div style={{ marginTop: 22, width: "100%" }}>
            <div className="eyebrow" style={{ color: "var(--dim)", marginBottom: 10 }}>Net cash · last 6 months</div>
            <MBars data={net6} height={74} gradient={`linear-gradient(180deg,${col},rgba(157,107,255,.4))`} />
          </div>
        </DeckTile>
        <DeckTile>
          <TileHead name="Health by dimension" right="weighted score" />
          {h.categories.map((c) => {
            const col2 = c.score == null ? "var(--faint)" : cc(c.score);
            return (
              <div className="meter" key={c.key}>
                <div className="mh"><span className="mn">{c.label}</span><span className="ms" style={{ color: col2 }}>{c.score == null ? "—" : Math.round(c.score)}<span style={{ color: "var(--faint)", fontSize: 11 }}>/100</span></span></div>
                <div className="track"><i style={{ width: `${c.score == null ? 0 : Math.round(c.score)}%`, background: col2 }} /></div>
                <div className="mt">{c.reason}</div>
              </div>
            );
          })}
        </DeckTile>
      </div>
      <div className="row2" style={{ marginTop: 16 }}>
        <DeckTile><TileHead name={<span style={{ color: "var(--green)" }}>Working well</span>} />{strengths.length ? strengths.map((c) => li(c, true)) : <div className="bhitem"><div>Nothing is clearly strong yet — keep logging records.</div></div>}</DeckTile>
        <DeckTile><TileHead name={<span style={{ color: "var(--amber)" }}>Watch closely</span>} />{risks.length ? risks.map((c) => li(c, false)) : <div className="bhitem"><div>Nothing flashing red — keep it up.</div></div>}</DeckTile>
      </div>
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
  const navigate = useNavigate();
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
        <DeckTile style={{ padding: 0 }}><div className="scroll" style={{ maxHeight: "70vh" }}>
          <table className="tbl">
            <thead><tr><th>Date</th><th>Event</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {feed.data!.map((e) => (
                <tr key={`${e.kind}-${e.id}`} className="prodcell" onClick={() => navigate(e.route)}>
                  <td style={{ whiteSpace: "nowrap", color: "var(--dim)" }}>{fmtDate(e.date, "d MMM yyyy")}</td>
                  <td><span style={{ marginRight: 8 }}>{kindGlyph[e.kind]}</span>{e.label}</td>
                  <td className="r" style={{ color: e.amount > 0 ? "var(--green)" : "var(--muted)" }}>{e.amount !== 0 ? `${e.amount > 0 ? "+" : "−"}${egp(Math.abs(e.amount))}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></DeckTile>
      )}
    </div>
  );
}
