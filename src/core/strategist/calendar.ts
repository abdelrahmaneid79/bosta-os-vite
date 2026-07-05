/** Calendar context for the business strategist — PURE, deterministic, no live
 *  feed. Given a date, it returns day-of-week, the Egyptian weekend flag, and the
 *  upcoming Egyptian retail-relevant dates (Ramadan, the two Eids, back-to-school,
 *  Valentine, Mother's Day, Sham El-Nessim) with days-until. These are FIXED
 *  calendar facts the model may reason about freely ("Ramadan in 3 weeks → stock
 *  dates & nuts"). Islamic dates are moon-sighting approximations (flagged approx).
 *
 *  Dates are hardcoded (not fetched) so the strategist never claims a live feed.
 *  Extend RETAIL_DATES as years roll forward. */

export interface CalendarEvent {
  name: string;
  date: string;      // YYYY-MM-DD
  daysUntil: number; // whole days from `today`
  approx: boolean;   // true for moon-sighting Islamic dates
  why: string;       // one-line retail relevance for a snack/nut/candy stand
}

export interface CalendarContext {
  today: string;
  dayOfWeek: string;   // "Sunday" … "Saturday"
  isWeekend: boolean;  // Egyptian weekend = Friday + Saturday
  monthName: string;
  upcoming: CalendarEvent[]; // future events, soonest first
}

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Known Egyptian retail-relevant dates. Islamic ones (Ramadan/Eid) are approximate
 *  Gregorian equivalents — real start depends on the moon sighting. Keep extending. */
const RETAIL_DATES: { name: string; date: string; approx: boolean; why: string }[] = [
  // 2026
  { name: "Back to school", date: "2026-09-19", approx: false, why: "families restock snacks for lunchboxes — small-pack demand rises" },
  // 2027
  { name: "New Year's Day", date: "2027-01-01", approx: false, why: "gifting & party snacking; mixed nuts and sweets move" },
  { name: "Coptic Christmas", date: "2027-01-07", approx: false, why: "festive gifting and family gatherings — sweets & nut mixes" },
  { name: "Valentine's Day", date: "2027-02-14", approx: false, why: "candy, chocolate-coated and gift-pack demand spikes" },
  { name: "Ramadan (start)", date: "2027-02-08", approx: true, why: "peak season — dried fruit, nuts, dates, ‘yameesh’; stock heavily & early" },
  { name: "Eid al-Fitr", date: "2027-03-10", approx: true, why: "gifting climax; kahk/sweets and premium nut boxes sell out" },
  { name: "Egyptian Mother's Day", date: "2027-03-21", approx: false, why: "gift packs & chocolate — a strong single-day retail bump" },
  { name: "Sham El-Nessim", date: "2027-05-03", approx: false, why: "spring outing snacking — seeds (lb), roasted nuts, light snacks" },
  { name: "Eid al-Adha", date: "2027-05-17", approx: true, why: "gatherings & gifting; nuts and sweets demand rises" },
  { name: "Back to school", date: "2027-09-19", approx: false, why: "families restock snacks for lunchboxes — small-pack demand rises" },
  // 2028
  { name: "Ramadan (start)", date: "2028-01-28", approx: true, why: "peak season — dried fruit, nuts, dates; stock heavily & early" },
];

/** Whole days between two YYYY-MM-DD dates (UTC midnight → integer, DST-safe). */
function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Build the calendar context for a given day. `today` is YYYY-MM-DD.
 *  `horizonDays` caps how far ahead to surface events (default ~10 months). */
export function computeCalendar(today: string, horizonDays = 300, limit = 6): CalendarContext {
  const t = Date.parse(`${today}T00:00:00Z`);
  const dow = new Date(t).getUTCDay(); // 0 Sun … 6 Sat
  const month = new Date(t).getUTCMonth();

  const upcoming: CalendarEvent[] = RETAIL_DATES
    .map((e) => ({ ...e, daysUntil: daysBetween(today, e.date) }))
    .filter((e) => e.daysUntil >= 0 && e.daysUntil <= horizonDays)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, limit)
    .map((e) => ({ name: e.name, date: e.date, daysUntil: e.daysUntil, approx: e.approx, why: e.why }));

  return {
    today,
    dayOfWeek: DOW[dow],
    isWeekend: dow === 5 || dow === 6, // Egyptian weekend Fri+Sat
    monthName: MONTHS[month],
    upcoming,
  };
}
