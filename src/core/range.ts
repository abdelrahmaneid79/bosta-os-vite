/** Date-range engine — the single source of truth for "what period am I looking
 *  at". Pure and testable (pass `today` to pin it). Powers the global filter so
 *  every screen can be scoped to Today, a rolling window, a month/quarter/year,
 *  or a fully custom from→to. */
import { isoDaysAgo, todayCairo } from "./time";
import type { DateRange } from "./read/common";

export type RangeKey = "today" | "7d" | "30d" | "month" | "last" | "quarter" | "year" | "custom";

export interface RangePreset { key: RangeKey; label: string; short: string }
export const RANGE_PRESETS: RangePreset[] = [
  { key: "today", label: "Today", short: "Today" },
  { key: "7d", label: "Last 7 days", short: "7d" },
  { key: "30d", label: "Last 30 days", short: "30d" },
  { key: "month", label: "This month", short: "Month" },
  { key: "last", label: "Last month", short: "Last mo." },
  { key: "quarter", label: "This quarter", short: "Quarter" },
  { key: "year", label: "This year", short: "Year" },
  { key: "custom", label: "Custom range", short: "Custom" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Resolve a key (+ custom dates) into a concrete inclusive range. Pure. */
export function resolveRange(key: RangeKey, custom?: { from: string; to: string }, today: string = todayCairo()): DateRange {
  const [y, m] = today.split("-").map(Number);
  switch (key) {
    case "today": return { from: today, to: today };
    case "7d": return { from: isoDaysAgo(today, 6), to: today };
    case "30d": return { from: isoDaysAgo(today, 29), to: today };
    case "month": return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
    case "last": {
      const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
      return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDay(py, pm))}` };
    }
    case "quarter": {
      const q = Math.floor((m - 1) / 3), sm = q * 3 + 1, em = sm + 2;
      return { from: `${y}-${pad(sm)}-01`, to: `${y}-${pad(em)}-${pad(lastDay(y, em))}` };
    }
    case "year": return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "custom": {
      const f = custom?.from || today, t = custom?.to || today;
      return f <= t ? { from: f, to: t } : { from: t, to: f }; // tolerate reversed input
    }
  }
}

/** Human label for the current selection (used in headers). */
export function rangeLabel(key: RangeKey, range: DateRange): string {
  const preset = RANGE_PRESETS.find((p) => p.key === key);
  if (key === "custom") return `${range.from} → ${range.to}`;
  return preset?.label ?? "Range";
}
