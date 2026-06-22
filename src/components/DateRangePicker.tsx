/** Global date-range picker. A compact pill that opens a popover with presets
 *  (Today → Year) and a custom from→to. Writes to the shared filter store, so
 *  every screen reacts. Keeps the app's dark/pink design language. */
import { useState } from "react";
import { useFilters, useActiveRange } from "@/store/filters";
import { RANGE_PRESETS, rangeLabel, type RangeKey } from "@/core/range";
import { todayCairo } from "@/core/time";
import { cn } from "@/core/utils/cn";

export function DateRangePicker({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const { rangeKey, customFrom, customTo, setRangeKey, setCustom } = useFilters();
  const range = useActiveRange();

  return (
    <div className={cn("relative", className)}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-xl border border-line bg-panel2 px-3 py-2 text-sm text-text hover:border-pink/50"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-pink" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" />
        </svg>
        <span className="font-display font-semibold">{rangeLabel(rangeKey, range)}</span>
        <span className="hidden text-[11px] text-dim sm:inline">{range.from} → {range.to}</span>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-dim" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-[300px] rounded-2xl border border-line bg-panel2 p-3 shadow-sheet">
            <div className="grid grid-cols-2 gap-1.5">
              {RANGE_PRESETS.filter((p) => p.key !== "custom").map((p) => (
                <button
                  key={p.key}
                  onClick={() => { setRangeKey(p.key as RangeKey); if (p.key !== "custom") setOpen(false); }}
                  className={cn("rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition",
                    rangeKey === p.key ? "bg-pink/15 text-pink" : "text-muted hover:bg-line2 hover:text-text")}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="mt-3 border-t border-line2 pt-3">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-dim">Custom range</div>
              <div className="flex items-center gap-2">
                <input type="date" value={customFrom} max={customTo || todayCairo()}
                  onChange={(e) => setCustom(e.target.value, customTo)}
                  className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 py-1.5 text-[13px] text-text" />
                <span className="text-dim">→</span>
                <input type="date" value={customTo} max={todayCairo()}
                  onChange={(e) => setCustom(customFrom, e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 py-1.5 text-[13px] text-text" />
              </div>
              {rangeKey === "custom" && (
                <button onClick={() => setOpen(false)} className="mt-2 w-full rounded-lg bg-pink px-3 py-1.5 text-[13px] font-semibold text-ink">Apply</button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
