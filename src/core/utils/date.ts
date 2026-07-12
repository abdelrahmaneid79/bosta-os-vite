/** Date DISPLAY helper only. All date *math* (today, windows, ranges) lives in
 *  src/core/time.ts on the Cairo business clock — the local-TZ helpers that
 *  used to live here (todayISO/lastNDays/thisMonth/inRange) shifted days for
 *  any viewer outside Cairo and have been deleted. */
import { format, parseISO } from "date-fns";

export function fmtDate(iso: string, pattern = "d MMM yyyy"): string {
  try {
    return format(parseISO(iso), pattern);
  } catch {
    return iso;
  }
}
