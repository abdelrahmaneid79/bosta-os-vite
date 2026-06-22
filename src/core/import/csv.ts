/**
 * Pure CSV parsing/mapping for imports. No I/O, no Supabase — fully testable.
 * The screen feeds already-parsed rows (PapaParse header rows) in; this maps +
 * validates them. Approval/writing happens in the screen, never here.
 */
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function pick(headers: string[], syns: string[]): string | null {
  for (const s of syns) {
    const exact = headers.find((h) => norm(h) === s);
    if (exact) return exact;
  }
  for (const s of syns) {
    const part = headers.find((h) => norm(h).includes(s));
    if (part) return part;
  }
  return null;
}

export function toIso(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = "20" + y;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

export function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export type Row = Record<string, string>;

export interface SaleRowParsed { date: string | null; total: number | null; issues: string[] }
export function parseSalesRows(rows: Row[]): SaleRowParsed[] {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  const dateCol = pick(headers, ["date", "day", "sale date", "تاريخ"]);
  const totalCol = pick(headers, ["total", "grand total", "amount", "sales", "net", "المبيعات", "الاجمالي"]);
  return rows.map((r) => {
    const date = toIso(dateCol ? r[dateCol] : "");
    const total = toNum(totalCol ? r[totalCol] : "");
    const issues: string[] = [];
    if (!date) issues.push("no date");
    if (total == null) issues.push("no total");
    return { date, total, issues };
  });
}

export interface ExpenseRowParsed { date: string | null; category: string; amount: number | null; payment: string; notes: string; issues: string[] }
export function parseExpenseRows(rows: Row[]): ExpenseRowParsed[] {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  const dateCol = pick(headers, ["date", "day", "تاريخ"]);
  const catCol = pick(headers, ["category", "type", "account", "البيان", "الفئة"]);
  const amtCol = pick(headers, ["amount", "total", "cost", "value", "المبلغ"]);
  const payCol = pick(headers, ["payment", "method", "pay", "الدفع"]);
  const noteCol = pick(headers, ["notes", "note", "description", "desc", "ملاحظات"]);
  return rows.map((r) => {
    const date = toIso(dateCol ? r[dateCol] : "");
    const amount = toNum(amtCol ? r[amtCol] : "");
    const category = ((catCol ? r[catCol] : "") || "").trim() || "Other";
    const payment = ((payCol ? r[payCol] : "") || "").trim().toLowerCase();
    const notes = ((noteCol ? r[noteCol] : "") || "").trim();
    const issues: string[] = [];
    if (!date) issues.push("no date");
    if (amount == null) issues.push("no amount");
    return { date, category, amount, payment, notes, issues };
  });
}

/** Heuristic reader for a single receipt/screenshot's OCR text → best (date,
 *  total) guess. Picks the first parseable date and the amount on a line that
 *  mentions "total" (falling back to the largest money number). The owner
 *  always edits before approving, so this only needs to get close. Pure. */
const DATE_RE = /(\d{4}-\d{2}-\d{2})|(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/;
const MONEY_RE = /\d[\d,]*\.?\d*/g;
/** Money numbers on a line, after stripping any date token so date digits
 *  (e.g. 2026) never masquerade as amounts. */
function moneyOnLine(line: string): number[] {
  const m = line.replace(DATE_RE, " ").match(MONEY_RE);
  return m ? m.map(toNum).filter((x): x is number => x != null && x > 0) : [];
}

export function scanReceiptText(text: unknown): { date: string | null; total: number | null } {
  const lines = String(text ?? "").split(/\r?\n/);
  let date: string | null = null;
  const amounts: number[] = [];
  for (const line of lines) {
    if (!date) { const dm = line.match(DATE_RE); if (dm) { const iso = toIso(dm[0]); if (iso) date = iso; } }
    amounts.push(...moneyOnLine(line));
  }
  let total: number | null = null;
  const totalLine = lines.find((l) => /total|الاجمالي|الإجمالي|اجمالي|net/i.test(l));
  if (totalLine) { const vals = moneyOnLine(totalLine); if (vals.length) total = Math.max(...vals); }
  if (total == null && amounts.length) total = Math.max(...amounts);
  return { date, total };
}

/** Multi-row reader for a sales sheet/screenshot: any line that has BOTH a date
 *  and a money number becomes a {date, amount} row (largest number on the line
 *  wins, e.g. the day's grand total). Falls back to a single best-guess row from
 *  scanReceiptText when no date-bearing lines are found. Pure + unit-tested. */
export function scanReceiptRows(text: unknown): { date: string; amount: number }[] {
  const lines = String(text ?? "").split(/\r?\n/);
  const rows: { date: string; amount: number }[] = [];
  for (const line of lines) {
    const dm = line.match(DATE_RE);
    if (!dm) continue;
    const iso = toIso(dm[0]);
    if (!iso) continue;
    const vals = moneyOnLine(line);
    if (vals.length) rows.push({ date: iso, amount: Math.max(...vals) });
  }
  if (rows.length) return rows;
  const one = scanReceiptText(text);
  return one.date && one.total != null ? [{ date: one.date, amount: one.total }] : [];
}
