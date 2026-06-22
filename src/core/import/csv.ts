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
  // YYYY/MM/DD (Arabic POS reports use this, e.g. 2024/12/03)
  const ymd = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (ymd) { const [, y, mo, d] = ymd; return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`; }
  // D/M/Y or D-M-Y
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

export interface SalesMap { date: string; total: string }
export interface ExpenseMap { date: string; category: string; amount: string }

/** Best-guess column mapping for a sales sheet (owner can override in the UI). */
export function detectSalesMap(headers: string[]): SalesMap {
  return {
    date: pick(headers, ["date", "day", "sale date", "تاريخ"]) ?? headers[0] ?? "",
    total: pick(headers, ["total", "grand total", "amount", "sales", "net", "المبيعات", "الاجمالي"]) ?? "",
  };
}
export function detectExpenseMap(headers: string[]): ExpenseMap {
  return {
    date: pick(headers, ["date", "day", "تاريخ"]) ?? headers[0] ?? "",
    category: pick(headers, ["category", "type", "account", "البيان", "الفئة"]) ?? "",
    amount: pick(headers, ["amount", "total", "cost", "value", "المبلغ"]) ?? "",
  };
}
/** Build editable sales rows from raw rows + an explicit column mapping. Dates
 *  are normalised to ISO; totals to a clean number string. Pure. */
export function rowsWithSalesMap(rows: Row[], map: SalesMap): { date: string; total: string }[] {
  return rows.map((r) => {
    const iso = toIso(r[map.date]);
    const n = toNum(r[map.total]);
    return { date: iso ?? "", total: n != null ? String(n) : "" };
  });
}
export function rowsWithExpenseMap(rows: Row[], map: ExpenseMap): { date: string; category: string; amount: string }[] {
  return rows.map((r) => {
    const iso = toIso(r[map.date]);
    const n = toNum(r[map.amount]);
    const cat = (map.category ? r[map.category] : "")?.toString().trim() || "Other";
    return { date: iso ?? "", category: cat, amount: n != null ? String(n) : "" };
  });
}

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
const DATE_RE = /(\d{4}-\d{2}-\d{2})|(\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2})|(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/;
const MONEY_RE = /\d[\d,]*\.?\d*/g;
/** True for item-codes / barcodes that must NOT be read as money: a long pure
 *  integer (>=7 digits, e.g. a 16-digit barcode) or a leading-zero code
 *  (e.g. 00021043). */
function isCodeLike(token: string): boolean {
  const t = token.replace(/,/g, "");
  return /^0\d{3,}$/.test(t) || /^\d{7,}$/.test(t);
}
/** Money numbers on a line, after stripping any date token and ignoring
 *  codes/barcodes, so a 16-digit barcode never masquerades as the total. */
function moneyOnLine(line: string): number[] {
  const m = line.replace(DATE_RE, " ").match(MONEY_RE);
  return m ? m.filter((t) => !isCodeLike(t)).map(toNum).filter((x): x is number => x != null && x > 0) : [];
}

/** All ISO dates found on a line (left→right). */
function datesOnLine(line: string): string[] {
  const ds = line.match(new RegExp(DATE_RE.source, "g"));
  if (!ds) return [];
  return ds.map((t) => toIso(t)).filter((x): x is string => !!x);
}

export function scanReceiptText(text: unknown): { date: string | null; total: number | null } {
  const lines = String(text ?? "").split(/\r?\n/);
  // Date: prefer the reporting-PERIOD line (so a print timestamp isn't used);
  // take the last date on it (the "to" date). Else first date anywhere.
  let date: string | null = null;
  const periodLine = lines.find((l) => /الفترة|الفتره|period|reporting/i.test(l));
  if (periodLine) { const ds = datesOnLine(periodLine); if (ds.length) date = ds[ds.length - 1]; }
  if (!date) for (const line of lines) { const ds = datesOnLine(line); if (ds.length) { date = ds[0]; break; } }

  const amounts: number[] = [];
  for (const line of lines) amounts.push(...moneyOnLine(line));
  // Total: the "grand total" line (اجمالي / total / net), else the largest amount.
  let total: number | null = null;
  const totalLine = lines.find((l) => /grand total|\btotal\b|الاجمالي|الإجمالي|اجمالي|\bnet\b/i.test(l));
  if (totalLine) { const vals = moneyOnLine(totalLine); if (vals.length) total = Math.max(...vals); }
  if (total == null && amounts.length) total = Math.max(...amounts);
  return { date, total };
}

/** Reader for a sales sheet/screenshot. A POS daily report (has a grand-total or
 *  reporting period) is one day with one total → a single row. Otherwise every
 *  dated line becomes its own {date, amount} day. Pure + unit-tested. */
export function scanReceiptRows(text: unknown): { date: string; amount: number }[] {
  const s = String(text ?? "");
  const single = (): { date: string; amount: number }[] => {
    const one = scanReceiptText(s);
    return one.date && one.total != null ? [{ date: one.date, amount: one.total }] : [];
  };
  if (/grand total|الاجمالي|الإجمالي|اجمالي|الفترة|الفتره/i.test(s)) return single();

  const rows: { date: string; amount: number }[] = [];
  for (const line of s.split(/\r?\n/)) {
    if (/طباعة|\bprint/i.test(line) || /\d{1,2}:\d{2}/.test(line)) continue; // skip print-timestamp lines
    const ds = datesOnLine(line);
    if (!ds.length) continue;
    const vals = moneyOnLine(line);
    if (vals.length) rows.push({ date: ds[0], amount: Math.max(...vals) });
  }
  return rows.length ? rows : single();
}
