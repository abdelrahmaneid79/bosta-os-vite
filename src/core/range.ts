/** Date-range engine — the single source of truth for "what period am I looking
 *  at". Pure and testable (pass `today` to pin it). Powers the global filter so
 *  every screen can be scoped to Today, This week, a month/quarter/year, All
 *  time, or a fully custom from→to. */
import { isoDaysAgo, todayCairo } from "./time";
import { fmtDate } from "./utils/date";
import type { DateRange } from "./read/common";

export type RangeKey = "today" | "week" | "month" | "last" | "quarter" | "year" | "all" | "custom";

/** Floor for "All time" — Bosta Bites launched Oct 2024; this safely precedes
 *  any record so the range covers the whole history. */
export const ALL_TIME_FROM = "2024-01-01";

export interface RangePreset { key: RangeKey; label: string; short: string }
export const RANGE_PRESETS: RangePreset[] = [
  { key: "today", label: "Today", short: "Today" },
  { key: "week", label: "This week", short: "Week" },
  { key: "month", label: "This month", short: "Month" },
  { key: "last", label: "Last month", short: "Last mo." },
  { key: "quarter", label: "This quarter", short: "Quarter" },
  { key: "year", label: "This year", short: "Year" },
  { key: "all", label: "All time", short: "All" },
  { key: "custom", label: "Custom range", short: "Custom" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Resolve a key (+ custom dates) into a concrete inclusive range. Pure.
 *  Unknown keys fall back to "this month" (forward-compatible with old prefs). */
export function resolveRange(key: RangeKey, custom?: { from: string; to: string }, today: string = todayCairo()): DateRange {
  const [y, m, d] = today.split("-").map(Number);
  switch (key) {
    case "today": return { from: today, to: today };
    case "week": {
      // Egyptian week starts Saturday. getUTCDay: Sun=0 … Sat=6.
      const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      const sinceSat = (wd + 1) % 7;
      return { from: isoDaysAgo(today, sinceSat), to: today };
    }
    case "last": {
      const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
      return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDay(py, pm))}` };
    }
    case "quarter": {
      const q = Math.floor((m - 1) / 3), sm = q * 3 + 1, em = sm + 2;
      return { from: `${y}-${pad(sm)}-01`, to: `${y}-${pad(em)}-${pad(lastDay(y, em))}` };
    }
    case "year": return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "all": return { from: ALL_TIME_FROM, to: today };
    case "custom": {
      const f = custom?.from || today, t = custom?.to || today;
      return f <= t ? { from: f, to: t } : { from: t, to: f }; // tolerate reversed input
    }
    case "month":
    default: return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
  }
}

/** Human label for the current selection (used in headers + the picker). Custom
 *  shows full day/month/year on both ends so a date is never ambiguous. */
export function rangeLabel(key: RangeKey, range: DateRange): string {
  if (key === "custom") return `${fmtDate(range.from, "d MMM yyyy")} → ${fmtDate(range.to, "d MMM yyyy")}`;
  return RANGE_PRESETS.find((p) => p.key === key)?.label ?? "This month";
}
