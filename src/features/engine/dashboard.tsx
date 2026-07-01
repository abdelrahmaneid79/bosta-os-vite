import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, Eyebrow, Pill, Badge, Button } from "@/components/ui";
import { MBars, DeckTile, TileHead } from "./deck";
import { EmptyState, SkeletonRows, ErrorState } from "@/components/feedback";
import { egp, egpShort } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { getCommandCenter } from "@/core/read/dashboard";
import { getMissingData } from "@/core/read/missing";
import { getRiskInsights } from "@/core/read/insights";
import { getActivityFeed, type ActivityEvent } from "@/core/read/activity";
import { getHealthReport, type HealthCategory } from "@/core/read/health";
import { getDailyRevenue } from "@/core/read/sales";
import { getExpenses } from "@/core/read/expenses";
import { getProfitReadout } from "@/core/read/profit";
import { getCashSummary } from "@/core/read/money";
import { getProductProfit } from "@/core/read/products";
import { todayCairo, monthBoundsCairo } from "@/core/time";
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
  const accStart = useBooksStartDate();
  const [trendR, setTrendR] = useState<"3M" | "6M" | "12M" | "All">("12M");

  const cc = useQuery({ queryKey: ["cc"], queryFn: getCommandCenter, enabled: en });
  const daily = useQuery({ queryKey: ["dailyHist", histFrom], queryFn: () => getDailyRevenue({ from: histFrom, to: today }), enabled: en });
  const health = useQuery({ queryKey: ["health"], queryFn: getHealthReport, enabled: en });

  const d = useMemo(() => {
    const rows = daily.data ?? [];
    const bucket = new Map<string, number>();
    for (const r of rows) bucket.set(r.date.slice(0, 7), (bucket.get(r.date.slice(0, 7)) ?? 0) + r.total);
    const keys = [...bucket.keys()].sort();
    const monthly = keys.map((k) => ({ k, v: bucket.get(k)! }));
    const active = monthly.filter((m) => m.v > 0);
    const cur = active[active.length - 1] ?? { k: month.from.slice(0, 7), v: 0 };
    const prev = active[active.length - 2] ?? { k: "", v: 0 };
    return { monthKey: cur.k, monthRev: cur.v, lastRev: prev.v, monthly, latest: rows.filter((r) => r.total > 0).map((r) => r.date).sort().pop() ?? null };
  }, [daily.data, month.from]);

  const monthRange = useMemo(() => {
    const k = d.monthKey, y = +k.slice(0, 4), m = +k.slice(5, 7);
    const last = new Date(y, m, 0).getDate();
    return { from: `${k}-01`, to: `${k}-${String(last).padStart(2, "0")}` };
  }, [d.monthKey]);

  const profitM = useQuery({ queryKey: ["profit", monthRange, accStart], queryFn: () => getProfitReadout(monthRange, accStart), enabled: en });
  const cash = useQuery({ queryKey: ["cash", monthRange], queryFn: () => getCashSummary(monthRange), enabled: en });
  const topM = useQuery({ queryKey: ["month-products", d.monthKey], queryFn: () => getProductProfit(monthRange), enabled: en });

  if (cc.isError) return <ErrorState message={String((cc.error as Error)?.message)} />;
  if (!en) return <EmptyState title="Sign in to load your deck" hint="Wired to your live data only — never faked." />;

  const isCurMonth = d.monthKey === month.from.slice(0, 7);
  const monthLabel = `${MON[+d.monthKey.slice(5, 7) - 1]} ${d.monthKey.slice(0, 4)}`;
  const revDelta = pctDelta(d.monthRev, d.lastRev);
  const diff = d.monthRev - d.lastRev;
  const daysInMonth = new Date(+d.monthKey.slice(0, 4), +d.monthKey.slice(5, 7), 0).getDate();
  const dayNum = isCurMonth ? new Date(today + "T00:00:00").getDate() : daysInMonth;
  const pacing = isCurMonth && dayNum > 0 && d.monthRev > 0 ? (d.monthRev / dayNum) * daysInMonth : null;
  const heroSeries = (() => { const days = isoRangeDays(monthRange.from, monthRange.to); const byDay = new Map((daily.data ?? []).map((r) => [r.date, r.total])); return days.map((x) => byDay.get(x) ?? 0); })();

  const p = profitM.data;
  const cs = cash.data;
  const topProd = [...(topM.data ?? [])].sort((a, b) => b.revenue - a.revenue).slice(0, 4);
  const topMax = Math.max(1, ...topProd.map((x) => x.revenue));

  const hs = health.data;
  const hscore = hs?.overall ?? 0;
  const hcol = hscore >= 75 ? "var(--green)" : hscore >= 55 ? "var(--amber)" : "var(--red)";
  const standing = hscore >= 75 ? "GOOD STANDING" : hscore >= 55 ? "STEADY" : "NEEDS ATTENTION";
  const trendSlice = trendR === "All" ? d.monthly : d.monthly.slice(-({ "3M": 3, "6M": 6, "12M": 12 }[trendR]));

  const tk = (bg: string, color: string, icon: React.ReactNode, label: string, value: React.ReactNode) => (
    <div className="tk">
      <div className="tkic" style={{ background: bg, color }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">{icon}</svg></div>
      <div><div className="tkl">{label}</div><div className="tkv tnum">{value}</div></div>
    </div>
  );

  return (
    <div className="cdk space-y-5">
      {/* ── ticker ─────────────────────────────────────────────────────── */}
      <div className="ticker">
        {tk("rgba(255,61,168,.14)", "var(--mag)", Ic.rev, "Revenue today", <>{money2(cc.data?.todayRevenue ?? 0)}</>)}
        {tk("rgba(39,229,204,.14)", "var(--cyan)", Ic.cash, "Cash on hand", <>{cc.data?.cashBalance != null ? money2(cc.data.cashBalance) : "—"}</>)}
        {tk("rgba(255,177,62,.14)", "var(--amber)", Ic.bank, "Cheques due", <>{money2(cc.data?.owed ?? 0)}</>)}
        {tk("rgba(157,107,255,.14)", "var(--violet)", Ic.star, "Top mover", <span className="ar" style={{ fontSize: 15 }}>{topProd[0]?.name ?? "—"}</span>)}
        <div className="tk">
          <span className="live"><span className="livedot" /> LIVE</span>
          <div><div className="tkl">Books from</div><div className="tkv" style={{ fontSize: 14 }}>{fmtDate(accStart, "d MMM yyyy")}</div></div>
        </div>
      </div>

      {/* ── grid ───────────────────────────────────────────────────────── */}
      <div className="deckgrid">
        {/* hero — total revenue */}
        <div className="tile hero">
          <div className="orb" />
          <div className="heronut"><img src="/assets/bosta-mascot.svg" alt="" /></div>
          <div className="th"><span className="eyebrow">Total revenue · {isCurMonth ? `${monthLabel} · month to date` : monthLabel}</span></div>
          <div className="hv tnum"><span className="hcur">EGP</span>{money2(d.monthRev)}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            {revDelta != null && (
              <span className={`delta ${diff >= 0 ? "up" : "down"}`}>
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">{diff >= 0 ? <path d="M3 8l3-3 3 3" /> : <path d="M3 4l3 3 3-3" />}</svg>
                {Math.abs(revDelta).toFixed(1)}%
              </span>
            )}
            <span style={{ fontSize: 12.5, color: "var(--dim)", fontWeight: 500 }}>
              {d.lastRev > 0 ? `${diff >= 0 ? "+" : "−"}EGP ${money2(Math.abs(diff))} vs prior month` : d.latest ? `latest ${fmtDate(d.latest, "d MMM")}` : "no sales yet"}
              {pacing ? ` · pacing to ${egpShort(pacing).replace("EGP ", "")}` : ""}
            </span>
          </div>
          <div className="chartbox" style={{ height: 120, marginTop: "auto" }}>
            {daily.isLoading ? null : <AreaChart series={heroSeries.length ? heroSeries : [0, 0]} id="hero" height={120} strong />}
          </div>
        </div>

        {/* net profit */}
        <div className="tile spend">
          <div className="th"><span className="ti" style={{ background: "rgba(66,226,154,.13)", color: "var(--green)" }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{Ic.profit}</svg></span><span className="tname">Net profit</span></div>
          <div className="bn tnum" style={{ color: "var(--green)" }}><small>EGP</small>{p ? (p.netProfit == null ? "—" : money2(p.netProfit)) : "—"}</div>
          <div className="bar" style={{ marginTop: 14 }}><i style={{ width: `${p && p.netMargin != null ? Math.max(3, Math.min(100, p.netMargin)) : 0}%`, background: "linear-gradient(90deg,var(--green),var(--cyan))" }} /></div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8, fontWeight: 600 }}>{p && p.netMargin != null ? `${Math.round(p.netMargin)}% margin` : "margin needs costs"}</div>
          <div style={{ fontSize: 12, color: "var(--dim)", marginTop: 8 }}>Rev {p ? egpShort(p.revenue).replace("EGP ", "") : "—"} · COGS {p ? egpShort(p.cogs).replace("EGP ", "") : "—"} · Opex {p ? egpShort(p.operatingExpenses).replace("EGP ", "") : "—"}</div>
        </div>

        {/* cash on hand */}
        <div className="tile netcash">
          <div className="th"><span className="ti" style={{ background: "rgba(39,229,204,.13)", color: "var(--cyan)" }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{Ic.cash}</svg></span><span className="tname">Cash on hand</span></div>
          <div className="bn tnum"><small>EGP</small>{cc.data?.cashBalance != null ? money2(cc.data.cashBalance) : "—"}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <div className="chip"><b style={{ color: "var(--green)" }}>+{egpShort(cs?.inflow ?? 0).replace("EGP ", "")}</b><span>Inflow</span></div>
            <div className="chip"><b style={{ color: "var(--red)" }}>−{egpShort(Math.abs(cs?.outflow ?? 0)).replace("EGP ", "")}</b><span>Outflow</span></div>
          </div>
        </div>

        {/* business health */}
        <div className="tile perf">
          <HealthGauge score={hscore} suffix="" color={hcol} label={hs?.status ?? "—"} />
          <div className="hbody">
            <span className="eyebrow" style={{ color: hcol }}>Business health · {standing}</span>
            <div className="hhead">{hs?.status ? `${hs.status} — margin & cash tracked live from your records.` : "Computing health…"}</div>
            <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
              <div className="chip"><b style={{ color: revDelta != null && revDelta >= 0 ? "var(--green)" : "var(--red)" }}>{revDelta != null ? `${revDelta >= 0 ? "+" : ""}${Math.round(revDelta)}%` : "—"}</b><span>Revenue pace</span></div>
              <div className="chip"><b>{p && p.netMargin != null ? `${Math.round(p.netMargin)}%` : "—"}</b><span>Net margin</span></div>
              <div className="chip"><b style={{ color: (cc.data?.warnings.missingCogs ?? 0) > 0 ? "var(--amber)" : "var(--green)" }}>{cc.data?.warnings.missingCogs ?? 0}</b><span>Missing costs</span></div>
              <div className="chip"><b style={{ color: (cc.data?.warnings.unreconciledSales ?? 0) > 0 ? "var(--amber)" : "var(--green)" }}>{cc.data?.warnings.unreconciledSales ?? 0}</b><span>Unreconciled</span></div>
            </div>
          </div>
        </div>

        {/* revenue trend */}
        <div className="tile trend">
          <div className="th"><span className="tname">Revenue trend</span>
            <div className="seg" id="trendSeg">
              {(["3M", "6M", "12M", "All"] as const).map((r) => <span key={r} className={trendR === r ? "on" : ""} onClick={() => setTrendR(r)}>{r}</span>)}
            </div>
          </div>
          <div className="chartbox" style={{ height: 206, marginTop: 18 }}>
            {daily.isLoading ? <SkeletonRows rows={4} /> : <AreaChart series={trendSlice.length ? trendSlice.map((m) => m.v) : [0, 0]} id="trend" height={206} />}
          </div>
        </div>

        {/* top products */}
        <div className="tile catalog">
          <div className="th"><span className="tname">Top products</span><span className="eyebrow" style={{ marginLeft: "auto" }}>{monthLabel}</span></div>
          {topM.isLoading ? <SkeletonRows rows={4} /> : topProd.length === 0 ? <Note>No product sales this month.</Note> :
            topProd.map((p2) => (
              <div className="lrow" key={p2.productId}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="lname ar" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p2.name}</div>
                  <div className="bar"><i style={{ width: `${(p2.revenue / topMax) * 100}%`, background: "linear-gradient(90deg,var(--mag),var(--violet))" }} /></div>
                </div>
                <div className="lamt tnum">{egpShort(p2.revenue).replace("EGP ", "")}</div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

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
