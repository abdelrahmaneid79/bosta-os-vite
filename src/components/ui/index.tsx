import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { cn } from "@/core/utils/cn";

/* ─ Accent system ──────────────────────────────────────────────────────────
   One source of truth for the per-metric colours used across the app. Each
   accent maps to a token class set so tinted chips/cards stay theme-aware. */
export type Accent = "pink" | "mint" | "blue" | "amber" | "violet" | "red";
export const ACCENTS: Record<Accent, { text: string; bg: string; soft: string; ring: string; rgb: string }> = {
  pink:   { text: "text-pink",   bg: "bg-pink",   soft: "bg-pink/10",   ring: "rgb(var(--pink))",   rgb: "var(--pink)" },
  mint:   { text: "text-good",   bg: "bg-good",   soft: "bg-good/10",   ring: "rgb(var(--good))",   rgb: "var(--good)" },
  blue:   { text: "text-info",   bg: "bg-info",   soft: "bg-info/10",   ring: "rgb(var(--info))",   rgb: "var(--info)" },
  amber:  { text: "text-warn",   bg: "bg-warn",   soft: "bg-warn/10",   ring: "rgb(var(--warn))",   rgb: "var(--warn)" },
  violet: { text: "text-violet", bg: "bg-violet", soft: "bg-violet/10", ring: "rgb(var(--violet))", rgb: "var(--violet)" },
  red:    { text: "text-bad",    bg: "bg-bad",    soft: "bg-bad/10",    ring: "rgb(var(--bad))",    rgb: "var(--bad)" },
};

/* ─ Surfaces ───────────────────────────────────────────────────────────── */
export function Card({
  className, children, glow, accent, as,
}: { className?: string; children: ReactNode; glow?: boolean; accent?: string; as?: "div" | "section" }) {
  const Tag = as ?? "div";
  return (
    <Tag className={cn("lift relative overflow-hidden rounded-[26px] border border-white/[0.09] bg-gradient-to-b from-white/[0.045] to-white/[0.02] p-5 shadow-card backdrop-blur-xl hover:border-white/[0.18] sm:p-6", className)}>
      {glow && (
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl"
          style={{ background: accent ? `${accent}22` : "rgb(var(--pink) / 0.18)" }}
        />
      )}
      {children}
    </Tag>
  );
}

/** Card header: icon chip + title/subtitle + optional right-aligned action. */
export function CardHead({
  title, sub, accent = "pink", icon, action,
}: { title: ReactNode; sub?: ReactNode; accent?: Accent; icon?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      {icon && <IconChip d={icon} accent={accent} />}
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-[15px] font-bold leading-tight text-text">{title}</h3>
        {sub && <p className="mt-0.5 text-[12.5px] text-dim">{sub}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

export function Eyebrow({ children, className, accent }: { children: ReactNode; className?: string; accent?: string }) {
  return <div className={cn("text-[11px] font-semibold uppercase tracking-[0.14em]", accent ?? "text-dim", className)}>{children}</div>;
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <h2 className="font-display text-lg font-bold text-text">{children}</h2>
      {sub && <p className="text-xs text-dim">{sub}</p>}
    </div>
  );
}

/* ─ Icon chip (tinted rounded-square with an icon) ─────────────────────────── */
export function IconChip({ d, accent = "pink", size = "md" }: { d: string; accent?: Accent; size?: "sm" | "md" | "lg" }) {
  const a = ACCENTS[accent];
  const dim = size === "lg" ? "h-12 w-12" : size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const ic = size === "lg" ? "h-6 w-6" : size === "sm" ? "h-4 w-4" : "h-5 w-5";
  return (
    <span className={cn("flex flex-shrink-0 items-center justify-center rounded-2xl", a.soft, dim)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cn(ic, a.text)}>
        <path d={d} />
      </svg>
    </span>
  );
}

/* ─ Stat tile (compact) ────────────────────────────────────────────────── */
export function Stat({
  label, value, sub, accent = "text-text", onClick,
}: { label: string; value: ReactNode; sub?: ReactNode; accent?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick}
      className={cn("rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-4 backdrop-blur-xl", onClick && "lift cursor-pointer hover:border-white/[0.16]")}>
      <div className="mb-1.5 text-[12px] font-medium text-muted">{label}</div>
      <div className={cn("tnum font-display text-2xl font-bold leading-none", accent)}>{value}</div>
      {sub && <div className="mt-1.5 text-[12px] text-dim">{sub}</div>}
    </div>
  );
}

/** Big KPI card — icon chip, hero number, delta chip, optional sub/children. */
export function StatCard({
  label, value, accent = "pink", icon, delta, sub, children, onClick,
}: {
  label: string; value: ReactNode; accent?: Accent; icon?: string;
  delta?: number | null; sub?: ReactNode; children?: ReactNode; onClick?: () => void;
}) {
  return (
    <div onClick={onClick}
      className={cn("group lift rounded-[22px] border border-white/[0.08] bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-5 shadow-card backdrop-blur-xl hover:border-white/[0.18]", onClick && "cursor-pointer")}>
      <div className="flex items-center justify-between">
        {icon ? <IconChip d={icon} accent={accent} /> : <span className="text-[12px] font-medium text-muted">{label}</span>}
        <DeltaChip pct={delta ?? undefined} />
      </div>
      {icon && <div className="mt-3 text-[12px] font-medium text-muted">{label}</div>}
      <div className="mt-1 tnum font-display text-[28px] font-bold leading-none text-text">{value}</div>
      {sub && <div className="mt-1.5 text-[12px] text-dim">{sub}</div>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/* ─ Pill / Badge ───────────────────────────────────────────────────────── */
type Tone = "neutral" | "good" | "bad" | "warn" | "pink" | "info" | "violet";
const TONES: Record<Tone, string> = {
  neutral: "bg-panel2 border border-line text-muted",
  good: "bg-good/12 text-good",
  bad: "bg-bad/12 text-bad",
  warn: "bg-warn/12 text-warn",
  pink: "bg-pink/12 text-pink",
  info: "bg-info/12 text-info",
  violet: "bg-violet/12 text-violet",
};
export function Pill({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold", TONES[tone], className)}>{children}</span>;
}
export const Badge = Pill;

/* ─ Delta chip (▲ +4% / ▼ −3%) ─────────────────────────────────────────── */
export function DeltaChip({ pct, suffix = "%" }: { pct?: number | null; suffix?: string }) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const up = pct >= 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 tnum text-[11px] font-bold", up ? "bg-good/12 text-good" : "bg-bad/12 text-bad")}>
      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        {up ? <path d="M3 8l3-3 3 3" /> : <path d="M3 4l3 3 3-3" />}
      </svg>
      {Math.abs(Math.round(pct))}{suffix}
    </span>
  );
}
/** Back-compat: simple inline delta. */
export function Delta({ value, suffix }: { value: number; suffix?: string }) {
  return <DeltaChip pct={value} suffix={suffix ?? "%"} />;
}

/* ─ Progress ring (SVG, theme-aware track) ─────────────────────────────── */
export function Ring({ value, size = 128, stroke = 12, color, children }: {
  value: number | null; size?: number; stroke?: number; color?: string; children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value ?? 0));
  const tier: [string, string, string] = color ? [color, color, color]
    : v >= 80 ? ["#34D399", "#10B981", "#10B981"]
    : v >= 55 ? ["#FBBF24", "#F59E0B", "#F59E0B"]
    : v >= 1 ? ["#FB7185", "#F43F5E", "#F43F5E"]
    : ["#CBD5E1", "#CBD5E1", "#CBD5E1"];
  const gid = `ring-${tier[0].slice(1)}-${size}`;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={tier[0]} /><stop offset="100%" stopColor={tier[1]} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: "rgb(var(--line2))" }} strokeWidth={stroke} />
        {value != null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${gid})`} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: "stroke-dashoffset .7s cubic-bezier(.4,0,.2,1)", filter: `drop-shadow(0 0 ${stroke / 2}px ${tier[2]}55)` }} />
        )}
      </svg>
      <div className="absolute flex flex-col items-center">{children}</div>
    </div>
  );
}

/* ─ Buttons ────────────────────────────────────────────────────────────── */
export function Button({ variant = "primary", size = "md", className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger"; size?: "sm" | "md" }) {
  const V: Record<string, string> = {
    primary: "bg-gradient-to-br from-pink to-violet text-white shadow-pink hover:brightness-[1.08]",
    ghost: "border border-white/[0.09] bg-white/[0.05] text-text hover:bg-white/[0.09]",
    outline: "border border-white/[0.09] bg-white/[0.03] text-text hover:bg-white/[0.07]",
    danger: "bg-bad/15 text-bad hover:bg-bad/25",
  };
  const S = size === "sm" ? "px-3 py-2 text-[13px]" : "px-4 py-2.5 text-sm";
  return (
    <button className={cn("lift inline-flex items-center justify-center gap-2 rounded-xl font-display font-semibold transition disabled:cursor-not-allowed disabled:opacity-45", S, V[variant], className)} {...props}>
      {children}
    </button>
  );
}

/** A capability that's visible but not built yet. */
export function GatedButton({ children }: { children: ReactNode }) {
  return <Button variant="outline" disabled title="Coming soon — not built yet">{children}</Button>;
}

/* ─ Form controls ──────────────────────────────────────────────────────── */
export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-muted">{label}</span>
      {children}
      {error && <span className="mt-1 block text-[11px] text-bad">{error}</span>}
    </label>
  );
}
const FIELD = "w-full rounded-xl border border-white/[0.09] bg-white/[0.04] px-3.5 py-2.5 text-sm text-text outline-none transition placeholder:text-faint focus:border-pink/60 [color-scheme:dark]";
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(FIELD, props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(FIELD, "cursor-pointer", props.className)} />;
}

/* ─ Segmented tabs / chips ─────────────────────────────────────────────── */
export function Tabs<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn("inline-flex gap-1 rounded-xl border border-white/[0.09] bg-white/[0.04] p-1", className)}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cn("rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition", value === o.value ? "bg-gradient-to-br from-pink to-violet text-white shadow-pink" : "text-muted hover:text-text")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ─ Area sparkline (gradient fill) ─────────────────────────────────────── */
export function Sparkline({ data, accent = "pink", height = 56, className }: { data: number[]; accent?: Accent; height?: number; className?: string }) {
  const w = 240, h = height, pad = 3;
  const max = Math.max(1, ...data), min = Math.min(0, ...data);
  const span = max - min || 1;
  const n = data.length;
  const x = (i: number) => (n <= 1 ? w / 2 : pad + (i * (w - pad * 2)) / (n - 1));
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const line = data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${h} L${x(0).toFixed(1)},${h} Z`;
  const stop = ACCENTS[accent].ring;
  const gid = `spark-${accent}-${height}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("w-full", className)} style={{ height }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stop} stopOpacity="0.28" /><stop offset="100%" stopColor={stop} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={stop} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
