/**
 * Business clock — Africa/Cairo (owner-confirmed). All "what day is it" logic
 * routes through here so today / this-month / missing-days / cash-close match
 * how the stall actually operates, not UTC. Pure; no deps.
 */
const TZ = "Africa/Cairo";

/** Parts of `now` (or a given instant) in Cairo local time. */
function cairoParts(d: Date = new Date()): { y: number; m: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const [{ value: y }, , { value: m }, , { value: day }] = fmt.formatToParts(d);
  return { y: Number(y), m: Number(m), day: Number(day) };
}

/** Today in Cairo as an ISO date `YYYY-MM-DD`. */
export function todayCairo(d: Date = new Date()): string {
  const { y, m, day } = cairoParts(d);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** First and last day of the current Cairo month, inclusive. */
export function monthBoundsCairo(d: Date = new Date()): { from: string; to: string } {
  const { y, m } = cairoParts(d);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last of this
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

/** Previous Cairo month bounds. */
export function lastMonthBoundsCairo(d: Date = new Date()): { from: string; to: string } {
  const { y, m } = cairoParts(d);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const mm = String(pm).padStart(2, "0");
  return { from: `${py}-${mm}-01`, to: `${py}-${mm}-${String(last).padStart(2, "0")}` };
}

/** ISO date N days before `iso` (calendar arithmetic, tz-safe). */
export function isoDaysAgo(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}

/** Inclusive list of ISO dates from `from` to `to`. */
export function isoRange(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const cur = new Date(Date.UTC(fy, fm - 1, fd));
  const end = to;
  while (cur.toISOString().slice(0, 10) <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}
