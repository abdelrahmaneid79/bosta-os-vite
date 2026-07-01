import type { ReactNode } from "react";
import { useEffect } from "react";
import { cn } from "@/core/utils/cn";

/** Bottom-sheet on mobile, centered dialog on desktop — the design's .modal-card.
 *  `wide` widens it (detail popups); omit `title` for a bare card whose children
 *  provide their own header (a floating ✕ is shown). */
export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title?: string; children: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div onClick={onClose} className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div onClick={(e) => e.stopPropagation()}
        className={cn("relative max-h-[92vh] w-full animate-sheetUp overflow-y-auto rounded-t-[28px] border border-white/[0.1] bg-[#111319] p-5 shadow-pop backdrop-blur-2xl sm:rounded-[28px]",
          wide ? "sm:max-w-3xl" : "max-w-md")}>
        {title ? (
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold text-text">{title}</h3>
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-muted transition hover:text-text">✕</button>
          </div>
        ) : (
          <button onClick={onClose} className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-muted transition hover:text-text">✕</button>
        )}
        {children}
      </div>
    </div>
  );
}
