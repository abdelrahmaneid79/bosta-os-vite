/** Pure-SVG chart kit — no chart library, full control, on-brand. Every chart is
 *  responsive (1000-wide viewBox scaled to 100% width) and renders real data
 *  passed in by the read-models. Bar / Line / Donut / horizontal-Bar. */
import { useId } from "react";

const PINK = "#F868C8";
const TEAL = "#2BD4C4";
const GRID = "#241019";
const AXIS = "#7c5e6e";

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}
const short = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1_000) return `${(n / 1_000).toFixed(a >= 10_000 ? 0 : 1)}K`;
  return `${Math.round(n)}`;
};

export interface Point { label: string; value: number }

/* ── Vertical bar chart ──────────────────────────────────────────────────── */
export function BarChart({ data, height = 240, color = PINK, unit = "EGP", maxLabels = 9 }: {
  data: Point[]; height?: number; color?: string; unit?: string; maxLabels?: number;
}) {
  const W = 1000, H = height, PL = 64, PR = 14, PT = 12, PB = 30;
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const n = Math.max(1, data.length);
  const bw = plotW / n;
  const ticks = 4;
  const labelEvery = Math.ceil(n / maxLabels);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const y = PT + (plotH * i) / ticks;
        const val = max * (1 - i / ticks);
        return (
          <g key={i}>
            <line x1={PL} y1={y} x2={W - PR} y2={y} stroke={GRID} strokeWidth={1} />
            <text x={PL - 8} y={y + 4} textAnchor="end" fontSize={20} fill={AXIS}>{unit} {short(val)}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const h = (d.value / max) * plotH;
        const x = PL + i * bw + bw * 0.18;
        return <rect key={i} x={x} y={PT + plotH - h} width={bw * 0.64} height={Math.max(0, h)} rx={3} fill={color} opacity={0.92} />;
      })}
      {data.map((d, i) => i % labelEvery === 0 ? (
        <text key={i} x={PL + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize={19} fill={AXIS}>{d.label}</text>
      ) : null)}
    </svg>
  );
}

/* ── Line / area chart ───────────────────────────────────────────────────── */
export function LineChart({ data, height = 240, color = TEAL, unit = "EGP", area = true, maxLabels = 9 }: {
  data: Point[]; height?: number; color?: string; unit?: string; area?: boolean; maxLabels?: number;
}) {
  const id = useId();
  const W = 1000, H = height, PL = 64, PR = 14, PT = 12, PB = 30;
  const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const n = Math.max(1, data.length);
  const x = (i: number) => PL + (plotW * i) / Math.max(1, n - 1);
  const y = (v: number) => PT + plotH - (v / max) * plotH;
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`).join(" ");
  const fill = `${line} L${x(n - 1).toFixed(1)} ${PT + plotH} L${x(0).toFixed(1)} ${PT + plotH} Z`;
  const ticks = 4;
  const labelEvery = Math.ceil(n / maxLabels);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.35} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const yy = PT + (plotH * i) / ticks;
        return (<g key={i}>
          <line x1={PL} y1={yy} x2={W - PR} y2={yy} stroke={GRID} strokeWidth={1} />
          <text x={PL - 8} y={yy + 4} textAnchor="end" fontSize={20} fill={AXIS}>{unit} {short(max * (1 - i / ticks))}</text>
        </g>);
      })}
      {area && <path d={fill} fill={`url(#${id})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => i % labelEvery === 0 ? (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={19} fill={AXIS}>{d.label}</text>
      ) : null)}
    </svg>
  );
}

/* ── Donut chart with legend ─────────────────────────────────────────────── */
const SLICE = ["#2BD4C4", "#F868C8", "#F7A23B", "#5C8DFF", "#9B6CFF", "#FFD166", "#FF6B8A", "#54D69A"];
export function DonutChart({ data, size = 230 }: { data: { label: string; value: number; color?: string }[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2, ir = r * 0.62, cx = r, cy = r;
  let acc = 0;
  const arcs = data.map((d, i) => {
    const a0 = (acc / total) * 2 * Math.PI - Math.PI / 2;
    acc += d.value;
    const a1 = (acc / total) * 2 * Math.PI - Math.PI / 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang: number, rad: number) => `${cx + rad * Math.cos(ang)} ${cy + rad * Math.sin(ang)}`;
    const dpath = `M${p(a0, r)} A${r} ${r} 0 ${large} 1 ${p(a1, r)} L${p(a1, ir)} A${ir} ${ir} 0 ${large} 0 ${p(a0, ir)} Z`;
    return { d: dpath, color: d.color ?? SLICE[i % SLICE.length], label: d.label, value: d.value };
  });
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
        {arcs.map((a, i) => <path key={i} d={a.d} fill={a.color} stroke="#160910" strokeWidth={2} />)}
      </svg>
      <div className="space-y-1.5">
        {arcs.map((a, i) => (
          <div key={i} className="flex items-center gap-2 text-[12px]">
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: a.color }} />
            <span className="text-muted">{a.label}</span>
            <span className="ml-auto font-mono text-dim">{Math.round((a.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Horizontal bars (leaderboards) ──────────────────────────────────────── */
export function HBars({ data, color = PINK, format }: {
  data: { label: string; value: number }[]; color?: string; format?: (n: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const fmt = format ?? ((n: number) => short(n));
  return (
    <div className="space-y-1.5">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-2">
          <span dir="auto" className="w-28 flex-shrink-0 truncate text-right text-[12px] text-muted">{d.label}</span>
          <div className="h-5 flex-1 overflow-hidden rounded bg-line2">
            <div className="h-full rounded" style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, background: color }} />
          </div>
          <span className="w-16 flex-shrink-0 text-right font-mono text-[11px] text-dim">{fmt(d.value)}</span>
        </div>
      ))}
    </div>
  );
}
