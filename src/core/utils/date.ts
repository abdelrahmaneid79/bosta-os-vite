import { format, parseISO, isWithinInterval, subDays, startOfMonth, endOfMonth } from "date-fns";

type ISODate = string;
interface DateRange { from: string; to: string }

export function todayISO(): ISODate {
  return format(new Date(), "yyyy-MM-dd");
}

export function fmtDate(iso: ISODate, pattern = "dd MMM"): string {
  try {
    return format(parseISO(iso), pattern);
  } catch {
    return iso;
  }
}

export function inRange(iso: ISODate, range: DateRange): boolean {
  try {
    return isWithinInterval(parseISO(iso), {
      start: parseISO(range.from),
      end: parseISO(range.to),
    });
  } catch {
    return false;
  }
}

export function lastNDays(n: number): DateRange {
  const to = new Date();
  return { from: format(subDays(to, n - 1), "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") };
}

export function thisMonth(): DateRange {
  const now = new Date();
  return {
    from: format(startOfMonth(now), "yyyy-MM-dd"),
    to: format(endOfMonth(now), "yyyy-MM-dd"),
  };
}
