import { useMemo, useState, useRef } from "react";
import { CountUp, Sheet } from "@/components/ui/motion";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart } from "@/components/charts";
import { EmptyState, SkeletonRows, ErrorState } from "@/components/feedback";
import { egpShort, egpShortBare } from "@/core/utils/format";
import { ALL_TIME_FROM } from "@/core/range";
import { getPurchaseTotal } from "@/core/read/purchases";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { getDailyRevenue } from "@/core/read/sales";
import { getExpenses } from "@/core/read/expenses";
import { getChequeCycle } from "@/core/read/settlements";
import { todayCairo, monthBoundsCairo, isoDaysAgo, isoRange } from "@/core/time";

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
  // Map a client X to the nearest data point — shared by mouse hover and touch
  // swipe so dragging a finger across the chart scrubs exactly like hovering.
  const setFromX = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect(); if (!r) return;
    const rel = ((clientX - r.left) / r.width - padL / W) / (plotW / W);
    setHover(Math.max(0, Math.min(vals.length - 1, Math.round(rel * (vals.length - 1)))));
  };
  // ONE pointer handler = smooth mouse hover AND touch-drag scrubbing.
  const onPoint = (e: React.PointerEvent) => setFromX(e.clientX);
  const hp = hover != null ? d[hover] : null;
  const xStep = Math.max(1, Math.ceil(vals.length / 6));
  const chart = (
    <div ref={ref} className="chartbox" style={{ height: H, cursor: "crosshair", touchAction: "none" }} onPointerDown={onPoint} onPointerMove={onPoint} onPointerLeave={() => setHover(null)}>
      <svg className="chsvg" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`gf_${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--mag)" stopOpacity={strong ? 0.42 : 0.26} /><stop offset="1" stopColor="var(--mag)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`gs_${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="rgb(var(--violet))" /><stop offset="0.55" stopColor="var(--mag)" /><stop offset="1" stopColor="rgb(var(--cyan))" />
          </linearGradient>
        </defs>
        {axis && [0, 0.5, 1].map((g, i) => <line key={i} x1={padL} y1={padT + plotH * g} x2={W - padR} y2={padT + plotH * g} className="grid-line" />)}
        <path className="ar-fill" fill={`url(#gf_${id})`} d={area} />
        <path className="ln" fill="none" stroke={`url(#gs_${id})`} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" pathLength={1} d={line} />
      </svg>
      {axis && <div className="chaxis">{d.map((p, i) => (i % xStep === 0 || i === d.length - 1) ? <span key={i} style={{ left: `${(pts[i].x / W) * 100}%`, color: hover === i ? "var(--mag)" : undefined }}>{p.label}</span> : null)}</div>}
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
            <stop offset="0" stopColor="rgb(var(--cyan))" /><stop offset="1" stopColor="var(--green)" />
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
  const histFrom = ALL_TIME_FROM;
  const [trendR, setTrendR] = useState<"1D" | "1W" | "1M" | "3M" | "6M" | "All" | "Custom">("3M");
  const [sheet, setSheet] = useState<null | "spend" | "week" | "cheques">(null);
  const [cFrom, setCFrom] = useState("");
  const [cTo, setCTo] = useState("");

  const daily = useQuery({ queryKey: ["dailyHist", histFrom], queryFn: () => getDailyRevenue({ from: histFrom, to: today }), enabled: en });
  const spendAll = useQuery({ queryKey: ["dash-spend", histFrom], queryFn: () => getExpenses({ from: histFrom, to: today }), enabled: en });
  const cycle = useQuery({ queryKey: ["cheque-cycle"], queryFn: getChequeCycle, enabled: en });
  const monthPurch = useQuery({ queryKey: ["dash-purch", month.from], queryFn: () => getPurchaseTotal({ from: month.from, to: month.to }), enabled: en });

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
    return { monthKey: cur.k, monthRev: cur.v, lastRev: prev.v, prevKey: prev.k, monthly, lifetimeRev, best, earliest: dates[0] ?? today, latest };
  }, [rows, month.from, today]);

  if (daily.isError) return <ErrorState message={String((daily.error as Error)?.message)} />;
  if (!en) return <EmptyState title="Sign in to load your deck" />;

  const monthNum = +d.monthKey.slice(5, 7), yearNum = +d.monthKey.slice(0, 4);
  const monthLabel = `${MON[monthNum - 1]} ${yearNum}`, monthShort = MON[monthNum - 1];
  // name the month actually compared against (the previous ACTIVE month, which
  // is not always the calendar-previous one when a month has no data)
  const prevMonthShort = d.prevKey ? `${MON[+d.prevKey.slice(5, 7) - 1]}${d.prevKey.slice(0, 4) !== String(yearNum) ? " " + d.prevKey.slice(2, 4) : ""}` : MON[(monthNum + 10) % 12];
  const revDelta = pctDelta(d.monthRev, d.lastRev);
  const mTo2 = `${d.monthKey}-${String(new Date(yearNum, monthNum, 0).getDate()).padStart(2, "0")}`;
  const monthDays = isoRange(`${d.monthKey}-01`, mTo2 <= today ? mTo2 : today);
  const tradingDays = monthDays.filter((x) => (byDay.get(x) ?? 0) > 0).length;
  const avgPerDay = tradingDays ? d.monthRev / tradingDays : 0;
  const heroData: ChartPt[] = monthDays.map((x) => ({ label: fmtDate(x, "d MMM"), full: fmtDate(x, "d MMM yyyy"), value: byDay.get(x) ?? 0 }));

  const spendRows = spendAll.data ?? [];
  const monthExpRows = spendRows.filter((e) => e.date.slice(0, 7) === d.monthKey);
  const monthSpend = monthExpRows.reduce((s, e) => s + e.amount, 0);
  const monthStockExp = monthExpRows.filter((e) => !e.isOperating).reduce((s, e) => s + e.amount, 0);
  const stockShare = monthSpend > 0 ? Math.round((monthStockExp / monthSpend) * 100) : 0;
  const monthOut = monthSpend + (monthPurch.data ?? 0); // expenses + purchase-batch stock buys
  const netCash = d.monthRev - monthOut;
  const marginPct = d.monthRev > 0 ? Math.round((netCash / d.monthRev) * 100) : 0;
  const loadErr = spendAll.isError || cycle.isError || monthPurch.isError;
  const spendRatio = d.monthRev > 0 ? Math.min(100, Math.round((monthSpend / d.monthRev) * 100)) : 0;
  const gaugeCol = marginPct >= 55 ? "var(--green)" : marginPct >= 35 ? "var(--amber)" : "var(--red)";

  const catMap = new Map<string, number>();
  for (const e of spendRows) catMap.set(e.category, (catMap.get(e.category) ?? 0) + e.amount);
  const cats = [...catMap.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5);
  const catMax = Math.max(1, ...cats.map((c) => c.value));
  const CATCOL = ["var(--mag)", "rgb(var(--violet))", "rgb(var(--cyan))", "var(--amber)", "rgb(var(--lime))"];

  const venMap = new Map<string, number>();
  for (const e of spendRows) if (e.notes && !e.isOperating) venMap.set(e.notes, (venMap.get(e.notes) ?? 0) + e.amount);
  const topVen = [...venMap.entries()].sort((a, b) => b[1] - a[1])[0];
  const stockSpend = spendRows.filter((e) => !e.isOperating).reduce((s, e) => s + e.amount, 0);
  const venPct = topVen && stockSpend ? Math.round((topVen[1] / stockSpend) * 100) : 0;

  const cheques = (cycle.data?.cheques ?? []).slice(0, 4);

  // this week — daily bars ending at the latest recorded day
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekDays = isoRange(isoDaysAgo(d.latest, 6), d.latest);
  const weekBars = weekDays.map((x) => ({ label: WD[new Date(x + "T00:00:00Z").getUTCDay()], full: fmtDate(x, "EEE d MMM yyyy"), value: byDay.get(x) ?? 0 }));
  const weekTotal = weekBars.reduce((s, b) => s + b.value, 0);
  const priorTotal = isoRange(isoDaysAgo(d.latest, 13), isoDaysAgo(d.latest, 7)).reduce((s, x) => s + (byDay.get(x) ?? 0), 0);
  const weekDelta = pctDelta(weekTotal, priorTotal);

  // trend — daily over the selected window
  const trendTo = trendR === "Custom" ? (cTo || d.latest) : d.latest;
  const trendFrom = trendR === "Custom" ? (cFrom || d.earliest)
    : trendR === "All" ? d.earliest
    : (() => { const n = { "1D": 1, "1W": 7, "1M": 30, "3M": 90, "6M": 180 }[trendR]; const f = isoDaysAgo(trendTo, n - 1); return f < d.earliest ? d.earliest : f; })();
  const trendData: ChartPt[] = isoRange(trendFrom, trendTo).map((x) => ({ label: fmtDate(x, "d MMM"), full: fmtDate(x, "d MMM yyyy"), value: byDay.get(x) ?? 0 }));

  return (
    <div className="cdk space-y-5">
      {loadErr && (
        <div style={{ border: "1px solid rgb(var(--warn))", background: "rgba(255,177,62,.08)", color: "rgb(var(--warn))", borderRadius: 12, padding: "8px 14px", fontSize: 12.5, fontWeight: 600 }}>
          Some data didn't load — figures below may be incomplete. Reload to retry.
        </div>
      )}
      {/* ═══ HERO — the one answer: how is this month going? ═══ */}
      <div className="deckgrid">
        <div className="tile hero">
          <div className="orb" />
          <div className="heronut"><img src="/assets/bosta-mascot.svg" alt="" /></div>
          <div className="th"><span className="eyebrow">This month · {monthLabel}</span></div>
          <div style={{ fontSize: 12.5, color: "rgb(var(--dim))", fontWeight: 500, marginTop: 2 }}>
            {tradingDays} trading days · books to {fmtDate(d.latest, "d MMM")}
          </div>
          <div className="hv tnum" style={{ marginTop: "auto" }}>
            <span className="hcur">EGP</span>{daily.isLoading ? "…" : <CountUp value={d.monthRev} />}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            {revDelta != null && (
              <span className={`delta ${revDelta >= 0 ? "up" : "down"}`}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">{revDelta >= 0 ? <path d="M3 8l3-3 3 3" /> : <path d="M3 4l3 3 3-3" />}</svg>
                {Math.abs(revDelta).toFixed(1)}%
              </span>
            )}
            <span style={{ fontSize: 12.5, color: "rgb(var(--dim))", fontWeight: 500 }}>
              {d.lastRev > 0 ? `vs ${prevMonthShort}` : "first month"} · EGP {money2(avgPerDay)}/day
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: netCash >= 0 ? "var(--green)" : "var(--red)", marginLeft: "auto" }}>
              {netCash >= 0 ? "+" : "−"}EGP {money2(Math.abs(netCash))} kept after everything
            </span>
          </div>
          <div style={{ marginTop: 14 }}>{daily.isLoading ? null : <AreaChart data={heroData} id="hero" height={110} strong />}</div>
        </div>

        {/* ═══ PULSE — how healthy, at a glance ═══ */}
        <div className="tile perf">
          <HealthGauge score={marginPct} suffix="%" color={gaugeCol} label="Kept from every pound" />
          <div className="hstats" style={{ width: "100%" }}>
            <div className="hstat"><div className="l">Lifetime</div><div className="v tnum">{egpShortBare(d.lifetimeRev)}</div></div>
            <div className="hstat"><div className="l">Best month</div><div className="v tnum">{d.best.k ? `${MON[+d.best.k.slice(5, 7) - 1]} ${d.best.k.slice(2, 4)}` : "—"}</div></div>
            <div className="hstat"><div className="l">Cheques in</div><div className="v tnum">{egpShortBare(cycle.data?.totalReceived ?? 0)}</div></div>
          </div>
          <div style={{ fontSize: 12.5, color: "rgb(var(--dim))", fontWeight: 500, lineHeight: 1.5 }}>
            {topVen ? `${topVen[0]} is your biggest supplier, ${venPct}% of stock spend.` : d.best.k ? `${MON[+d.best.k.slice(5, 7) - 1]} ${d.best.k.slice(0, 4)} is the record: EGP ${money2(d.best.v)}.` : "Log a few days to unlock insights."}
          </div>
        </div>

        {/* ═══ TREND — the one interactive chart ═══ */}
        <div className="tile trend">
          <div className="th"><span className="tname">Revenue trend</span>
            <div className="seg big" style={{ marginLeft: "auto" }}>
              {(["1D", "1W", "1M", "3M", "6M", "All"] as const).map((r) => <span key={r} className={trendR === r ? "on" : ""} onClick={() => setTrendR(r)}>{r}</span>)}
              <span className={"cust" + (trendR === "Custom" ? " on" : "")} onClick={() => setTrendR("Custom")}>Custom</span>
            </div>
          </div>
          {trendR === "Custom" && (
            <div className="crange" style={{ marginTop: 12 }}>
              <span style={{ fontSize: 12, color: "rgb(var(--dim))", fontWeight: 600 }}>From</span>
              <input type="date" value={cFrom || d.earliest} min={d.earliest} max={d.latest} onChange={(e) => setCFrom(e.target.value)} />
              <span style={{ fontSize: 12, color: "rgb(var(--dim))", fontWeight: 600 }}>to</span>
              <input type="date" value={cTo || d.latest} min={d.earliest} max={d.latest} onChange={(e) => setCTo(e.target.value)} />
            </div>
          )}
          <div style={{ marginTop: 18 }}>{daily.isLoading ? <SkeletonRows rows={4} /> : <AreaChart data={trendData} id="trend" height={206} axis />}</div>
        </div>
      </div>

      {/* ═══ ONE TAP AWAY — spend, the week, cheques ═══ */}
      <div className="chiprow">
        <button type="button" className="chip" onClick={() => setSheet("spend")}>
          <span className="cl"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">{Ic.spend}</svg>Spend · {monthShort}</span>
          <span className="cv tnum">EGP {money2(monthSpend)}</span>
          <span className="cs">{spendRatio}% of revenue · tap for categories</span>
        </button>
        <button type="button" className="chip" onClick={() => setSheet("week")}>
          <span className="cl"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">{Ic.rev}</svg>This week</span>
          <span className="cv tnum">EGP {money2(weekTotal)}</span>
          <span className="cs">{weekDelta != null ? `${weekDelta >= 0 ? "+" : ""}${weekDelta.toFixed(1)}% on last week` : "tap for the days"}</span>
        </button>
        <button type="button" className="chip" onClick={() => setSheet("cheques")}>
          <span className="cl"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">{Ic.bank}</svg>Cheques</span>
          <span className="cv tnum">{cycle.data?.cheques.length ?? 0} · {egpShortBare(cycle.data?.totalReceived ?? 0)}</span>
          <span className="cs">tap for the latest</span>
        </button>
      </div>

      {/* ═══ THE SHEETS — evidence behind each chip ═══ */}
      <Sheet open={sheet === "spend"} onClose={() => setSheet(null)} title={`Spend · ${monthShort}`}>
        <div style={{ fontSize: 13, color: "rgb(var(--dim))", fontWeight: 500, marginBottom: 14 }}>
          EGP {money2(monthSpend)} this month · {stockShare}% of it on stock
        </div>
        {cats.length === 0 ? <Note>No expenses recorded.</Note> :
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
        <Link to="/expenses" style={{ display: "block", marginTop: 16, fontSize: 13, fontWeight: 700, color: "var(--mag)" }}>Open expenses →</Link>
      </Sheet>

      <Sheet open={sheet === "week"} onClose={() => setSheet(null)} title="This week, day by day">
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
          <span className="disp" style={{ fontWeight: 700, fontSize: 26 }}>EGP {money2(weekTotal)}</span>
          {weekDelta != null && <span className={`delta ${weekDelta >= 0 ? "up" : "down"}`}>{weekDelta >= 0 ? "+" : ""}{weekDelta.toFixed(1)}%</span>}
        </div>
        <div style={{ fontSize: 12.5, color: "rgb(var(--dim))", fontWeight: 500, marginBottom: 14 }}>
          {fmtDate(weekDays[0], "d MMM")}–{fmtDate(d.latest, "d MMM yyyy")} · was EGP {money2(priorTotal)} the week before
        </div>
        <BarChart data={weekBars} height={170} />
      </Sheet>

      <Sheet open={sheet === "cheques"} onClose={() => setSheet(null)} title="Recent cheques">
        {cheques.length === 0 ? <Note>No cheques logged yet.</Note> :
          cheques.map((c) => (
            <div className="lrow" key={c.id}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="lname">Cheque deposited</div>
                <div className="lsub">{fmtDate(c.date, "d MMM yyyy")}</div>
              </div>
              <div className="lamt tnum" style={{ color: "rgb(var(--cyan))" }}>{money2(c.amount)}</div>
            </div>
          ))}
        <Link to="/cheques" style={{ display: "block", marginTop: 16, fontSize: 13, fontWeight: 700, color: "var(--mag)" }}>Open cheques →</Link>
      </Sheet>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="py-1 text-sm" style={{ color: "rgb(var(--dim))" }}>{children}</div>;
}

