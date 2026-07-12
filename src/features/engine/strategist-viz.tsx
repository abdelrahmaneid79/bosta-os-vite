/** Pure SVG viz for the Strategist health dashboard — no chart lib. All colours
 *  come from BostaOS CSS vars so they theme. Every component guards empty data. */

export const VIZ_PALETTE = ["var(--mag)", "rgb(var(--violet))", "rgb(var(--cyan))", "var(--green)", "var(--amber)", "var(--teal)"];

/** Semicircle gauge (0–100) with a coloured arc — used for the health KPI. */
export function Gauge({ value, color, size = 96 }: { value: number | null; color: string; size?: number }) {
  const w = size, h = size * 0.6, cx = w / 2, cy = w / 2, r = w / 2 - 8;
  const frac = value == null ? 0 : Math.max(0, Math.min(1, value / 100));
  const a0 = Math.PI, a1 = Math.PI * (1 - frac); // 180° → left, sweep clockwise to the value
  const pt = (a: number) => `${cx + r * Math.cos(a)},${cy - r * Math.sin(a)}`;
  const arc = (aa: number, ab: number) => `M ${pt(aa)} A ${r} ${r} 0 0 1 ${pt(ab)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h + 6}`} width={w} height={h + 6}>
      <path d={arc(Math.PI, 0)} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={9} strokeLinecap="round" />
      {value != null && <path d={arc(a0, a1)} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" style={{ filter: `drop-shadow(0 0 5px ${color})` }} />}
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize={w * 0.28} fontWeight={800} fill={color}>{value == null ? "—" : value}</text>
    </svg>
  );
}

/** Radar / hexagon for the business-health categories (2–6 axes). Overall in the
 *  centre. Scores are 0–100; null scores render at the origin (a visible dip). */
export function HealthRadar({ categories, overall, status, size = 220 }: {
  categories: { label: string; score: number | null }[];
  overall: number | null; status: string; size?: number;
}) {
  const cats = categories.slice(0, 6);
  const n = Math.max(3, cats.length);
  const cx = size / 2, cy = size / 2, R = size / 2 - 34;
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, rad: number) => `${cx + rad * Math.cos(ang(i))},${cy + rad * Math.sin(ang(i))}`;
  const grid = [0.25, 0.5, 0.75, 1].map((f) => cats.map((_, i) => pt(i, R * f)).join(" "));
  const dataPts = cats.map((c, i) => pt(i, R * ((c.score ?? 0) / 100))).join(" ");
  const col = overall == null ? "rgb(var(--faint))" : overall >= 75 ? "var(--green)" : overall >= 55 ? "var(--amber)" : "var(--red)";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        {grid.map((g, i) => <polygon key={i} points={g} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth={1} />)}
        {cats.map((_, i) => <line key={i} x1={cx} y1={cy} x2={pt(i, R).split(",")[0]} y2={pt(i, R).split(",")[1]} stroke="rgba(255,255,255,.07)" strokeWidth={1} />)}
        <polygon points={dataPts} fill={`color-mix(in srgb, ${col} 22%, transparent)`} stroke={col} strokeWidth={2} style={{ filter: `drop-shadow(0 0 5px ${col})` }} />
        {cats.map((c, i) => { const [x, y] = pt(i, R * ((c.score ?? 0) / 100)).split(","); return <circle key={i} cx={x} cy={y} r={3} fill={col} />; })}
        {cats.map((c, i) => {
          const [x, y] = pt(i, R + 16).split(",").map(Number);
          return <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={9.5} fontWeight={700} fill="rgb(var(--muted))">{c.label}</text>;
        })}
        <circle cx={cx} cy={cy} r={26} fill="rgb(var(--panel2))" stroke={col} strokeWidth={1.5} />
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize={20} fontWeight={800} fill={col}>{overall ?? "—"}</text>
        <text x={cx} y={cy + 11} textAnchor="middle" fontSize={7} fontWeight={700} fill="rgb(var(--dim))">/ 100</text>
      </svg>
      <div style={{ fontSize: 12, fontWeight: 700, color: col, textTransform: "uppercase", letterSpacing: ".06em", marginTop: 2 }}>{status}</div>
    </div>
  );
}

/** Donut with a centre total. Segments auto-coloured from the palette. */
export function Donut({ segments, centerValue, centerLabel, size = 180 }: {
  segments: { label: string; value: number }[];
  centerValue: string; centerLabel: string; size?: number;
}) {
  const r = size / 2 - 14, C = 2 * Math.PI * r, cx = size / 2, cy = size / 2;
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  let off = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={16} />
      {segments.map((s, i) => {
        const len = (Math.max(0, s.value) / total) * C;
        const el = <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={VIZ_PALETTE[i % VIZ_PALETTE.length]} strokeWidth={16} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="butt" />;
        off += len; return el;
      })}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize={size * 0.13} fontWeight={800} fill="rgb(var(--text))">{centerValue}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize={size * 0.06} fontWeight={600} fill="rgb(var(--dim))">{centerLabel}</text>
    </svg>
  );
}

/** Smooth-ish filled area chart (monthly revenue trend). */
export function Area({ data, height = 150, color = "var(--mag)" }: { data: number[]; height?: number; color?: string }) {
  const w = 600, pad = 6;
  if (!data.length) return <div style={{ height, color: "rgb(var(--faint))", fontSize: 12 }}>No data</div>;
  const max = Math.max(1, ...data), min = Math.min(0, ...data);
  const x = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, data.length - 1);
  const y = (v: number) => height - pad - ((v - min) / (max - min || 1)) * (height - 2 * pad);
  const line = data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const gid = `ag${Math.round(max)}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.35} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
      <polygon points={`${pad},${height - pad} ${line} ${w - pad},${height - pad}`} fill={`url(#${gid})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Horizontal labelled bars (weekday pattern, top products). */
export function Bars({ data, color = "rgb(var(--violet))", fmt = String }: { data: { label: string; value: number }[]; color?: string; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: "grid", gap: 9 }}>
      {data.map((d) => (
        <div key={d.label} style={{ display: "grid", gridTemplateColumns: "84px 1fr auto", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "rgb(var(--muted))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} dir="auto">{d.label}</span>
          <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,.06)" }}><div style={{ width: `${(d.value / max) * 100}%`, height: "100%", borderRadius: 999, background: color }} /></div>
          <span style={{ fontSize: 11.5, color: "rgb(var(--dim))", fontVariantNumeric: "tabular-nums" }}>{fmt(d.value)}</span>
        </div>
      ))}
    </div>
  );
}
