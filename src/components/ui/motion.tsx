/** Motion primitives — the two moves that make the app feel like a modern
 *  fintech product instead of a report:
 *
 *  · CountUp   — a number that settles into place. Numbers are the product
 *                here; they deserve the one animation that carries meaning
 *                (the value arriving), and nothing else.
 *  · Sheet     — the "detail one tap away" layer. Bottom sheet on phones,
 *                right-hand panel on desktop. This is what lets every screen
 *                show ONE answer and keep its evidence behind a tap.
 *
 *  Both collapse to static under prefers-reduced-motion. No animation library:
 *  one rAF loop and CSS transforms are all this needs.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/components/ui/useFocusTrap";
import { useScrollLock } from "@/components/ui/useScrollLock";

const reduced = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Animated number. Formats through `format` every frame so currency grouping
 *  holds mid-flight. Re-runs whenever `value` changes, easing from the last
 *  shown value — so a refetch nudges rather than restarts. */
export function CountUp({ value, format, duration = 700 }: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const fmt = format ?? ((n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const [shown, setShown] = useState(() => (reduced() ? value : 0));
  const from = useRef(reduced() ? value : 0);
  const raf = useRef(0);

  useEffect(() => {
    if (reduced()) { setShown(value); from.current = value; return; }
    const start = performance.now();
    const base = from.current;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);            // ease-out cubic: fast arrival, soft settle
      const cur = base + (value - base) * eased;
      setShown(cur);
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);

  return <span className="tnum">{fmt(shown)}</span>;
}

/** Detail layer. Renders into a portal above everything; slides up from the
 *  bottom on small screens and in from the right on wide ones (pure CSS —
 *  the media query decides, the component doesn't care). Escape and backdrop
 *  both close. Fixed geometry: the panel never resizes with its content. */
export function Sheet({ open, onClose, title, children, wide = false }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  // Mount/unmount with an exit animation: keep rendering briefly after close.
  const [phase, setPhase] = useState<"closed" | "opening" | "open" | "closing">("closed");
  useEffect(() => {
    if (open) {
      setPhase("opening");
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setPhase("open")));
      return () => cancelAnimationFrame(id);
    }
    if (phase !== "closed") {
      setPhase("closing");
      const t = setTimeout(() => setPhase("closed"), reduced() ? 0 : 260);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The project's focus trap owns Escape handling and focus restoration.
  const ref = useFocusTrap<HTMLDivElement>(phase === "open", onClose);
  useScrollLock(phase !== "closed");

  if (phase === "closed") return null;
  const shown = phase === "open";
  return createPortal(
    <div className="cdk sheet-root" role="presentation">
      <div className={`sheet-backdrop${shown ? " on" : ""}`} onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" className={`sheet-panel${shown ? " on" : ""}${wide ? " wide" : ""}`}>
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <div className="sheet-title">{title}</div>
          <button type="button" className="sheet-x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
