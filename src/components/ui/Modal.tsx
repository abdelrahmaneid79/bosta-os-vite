import type { ReactNode } from "react";
import { useEffect } from "react";

/** Bottom-sheet on mobile, centered dialog on desktop. Matches the design. */
export function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div onClick={onClose} className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-md animate-sheetUp overflow-y-auto rounded-t-3xl border border-line bg-panel2 p-5 shadow-sheet sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg bg-line2 text-muted hover:text-text">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
