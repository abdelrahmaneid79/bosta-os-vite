/**
 * OCR PRODUCT-LINE PARSER (pure)
 * ------------------------------
 * Turns the raw text of a photographed POS *daily product report* into editable
 * product lines. The photo has the same shape as the Excel export — a table where
 * each row is one product (Arabic name, price it sold at, quantity, line total),
 * with the day's grand total at the bottom and the trading day in a header.
 *
 * OCR is noisy and the column order is ambiguous in RTL, so we DON'T trust column
 * positions. Instead, for each row we pull every number out and use arithmetic to
 * recover the roles: the line total is the value that equals price × quantity, and
 * the remaining pair splits into price (larger) and quantity (smaller). That makes
 * the line total — what the day must add up to — robust even when the qty/price
 * guess needs a human tweak. Everything lands in the importer's editable preview;
 * nothing is trusted blindly. Pure + unit-tested; the screen owns OCR + writes.
 */
import { toIso } from "./csv";

const AR_INDIC = "٠١٢٣٤٥٦٧٨٩";   // U+0660..0669
const FA_INDIC = "۰۱۲۳۴۵۶۷۸۹";   // U+06F0..06F9
/** Fold Arabic/Persian-Indic digits to ASCII so numbers parse uniformly. */
export function foldDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const a = AR_INDIC.indexOf(d); if (a >= 0) return String(a);
    const f = FA_INDIC.indexOf(d); return f >= 0 ? String(f) : d;
  });
}

const hasArabic = (s: string) => /[؀-ۿ]/.test(s);
const TOTAL_HINT = /اجمال|إجمال|total|المجموع|الكلى|الكلي/i;
const DATE_RE = /(\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2})|(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000; // weight quantities keep 3 decimals

/** A long run of digits (≥11) is a barcode/EAN, never money. Returns it + the
 *  string with it removed so it doesn't pollute the numeric columns. */
function extractBarcode(folded: string): { barcode: string; rest: string } {
  const m = folded.match(/\d{11,}/);
  return m ? { barcode: m[0], rest: folded.replace(m[0], " ") } : { barcode: "", rest: folded };
}

/** Money/count numbers on a line (thousands separators removed, Arabic decimal
 *  U+066B handled). Barcodes must be stripped first. */
function numbersIn(folded: string): number[] {
  const cleaned = folded.replace(/٫/g, ".").replace(/(?<=\d)[,،](?=\d{3}(?:\D|$))/g, "");
  const out: number[] = [];
  for (const m of cleaned.matchAll(/\d+(?:\.\d+)?/g)) {
    const n = parseFloat(m[0]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export interface OcrLine { rawName: string; barcode: string; qty: number | null; unitPrice: number | null; lineTotal: number | null }
export interface OcrParse { date: string | null; lines: OcrLine[]; dayTotal: number | null }

/** Recover {qty, unitPrice, lineTotal} from a row's numbers without trusting
 *  column order: the total is the number that equals the product of two others
 *  (≈2% tolerance); of that pair the larger is the unit price, the smaller the
 *  quantity. Falls back sensibly for 2-number rows and unmatched triples. */
export function inferRoles(nums: number[]): { qty: number | null; unitPrice: number | null; lineTotal: number | null } {
  const ns = nums.filter((n) => n > 0);
  if (ns.length === 0) return { qty: null, unitPrice: null, lineTotal: null };
  if (ns.length === 1) return { qty: null, unitPrice: null, lineTotal: r2(ns[0]) };

  // try every (a,b)->c where a*b ≈ c
  for (let i = 0; i < ns.length; i++)
    for (let j = i + 1; j < ns.length; j++)
      for (let k = 0; k < ns.length; k++) {
        if (k === i || k === j) continue;
        const prod = ns[i] * ns[j];
        if (ns[k] > 0 && Math.abs(prod - ns[k]) <= ns[k] * 0.02 + 0.01) {
          const price = Math.max(ns[i], ns[j]); const qty = Math.min(ns[i], ns[j]);
          return { qty: r3(qty), unitPrice: r2(price), lineTotal: r2(ns[k]) };
        }
      }

  // no arithmetic match: assume the largest is the line total and split the rest
  const sorted = [...ns].sort((a, b) => b - a);
  const lineTotal = sorted[0];
  if (ns.length === 2) {
    const qty = sorted[1];
    return { qty: r3(qty), unitPrice: qty > 0 ? r2(lineTotal / qty) : null, lineTotal: r2(lineTotal) };
  }
  // ≥3 numbers, no clean product: price next-largest, qty next
  const unitPrice = sorted[1], qty = sorted[2];
  return { qty: r3(qty), unitPrice: r2(unitPrice), lineTotal: r2(lineTotal) };
}

/** Earliest ISO date anywhere in the text (the trading day precedes the print
 *  timestamp in these reports). */
function sniffDate(text: string): string | null {
  const folded = foldDigits(text);
  const out: string[] = [];
  for (const m of folded.matchAll(/(\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2})|(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/g)) {
    const iso = toIso(m[0]); if (iso) out.push(iso);
  }
  out.sort();
  return out[0] ?? null;
}

/** Parse OCR text of a daily product report into editable lines + the day total. */
export function parseOcrProductLines(text: string): OcrParse {
  const date = sniffDate(text);
  const lines: OcrLine[] = [];
  let dayTotal: number | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const folded = foldDigits(line);
    const { barcode, rest } = extractBarcode(folded);

    // a totals row sets the day total and is never a product line
    if (TOTAL_HINT.test(line)) {
      const ns = numbersIn(rest);
      if (ns.length) dayTotal = Math.max(dayTotal ?? 0, r2(Math.max(...ns)));
      continue;
    }
    // period / print-date header rows carry dates — metadata, not products
    if (DATE_RE.test(folded)) continue;

    const ns = numbersIn(rest);
    const name = rest.replace(/\d+(?:[.٫,،]\d+)*/g, " ").replace(/\s+/g, " ").trim();
    // a product row = some Arabic name + at least two numbers (price & total / qty)
    if (!hasArabic(name) && !barcode) continue;
    if (ns.length < 2) continue;
    const { qty, unitPrice, lineTotal } = inferRoles(ns);
    lines.push({ rawName: name, barcode, qty, unitPrice, lineTotal });
  }

  // if no explicit total row, fall back to the sum of detected lines
  if (dayTotal == null && lines.length) {
    const s = lines.reduce((a, l) => a + (l.lineTotal ?? 0), 0);
    dayTotal = s > 0 ? r2(s) : null;
  }
  return { date, lines, dayTotal };
}
