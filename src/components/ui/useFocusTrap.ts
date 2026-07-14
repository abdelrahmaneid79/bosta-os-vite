import { useEffect, useRef } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Standard dialog keyboard behaviour, shared by every overlay/sheet in the
 *  app: while `active`, Tab/Shift+Tab cycle within the panel instead of
 *  escaping to the page behind, Escape calls `onClose`, focus moves into the
 *  panel on open, and returns to whatever was focused before on close.
 *
 *  Usage: `const panelRef = useFocusTrap(open, onClose);` then
 *  `<div ref={panelRef} role="dialog" aria-modal="true">…</div>`. */
export function useFocusTrap<T extends HTMLElement>(active: boolean, onClose: () => void): React.RefObject<T> {
  const panelRef = useRef<T>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const focusables = () => (panelRef.current ? Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)) : []);
    (focusables()[0] ?? panelRef.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      restoreFocusRef.current?.focus?.();
    };
  }, [active, onClose]);

  return panelRef;
}
