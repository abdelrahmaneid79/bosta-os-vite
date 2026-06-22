import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { cn } from "@/core/utils/cn";

/* ─ Surfaces ───────────────────────────────────────────────────────────── */
export function Card({ className, children, glow }: { className?: string; children: ReactNode; glow?: boolean }) {
  return (
    <div className={cn("relative overflow-hidden rounded-[20px] border border-line bg-panel p-4 sm:p-5", className)}>
      {glow && <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-pink/10 blur-2xl" />}
      {children}
    </div>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("font-mono text-[10.5px] uppercase tracking-[0.12em] text-dim", className)}>{children}</div>;
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <h2 className="font-display text-lg font-semibold text-text">{children}</h2>
      {sub && <p className="text-xs text-dim">{sub}</p>}
    </div>
  );
}

/* ─ Stat tile ──────────────────────────────────────────────────────────── */
export function Stat({
  label, value, sub, accent = "text-text", onClick,
}: { label: string; value: ReactNode; sub?: ReactNode; accent?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick}
      className={cn("rounded-[18px] border border-line bg-panel p-4", onClick && "lift cursor-pointer hover:border-line2")}>
      <div className="mb-1.5 text-[11px] text-muted">{label}</div>
      <div className={cn("font-display text-xl font-semibold leading-none", accent)}>{value}</div>
      {sub && <div className="mt-1.5 text-[11px] text-dim">{sub}</div>}
    </div>
  );
}

/* ─ Pill / Badge ───────────────────────────────────────────────────────── */
type Tone = "neutral" | "good" | "bad" | "warn" | "pink";
const TONES: Record<Tone, string> = {
  neutral: "bg-line2 border border-line text-muted",
  good: "bg-good/15 text-good",
  bad: "bg-bad/15 text-bad",
  warn: "bg-warn/15 text-warn",
  pink: "bg-pink/15 text-pink",
};
export function Pill({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-display text-[11px] font-semibold", TONES[tone], className)}>{children}</span>;
}
export const Badge = Pill;

/* ─ Delta (▲ +4 / ▼ −3) ────────────────────────────────────────────────── */
export function Delta({ value, suffix }: { value: number; suffix?: string }) {
  const up = value >= 0;
  return <span className={cn("font-mono text-[11px]", up ? "text-good" : "text-bad")}>{up ? "▲" : "▼"} {up ? "+" : "−"}{Math.abs(value)}{suffix}</span>;
}

/* ─ Progress ring (SVG) ────────────────────────────────────────────────── */
export function Ring({ value, size = 128, stroke = 11, color, children }: {
  value: number | null; size?: number; stroke?: number; color?: string; children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  const col = color ?? (v >= 80 ? "#54D69A" : v >= 55 ? "#F2B33D" : v >= 1 ? "#FF5C5C" : "#3A2230");
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#241019" strokeWidth={stroke} />
        {value != null && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={stroke}
            strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dashoffset .6s ease" }} />
        )}
      </svg>
      <div className="absolute flex flex-col items-center">{children}</div>
    </div>
  );
}

/* ─ Buttons ────────────────────────────────────────────────────────────── */
export function Button({ variant = "primary", className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger" }) {
  const V: Record<string, string> = {
    primary: "bg-pink text-ink shadow-pink hover:brightness-105",
    ghost: "bg-line2 text-text hover:bg-line",
    outline: "border border-line bg-panel2 text-text hover:bg-line2",
    danger: "bg-bad/15 text-bad hover:bg-bad/25",
  };
  return (
    <button className={cn("lift inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-display text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45", V[variant], className)} {...props}>
      {children}
    </button>
  );
}

/** A write action that's visible but gated in read-only mode. */
export function GatedButton({ children }: { children: ReactNode }) {
  return <Button variant="outline" disabled title="Writes are disabled in read-only mode">{children}</Button>;
}

/* ─ Form controls ──────────────────────────────────────────────────────── */
export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-muted">{label}</span>
      {children}
      {error && <span className="mt-1 block text-[11px] text-bad">{error}</span>}
    </label>
  );
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("w-full rounded-xl border border-line bg-panel2 px-3.5 py-2.5 text-sm text-text outline-none transition placeholder:text-faint focus:border-pink/60", props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn("w-full rounded-xl border border-line bg-panel2 px-3.5 py-2.5 text-sm text-text outline-none transition focus:border-pink/60", props.className)} />;
}

/* ─ Segmented tabs / chips ─────────────────────────────────────────────── */
export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex gap-0.5 rounded-full border border-line bg-panel2 p-0.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cn("rounded-full px-3.5 py-1.5 font-display text-xs font-semibold transition", value === o.value ? "bg-pink text-ink" : "text-muted hover:text-text")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
