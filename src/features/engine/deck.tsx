/** Command Deck screen primitives — the design's own markup (.pagehdr / .statgrid
 *  / .stat tile / .mbars / .tbl / .subtabs), as reusable React so every screen is
 *  identical to the design. Pure presentation; screens wire them to live data. */
import { useState, type ReactNode } from "react";

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

/** Collapsible page section — progressive disclosure for long operational pages.
 *  A quiet region divider (hairline + title + count), NOT a card: its children
 *  are tiles, and cards-in-cards is banned. Controlled (`open`/`onToggle`) or
 *  uncontrolled (`defaultOpen`). Content stays in the DOM when closed only if
 *  `keepMounted` (so queries inside don't refire on every toggle). */
export function Section({ title, sub, badge, badgeColor, open, defaultOpen = true, onToggle, keepMounted = false, children }: {
  title: string; sub?: string; badge?: ReactNode; badgeColor?: string;
  open?: boolean; defaultOpen?: boolean; onToggle?: (next: boolean) => void;
  keepMounted?: boolean; children: ReactNode;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const isOpen = open ?? own;
  const toggle = () => { onToggle ? onToggle(!isOpen) : setOwn((v) => !v); };
  return (
    <section className="csec">
      <button type="button" className="csec-h" onClick={toggle} aria-expanded={isOpen}>
        <span className="csec-t">{title}</span>
        {badge != null && badge !== 0 && <span className="csec-b" style={badgeColor ? { color: badgeColor } : undefined}>{badge}</span>}
        {sub && <span className="csec-s">{sub}</span>}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          className="csec-ch" style={{ transform: isOpen ? "rotate(180deg)" : "none" }} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {(isOpen || keepMounted) && (
        <div className="space-y-4" style={keepMounted && !isOpen ? { display: "none" } : undefined}>{children}</div>
      )}
    </section>
  );
}
