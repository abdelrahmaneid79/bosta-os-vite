/** Self-coded chart kit — no chart library. Crisp (measured to real pixel width,
 *  never stretched), animated (bars grow / line draws / arcs sweep in, and tween
 *  live when the filter/range changes the data), and interactive (hover tooltips
 *  + slice highlight). Theme-aware via CSS variables. Bar / Line / Donut /
 *  horizontal-Bar. Keep this the standard for every chart in the app. */
import { useId, useState, useRef, useEffect, useLayoutEffect } from "react";

const PINK = "rgb(var(--pink))";
const TEAL = "rgb(var(--good))";
const GRID = "rgb(var(--line2))";
const AXIS = "rgb(var(--muted))";
const SURFACE = "rgb(var(--panel))";
const SLICE = ["rgb(var(--pink))", "rgb(var(--good))", "rgb(var(--info))", "rgb(var(--warn))", "rgb(var(--violet))", "#FF6B8A", "#34D9C8", "#FFD166"];
const EASE = "cubic-bezier(.22,1,.36,1)";

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}
/** Compact axis label: 1.2M / 540K / 25 / 2.5 — no duplicate ticks at small scale. */
function short(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (a >= 1_000) return `${trim(n / 1_000)}K`;
  if (a >= 10 || a === 0) return `${Math.round(n)}`;
  return trim(n);
}
const trim = (n: number) => { const r = Math.round(n * 10) / 10; return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)); };
const full = (unit: string, n: number) => `${unit ? unit + " " : ""}${Math.round(n).toLocaleString("en-US")}`;

/** Responsive width via ResizeObserver — lets the SVG use real pixels (crisp). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver((e) => setW(Math.round(e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
/** Flip true on the frame after mount so CSS transitions play the enter animation. */
function useEnter() {
  const [on, setOn] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(r); }, []);
  return on;
}

export interface Point { label: string; value: number }

function Tooltip({ x, w, label, value }: { x: number; w: number; label: string; value: string }) {
  return (
    <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-panel px-2.5 py-1.5 shadow-pop"
      style={{ left: Math.min(Math.max(x, 56), w - 56) }}>
      <div className="text-[10px] font-medium text-dim">{label}</div>
      <div className="tnum font-display text-[13px] font-extrabold text-text">{value}</div>
    </div>
  );
}

/* ── Vertical bar chart ──────────────────────────────────────────────────── */
export function BarChart({ data, height = 240, color = PINK, unit = "EGP", maxLabels = 9 }: {
  data: Point[]; height?: number; color?: string; unit?: string; maxLabels?: number;
}) {
  const id = useId();
  const [ref, W] = useWidth<HTMLDivElement>();
  const shown = useEnter();
  const [hover, setHover] = useState<number | null>(null);
  const H = height, PL = 52, PR = 12, PT = 12, PB = 28;
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const plotW = Math.max(0, W - PL - PR), plotH = H - PT - PB;
  const n = Math.max(1, data.length);
  const bw = plotW / n;
  const ticks = 4;
  const labelEvery = Math.ceil(n / maxLabels);
  const cx = (i: number) => PL + i * bw + bw / 2;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }} onMouseLeave={() => setHover(null)}>
      {W > 0 && (
        <svg width={W} height={H} className="block">
          <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={1} /><stop offset="100%" stopColor={color} stopOpacity={0.5} /></linearGradient></defs>
          {Array.from({ length: ticks + 1 }).map((_, i) => {
            const y = PT + (plotH * i) / ticks;
            return (
              <g key={i}>
                <line x1={PL} y1={y} x2={W - PR} y2={y} stroke={GRID} strokeWidth={1} />
                <text x={PL - 8} y={y + 3.5} textAnchor="end" fontSize={11} fontWeight={600} fill={AXIS}>{short(max * (1 - i / ticks))}</text>
              </g>
            );
          })}
          {data.map((d, i) => {
            const h = Math.max(0, (d.value / max) * plotH);
            const w = bw * 0.62;
            const active = hover == null || hover === i;
            return (
              <rect key={i} x={PL + i * bw + bw * 0.19} y={PT + plotH - (shown ? h : 0)} width={w} height={shown ? h : 0}
                rx={Math.min(6, w / 2)} fill={`url(#${id})`} opacity={active ? 1 : 0.45}
                style={{ transition: `y .55s ${EASE} ${i * 18}ms, height .55s ${EASE} ${i * 18}ms, opacity .15s linear` }} />
            );
          })}
          {data.map((_, i) => <rect key={`hit${i}`} x={PL + i * bw} y={PT} width={bw} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />)}
          {data.map((d, i) => i % labelEvery === 0 ? (
            <text key={`lb${i}`} x={cx(i)} y={H - 8} textAnchor="middle" fontSize={11} fontWeight={600} fill={hover === i ? color : AXIS}>{d.label}</text>
          ) : null)}
        </svg>
      )}
      {hover != null && data[hover] && <Tooltip x={cx(hover)} w={W} label={data[hover].label} value={full(unit, data[hover].value)} />}
    </div>
  );
}

/* ── Line / area chart ───────────────────────────────────────────────────── */
export function LineChart({ data, height = 240, color = TEAL, unit = "EGP", area = true, maxLabels = 9 }: {
  data: Point[]; height?: number; color?: string; unit?: string; area?: boolean; maxLabels?: number;
}) {
  const id = useId();
  const [ref, W] = useWidth<HTMLDivElement>();
  const shown = useEnter();
  const [hover, setHover] = useState<number | null>(null);
  const H = height, PL = 52, PR = 12, PT = 12, PB = 28;
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const plotW = Math.max(0, W - PL - PR), plotH = H - PT - PB;
  const n = Math.max(1, data.length);
  const x = (i: number) => PL + (plotW * i) / Math.max(1, n - 1);
  const y = (v: number) => PT + plotH - (v / max) * plotH;
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`).join(" ");
  const fill = `${line} L${x(n - 1).toFixed(1)} ${PT + plotH} L${x(0).toFixed(1)} ${PT + plotH} Z`;
  const ticks = 4;
  const labelEvery = Math.ceil(n / maxLabels);

  function onMove(e: React.MouseEvent) {
    const r = ref.current?.getBoundingClientRect(); if (!r || plotW <= 0) return;
    const i = Math.round(((e.clientX - r.left - PL) / plotW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }
  const hp = hover != null ? data[hover] : null;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      {W > 0 && (
        <svg width={W} height={H} className="block">
          <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.3} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
          {Array.from({ length: ticks + 1 }).map((_, i) => {
            const yy = PT + (plotH * i) / ticks;
            return (<g key={i}>
              <line x1={PL} y1={yy} x2={W - PR} y2={yy} stroke={GRID} strokeWidth={1} />
              <text x={PL - 8} y={yy + 3.5} textAnchor="end" fontSize={11} fontWeight={600} fill={AXIS}>{short(max * (1 - i / ticks))}</text>
            </g>);
          })}
          {area && <path d={fill} fill={`url(#${id})`} opacity={shown ? 1 : 0} style={{ transition: "opacity .6s ease .3s" }} />}
          <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round"
            pathLength={1} strokeDasharray={1} strokeDashoffset={shown ? 0 : 1} style={{ transition: `stroke-dashoffset .9s ${EASE}` }} />
          {hp && (<g>
            <line x1={x(hover!)} y1={PT} x2={x(hover!)} y2={PT + plotH} stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
            <circle cx={x(hover!)} cy={y(hp.value)} r={4.5} fill={color} stroke={SURFACE} strokeWidth={2} />
          </g>)}
          {data.map((d, i) => i % labelEvery === 0 ? (
            <text key={`lb${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fontWeight={600} fill={AXIS}>{d.label}</text>
          ) : null)}
        </svg>
      )}
      {hp && <Tooltip x={x(hover!)} w={W} label={hp.label} value={full(unit, hp.value)} />}
    </div>
  );
}

/* ── Donut chart with legend ─────────────────────────────────────────────── */
export function DonutChart({ data, size = 230, unit = "EGP" }: {
  data: { label: string; value: number; color?: string }[]; size?: number; unit?: string;
}) {
  const shown = useEnter();
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2, ir = r * 0.62, cx = r, cy = r;
  let acc = 0;
  const arcs = data.map((d, i) => {
    const f0 = acc / total; acc += d.value; const f1 = acc / total;
    const mid = ((f0 + f1) / 2) * 2 * Math.PI - Math.PI / 2;
    const a0 = f0 * 2 * Math.PI - Math.PI / 2, a1 = f1 * 2 * Math.PI - Math.PI / 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang: number, rad: number) => `${cx + rad * Math.cos(ang)} ${cy + rad * Math.sin(ang)}`;
    const dpath = `M${p(a0, r)} A${r} ${r} 0 ${large} 1 ${p(a1, r)} L${p(a1, ir)} A${ir} ${ir} 0 ${large} 0 ${p(a0, ir)} Z`;
    return { d: dpath, color: d.color ?? SLICE[i % SLICE.length], label: d.label, value: d.value, mid };
  });
  const focus = hover != null ? arcs[hover] : null;

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative flex-shrink-0" style={{ width: size, height: size }} onMouseLeave={() => setHover(null)}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
          style={{ transform: shown ? "rotate(0deg)" : "rotate(-12deg)", opacity: shown ? 1 : 0, transition: `transform .7s ${EASE}, opacity .5s ease` }}>
          {arcs.map((a, i) => {
            const push = hover === i ? 6 : 0;
            return <path key={i} d={a.d} fill={a.color} stroke={SURFACE} strokeWidth={2.5}
              transform={`translate(${Math.cos(a.mid) * push} ${Math.sin(a.mid) * push})`}
              opacity={hover == null || hover === i ? 1 : 0.4}
              style={{ transition: `transform .2s ${EASE}, opacity .15s linear`, cursor: "default" }}
              onMouseEnter={() => setHover(i)} />;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-dim">{focus ? focus.label : "Total"}</div>
          <div className="tnum font-display text-base font-extrabold text-text">{full(unit, focus ? focus.value : total)}</div>
          {focus && <div className="text-[11px] font-semibold text-dim">{Math.round((focus.value / total) * 100)}%</div>}
        </div>
      </div>
      <div className="min-w-[140px] flex-1 space-y-1.5">
        {arcs.map((a, i) => (
          <button key={i} type="button" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-[12.5px] transition ${hover === i ? "bg-panel2" : ""}`}>
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-md" style={{ background: a.color }} />
            <span className="truncate text-muted">{a.label}</span>
            <span className="ml-auto tnum font-semibold text-text">{Math.round((a.value / total) * 100)}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Horizontal bars (leaderboards) — animated width + hover ─────────────── */
export function HBars({ data, color = PINK, format }: {
  data: { label: string; value: number }[]; color?: string; format?: (n: number) => string;
}) {
  const shown = useEnter();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const fmt = format ?? ((n: number) => short(n));
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <span dir="auto" className="w-28 flex-shrink-0 truncate text-right text-[12.5px] font-medium text-muted">{d.label}</span>
          <div className="h-6 flex-1 overflow-hidden rounded-lg bg-panel2">
            <div className="h-full rounded-lg" style={{ width: shown ? `${Math.max(2, (d.value / max) * 100)}%` : "0%", background: color, opacity: hover == null || hover === i ? 1 : 0.5, transition: `width .6s ${EASE} ${i * 30}ms, opacity .15s linear` }} />
          </div>
          <span className="w-16 flex-shrink-0 text-right tnum text-[12px] font-semibold text-dim">{fmt(d.value)}</span>
        </div>
      ))}
    </div>
  );
}
