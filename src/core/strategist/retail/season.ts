/** ═══════════════════════════════════════════════════════════════════════
 *  THE EGYPTIAN RETAIL CALENDAR for a nut & snack stand.
 *
 *  Nuts are one of the most seasonal categories in Egypt. Two forces drive
 *  the year and both are predictable:
 *
 *    · Ramadan / Eid — the yamish (nuts & dried fruit) peak. Buying starts
 *      WEEKS before the month itself; a stand that reacts on day one has
 *      already lost the pre-stocking wave.
 *    · Temperature — nut consumption climbs in the cold months and falls
 *      through the Egyptian summer, when chocolate-coated lines also suffer.
 *
 *  Knowing this changes the diagnosis: a soft July is the season doing what
 *  it always does, not the business failing. Advice for a seasonal trough is
 *  the opposite of advice for a structural decline — you protect cash and
 *  prepare the peak rather than panic-cutting the range.
 *
 *  Islamic dates follow the lunar calendar and shift ~11 days earlier each
 *  Gregorian year; the entries below are the astronomical approximations and
 *  the true start can move a day either way on the moon sighting. That is
 *  precise enough for buying decisions, which need weeks of notice, and the
 *  uncertainty is stated wherever a date is shown.
 *  PURE — the caller supplies "today". */
import type { RetailSeason } from "./contract";

export interface SeasonWindow {
  season: RetailSeason;
  name: string;
  /** inclusive ISO start / end */
  from: string;
  to: string;
  /** how many weeks ahead the owner should already be acting */
  leadWeeks: number;
  /** what the season does to this business, in the owner's terms */
  effect: string;
  /** the standing play for the window */
  play: string;
}

/** Ramadan + both Eids, approximated astronomically (±1 day on sighting). */
const ISLAMIC: { year: number; ramadanFrom: string; ramadanTo: string; fitr: string; adha: string }[] = [
  { year: 2026, ramadanFrom: "2026-02-17", ramadanTo: "2026-03-19", fitr: "2026-03-20", adha: "2026-05-27" },
  { year: 2027, ramadanFrom: "2027-02-07", ramadanTo: "2027-03-08", fitr: "2027-03-09", adha: "2027-05-16" },
  { year: 2028, ramadanFrom: "2028-01-27", ramadanTo: "2028-02-25", fitr: "2028-02-26", adha: "2028-05-05" },
  { year: 2029, ramadanFrom: "2029-01-16", ramadanTo: "2029-02-13", fitr: "2029-02-14", adha: "2029-04-24" },
  { year: 2030, ramadanFrom: "2030-01-05", ramadanTo: "2030-02-03", fitr: "2030-02-04", adha: "2030-04-13" },
];

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Every trading window relevant to the years the app will realistically run. */
export function seasonCalendar(): SeasonWindow[] {
  const out: SeasonWindow[] = [];
  for (const y of ISLAMIC) {
    out.push({
      season: "ramadan", name: `Ramadan ${y.year}`, from: y.ramadanFrom, to: y.ramadanTo, leadWeeks: 5,
      effect: "The single biggest nut & dried-fruit window of the year. Demand builds BEFORE it starts as households stock up, and evening trade after iftar replaces daytime trade.",
      play: "Be fully stocked a week before it begins, weight the range to gifting and yamish lines, and make sure the stand is fullest in the evening.",
    });
    out.push({
      season: "eid", name: `Eid al-Fitr ${y.year}`, from: y.fitr, to: addDays(y.fitr, 3), leadWeeks: 3,
      effect: "Gifting peak. Shoppers trade up and buy presentation formats rather than loose weight.",
      play: "Lead with gift boxes and premium mixes at round prices; this is the one window where presentation beats price.",
    });
    out.push({
      season: "eid", name: `Eid al-Adha ${y.year}`, from: y.adha, to: addDays(y.adha, 4), leadWeeks: 3,
      effect: "Family gathering and hosting occasion — larger take-home packs move.",
      play: "Push family/sharing sizes and hosting mixes rather than single-serve.",
    });
    out.push({
      season: "back_to_school", name: `Back to school ${y.year}`, from: `${y.year}-09-10`, to: `${y.year}-10-10`, leadWeeks: 3,
      effect: "Demand shifts to small, cheap, lunchbox-friendly packs bought in repeat volume.",
      play: "Front the small round-priced packs and the cheaper snack lines; this window rewards unit count, not ticket.",
    });
    out.push({
      season: "winter_nuts", name: `Winter nut season ${y.year}`, from: `${y.year}-11-01`, to: `${y.year + 1}-02-15`, leadWeeks: 4,
      effect: "Peak nut trading. Cold weather lifts nut consumption and chocolate-coated lines travel safely again.",
      play: "Widen the premium nut range, hold deeper stock, and protect availability — this is when the year's profit is made.",
    });
    out.push({
      season: "summer_slow", name: `Summer trough ${y.year}`, from: `${y.year}-06-01`, to: `${y.year}-08-31`, leadWeeks: 0,
      effect: "The annual low. Heat suppresses nut demand, travel thins mall traffic, and chocolate-coated lines are at melt risk.",
      play: "Do not read this as failure. Protect cash, keep stock tight to avoid waste, shift the mix toward seeds and heat-stable lines, and use the quiet weeks to build the fixtures and formats you will sell hard in winter.",
    });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

/** The window live on `today`, if any. Overlapping windows resolve to the
 *  most specific: a named peak always beats the broad summer/winter band. */
export function seasonOn(today: string): SeasonWindow | null {
  const live = seasonCalendar().filter((w) => w.from <= today && today <= w.to);
  if (!live.length) return null;
  const rank: Record<RetailSeason, number> = {
    eid: 5, ramadan: 4, back_to_school: 3, gifting: 2, winter_nuts: 1, summer_slow: 0,
  };
  return live.sort((a, b) => rank[b.season] - rank[a.season])[0];
}

/** The next window the owner should be preparing for — the one whose lead
 *  time is closest to biting. Returns null only past the end of the table. */
export function nextSeason(today: string): { window: SeasonWindow; weeksAway: number; actNow: boolean } | null {
  const upcoming = seasonCalendar().filter((w) => w.from > today);
  if (!upcoming.length) return null;
  const w = upcoming[0];
  const weeksAway = Math.round((Date.parse(`${w.from}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / (7 * 86_400_000));
  return { window: w, weeksAway, actNow: weeksAway <= w.leadWeeks };
}
