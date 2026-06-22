/** Global, app-wide filters. The active date range is shared across every data
 *  screen so picking "This quarter" or a custom window on one screen carries to
 *  the rest. Product/category/payment filters are per-screen (local) — only the
 *  range is global, because that's the lens the owner thinks in. */
import { create } from "zustand";
import { resolveRange, type RangeKey } from "@/core/range";
import { todayCairo } from "@/core/time";
import type { DateRange } from "@/core/read/common";

interface FilterState {
  rangeKey: RangeKey;
  customFrom: string;
  customTo: string;
  setRangeKey: (k: RangeKey) => void;
  setCustom: (from: string, to: string) => void;
}

export const useFilters = create<FilterState>((set) => ({
  rangeKey: "month",
  customFrom: resolveRange("month").from,
  customTo: todayCairo(),
  setRangeKey: (rangeKey) => set({ rangeKey }),
  setCustom: (customFrom, customTo) => set({ customFrom, customTo, rangeKey: "custom" }),
}));

/** The resolved active range — subscribe to this in screens. */
export function useActiveRange(): DateRange {
  const { rangeKey, customFrom, customTo } = useFilters();
  return resolveRange(rangeKey, { from: customFrom, to: customTo });
}
