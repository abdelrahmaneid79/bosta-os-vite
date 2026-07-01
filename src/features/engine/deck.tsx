/** Command Deck screen primitives — the design's own markup (.pagehdr / .statgrid
 *  / .stat tile / .mbars / .tbl / .subtabs), as reusable React so every screen is
 *  identical to the design. Pure presentation; screens wire them to live data. */
import type { ReactNode } from "react";

export function PageHdr({ title, sub, right }: { title: string; sub: string; right?: ReactNode }) {
  return (
    <div className="pagehdr">
      <h1>{title}</h1>
      <p>{sub}</p>
      {right && <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>{right}</div>}
    </div>
  );
}

/** A stat tile: coloured dot + label, big number. Matches the design's this.stat. */
export function Stat({ label, value, color, sub, onClick }: { label: string; value: ReactNode; color: string; sub?: ReactNode; onClick?: () => void }) {
  return (
    <div className="tile" style={onClick ? { cursor: "pointer" } : { cursor: "default" }} onClick={onClick}>
      <div className="klbl"><span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />{label}</div>
      <div className="kv tnum">{value}</div>
      {sub}
    </div>
  );
}

export function DeckTile({ children, className = "", style, onClick }: { children: ReactNode; className?: string; style?: React.CSSProperties; onClick?: () => void }) {
  return <div className={`tile ${className}`} style={{ cursor: onClick ? "pointer" : "default", ...style }} onClick={onClick}>{children}</div>;
}

export function TileHead({ name, right }: { name: ReactNode; right?: ReactNode }) {
  return <div className="th"><span className="tname">{name}</span>{right && <span className="eyebrow" style={{ marginLeft: "auto" }}>{right}</span>}</div>;
}

export interface Bar { label: string; full: string; value: number }
/** The design's .mbars bar chart (hover tooltip, animated grow). */
export function MBars({ data, height = 200, gradient }: { data: Bar[]; height?: number; gradient?: string }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const money = (n: number) => "EGP " + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <div className="mbars" style={{ height }}>
      {data.map((d, i) => (
        <div className="mbar" key={i}>
          <div className="mbtip"><b>{money(d.value)}</b>{d.full}</div>
          <i style={{ height: `${Math.round((Math.abs(d.value) / max) * 100)}%`, ...(gradient ? { background: gradient } : {}) }} />
          <small>{d.label}</small>
        </div>
      ))}
    </div>
  );
}

export function SubTabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="subtabs">
      {tabs.map((t) => <span key={t.value} className={value === t.value ? "on" : ""} onClick={() => onChange(t.value)}>{t.label}</span>)}
    </div>
  );
}
