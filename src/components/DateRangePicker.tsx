/** Global date-range picker. A pill that opens a polished popover: quick presets
 *  (Today → All time) as a chip grid, plus an easy custom From→To with a live
 *  preview. Writes to the shared filter store so every screen reacts. Matches the
 *  app's premium dark/light design. */
import { useState } from "react";
import { useFilters, useActiveRange } from "@/store/filters";
import { RANGE_PRESETS, rangeLabel, type RangeKey } from "@/core/range";
import { todayCairo } from "@/core/time";
import { fmtDate } from "@/core/utils/date";
import { cn } from "@/core/utils/cn";

export function DateRangePicker({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const { rangeKey, customFrom, customTo, setRangeKey, setCustom } = useFilters();
  const range = useActiveRange();

  return (
    <div className={cn("relative", className)}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="lift flex items-center gap-2 rounded-2xl border border-white/[0.09] bg-white/[0.04] px-3.5 py-2.5 text-sm backdrop-blur-xl hover:border-pink/40"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-pink" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" />
        </svg>
        <span className="font-display font-bold text-text">{rangeLabel(rangeKey, range)}</span>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-dim" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-[61] mt-2 w-[320px] max-w-[92vw] animate-rise rounded-[24px] border border-white/[0.1] bg-[#111319] p-3 shadow-pop backdrop-blur-2xl">
            <div className="px-1 pb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-dim">Quick ranges</div>
            <div className="grid grid-cols-2 gap-1.5">
              {RANGE_PRESETS.filter((p) => p.key !== "custom").map((p) => (
                <button
                  key={p.key}
                  onClick={() => { setRangeKey(p.key as RangeKey); setOpen(false); }}
                  className={cn("flex items-center justify-between rounded-2xl px-3 py-2.5 text-left text-[13px] font-semibold transition",
                    rangeKey === p.key ? "bg-gradient-to-br from-pink to-violet text-white shadow-pink" : "border border-white/[0.06] bg-white/[0.03] text-muted hover:text-text")}
                >
                  {p.label}
                  {rangeKey === p.key && <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>}
                </button>
              ))}
            </div>

            <div className="mt-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-dim">Custom range</span>
                {rangeKey === "custom" && <span className="rounded-full bg-pink/12 px-2 py-0.5 text-[10px] font-bold text-pink">active</span>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted">From</span>
                  <input type="date" value={customFrom} max={customTo || todayCairo()}
                    onChange={(e) => setCustom(e.target.value, customTo)}
                    className="w-full rounded-xl border border-line bg-panel px-2.5 py-2 text-[13px] text-text outline-none focus:border-pink/60" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted">To</span>
                  <input type="date" value={customTo} max={todayCairo()}
                    onChange={(e) => setCustom(customFrom, e.target.value)}
                    className="w-full rounded-xl border border-line bg-panel px-2.5 py-2 text-[13px] text-text outline-none focus:border-pink/60" />
                </label>
              </div>
              {rangeKey === "custom" && (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="tnum text-[11px] text-dim">{fmtDate(range.from, "d MMM yyyy")} → {fmtDate(range.to, "d MMM yyyy")}</span>
                  <button onClick={() => setOpen(false)} className="lift rounded-xl bg-gradient-to-br from-pink to-violet px-3.5 py-1.5 text-[13px] font-bold text-white shadow-pink">Apply</button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
