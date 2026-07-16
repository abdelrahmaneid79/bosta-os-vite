/**
 * OCR TEXT NORMALISATION + FIELD PARSERS (pure, unit-tested).
 * ----------------------------------------------------------
 * Deterministic conversion of raw per-cell OCR text into typed values, tuned
 * for the Bosta POS day report: Western + Arabic-Indic numerals, thousands
 * separators, and the handful of digit confusions Tesseract makes on this font.
 * No value is ever invented — unreadable input returns null.
 */

/** Arabic-Indic (٠-٩) and Eastern-Arabic (۰-۹) → Western 0-9. */
export function toWesternDigits(s: string): string {
  return (s ?? "").replace(/[٠-٩۰-۹]/g, (d) => {
    const c = d.charCodeAt(0);
    const base = c >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(c - base);
  });
}

/** Common OCR digit confusions in a numeric context (letters → digits). Applied
 *  ONLY to strings we already expect to be numbers, never to product names. */
export function fixNumericConfusions(s: string): string {
  return (s ?? "")
    .replace(/[OoQ]/g, "0")
    .replace(/[lIi|]/g, "1")
    .replace(/[Zz]/g, "2")
    .replace(/[Ss]/g, "5")
    .replace(/[B]/g, "8")
    .replace(/[gq]/g, "9")
    .replace(/[،٬]/g, ",") // arabic comma/thousands → ascii
    .replace(/[٫]/g, "."); // arabic decimal sep → dot
}

/** Keep only digits — the POS item code, leading zeros preserved (matching folds
 *  them later). Returns "" when no digits survive. */
export function parseCode(raw: string): string {
  return toWesternDigits(raw).replace(/\D/g, "");
}

/** Parse a money/decimal value. Handles "1,040.33", stray spaces, Arabic
 *  numerals and the numeric confusions above. Returns null when nothing usable
 *  remains. `maxDecimals` guards against a lost decimal point (e.g. "11008"). */
export function parseMoney(raw: string): number | null {
  let s = fixNumericConfusions(toWesternDigits(raw)).replace(/\s+/g, "");
  s = s.replace(/,/g, "");                 // drop thousands separators
  const m = /-?\d+(?:\.\d+)?/.exec(s);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Parse a quantity/weight (up to 3 decimals on this report). Same rules as
 *  money but semantically distinct so callers read intent at the call site. */
export function parseQuantity(raw: string): number | null {
  return parseMoney(raw);
}

/** Extract the "from" trading date from a header line. The report header reads
 *  «خلال الفترة من YYYY/MM/DD الى YYYY/MM/DD»; we take the FIRST date (the «من»
 *  from-date), never تاريخ الطباعة (print date). Accepts / or - or . separators
 *  and Arabic numerals. Returns ISO yyyy-mm-dd or null. */
export function parseHeaderDate(raw: string): string | null {
  const s = toWesternDigits(raw);
  const matches = [...s.matchAll(/(\d{2,4})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/g)];
  const valid = matches.filter((m) => normaliseDateParts(m[1], m[2], m[3]));
  if (!valid.length) return null;
  // Prefer the «من» (from) date over تاريخ الطباعة (print date): take the first
  // valid date that appears AFTER the first "من" in the header. The print date
  // sits before it; the «الى» date equals «من» on single-day reports.
  const fromIdx = s.indexOf("من");
  const pick = fromIdx >= 0 ? (valid.find((m) => (m.index ?? 0) > fromIdx) ?? valid[0]) : valid[0];
  return normaliseDateParts(pick[1], pick[2], pick[3]);
}

/** Turn three numeric parts into an ISO date, inferring y-m-d vs d-m-y by which
 *  part is the 4-digit year. Rejects impossible month/day. */
export function normaliseDateParts(a: string, b: string, c: string): string | null {
  let y: number, mo: number, d: number;
  if (a.length === 4) { y = +a; mo = +b; d = +c; }        // yyyy/mm/dd
  else if (c.length === 4) { d = +a; mo = +b; y = +c; }   // dd/mm/yyyy
  else { d = +a; mo = +b; y = 2000 + (+c % 100); }        // dd/mm/yy
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
