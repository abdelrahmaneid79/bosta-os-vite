import type { ReactNode } from "react";
import { useEffect } from "react";
import { cn } from "@/core/utils/cn";

/** The design's .modal — a clean centered card over a dimmed, lightly-blurred
 *  backdrop. No slide/bounce; the background is scroll-locked while open so the
 *  page can't jump. `wide` widens it; omit `title` for a bare card (floating ✕). */
export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title?: string; children: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // Lock background scroll so opening a popup never shifts/bounces the page.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-root fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6">
      <div onClick={onClose} className="absolute inset-0 bg-[rgba(4,5,7,0.72)] backdrop-blur-[6px]" />
      <div onClick={(e) => e.stopPropagation()}
        className={cn("relative max-h-[86vh] w-full overflow-y-auto rounded-[26px] border border-white/[0.09] bg-[linear-gradient(180deg,#16191f,#101319)] p-6 shadow-[0_50px_110px_-30px_#000]",
          wide ? "max-w-3xl" : "max-w-md")}>
        {title ? (
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold text-text">{title}</h3>
            <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.04] text-muted transition hover:text-text">✕</button>
          </div>
        ) : (
          <button onClick={onClose} className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.04] text-muted transition hover:text-text">✕</button>
        )}
        {children}
      </div>
    </div>
  );
}
