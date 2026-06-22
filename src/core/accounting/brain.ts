/**
 * BASIC ACCOUNTING BRAIN
 * ----------------------
 * A separate, deterministic cleaning layer that turns messy real-world exports
 * (POS net-sales reports, Zoho expense/bill exports, hand-kept monthly sheets,
 * cheque memories) into ONE clean canonical ledger of editable entries.
 *
 * It encodes the rules learned from Bosta Bites' real data so the app never
 * mis-reads it again:
 *   1. Daily revenue = the POS "net value" (صافى القيمة = gross − returns), one
 *      figure per day. Never sum product lines into revenue; never count a
 *      barcode/16-digit code as money.
 *   2. Double days (same date twice) are de-duplicated, not added together.
 *   3. A "bill" exported per line-item is ONE purchase — collapse by bill id.
 *   4. Identical expense rows that appear in several files are de-duplicated.
 *   5. Cheques are settlement money RECEIVED — separate from sales and from
 *      operating expenses; they never touch profit.
 *   6. When two sources overlap (e.g. POS report + a monthly sheet), the
 *      authoritative source wins; the other only fills missing days.
 *
 * Pure + unit-tested. The importer feeds parsed rows in; the cleaned entries go
 * to Supabase as normal, editable rows — nothing is hard-coded.
 */

export interface CleanSale { date: string; total: number }
export interface CleanExpense { date: string; category: string; amount: number; vendor: string | null; notes: string | null }
export interface CleanPurchase { date: string; vendor: string; total: number; ref: string | null }
export interface CleanCheque { date: string; amount: number }

export interface DedupeResult<T> { clean: T[]; kept: number; dropped: number }

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Rule 1 + 2: one revenue figure per day, de-duplicated (NOT summed). When a
 *  date repeats we keep the first non-null total and report the collisions. */
export function dedupeDailySales(rows: { date: string | null; total: number | null }[]): DedupeResult<CleanSale> {
  const byDate = new Map<string, number>();
  let dropped = 0;
  for (const r of rows) {
    if (!r.date || r.total == null || !Number.isFinite(r.total)) continue;
    if (byDate.has(r.date)) { dropped += 1; continue; } // double day → keep first
    byDate.set(r.date, round2(r.total));
  }
  const clean = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, total]) => ({ date, total }));
  return { clean, kept: clean.length, dropped };
}

/** Rule 6: authoritative `primary` wins; `secondary` only contributes days that
 *  the primary is missing (e.g. a hand-sheet covering dates after the POS export
 *  cut-off). */
export function mergeDailySales(primary: CleanSale[], secondary: CleanSale[]): { merged: CleanSale[]; added: number } {
  const seen = new Set(primary.map((s) => s.date));
  let added = 0;
  const extra = secondary.filter((s) => !seen.has(s.date));
  added = extra.length;
  const merged = [...primary, ...extra].sort((a, b) => a.date.localeCompare(b.date));
  return { merged, added };
}

/** Rule 4: collapse identical expense rows that recur across files. Identity =
 *  (date, category, amount, vendor). */
export function dedupeExpenses(rows: { date: string | null; category: string | null; amount: number | null; vendor?: string | null; notes?: string | null }[]): DedupeResult<CleanExpense> {
  const seen = new Set<string>();
  const clean: CleanExpense[] = [];
  let dropped = 0;
  for (const r of rows) {
    if (!r.date || r.amount == null || !Number.isFinite(r.amount)) continue;
    const category = (r.category ?? "Other").trim() || "Other";
    const vendor = (r.vendor ?? "").trim() || null;
    const key = `${r.date}|${category.toLowerCase()}|${round2(r.amount)}|${(vendor ?? "").toLowerCase()}`;
    if (seen.has(key)) { dropped += 1; continue; }
    seen.add(key);
    clean.push({ date: r.date, category, amount: round2(r.amount), vendor, notes: (r.notes ?? "")?.trim() || null });
  }
  clean.sort((a, b) => a.date.localeCompare(b.date));
  return { clean, kept: clean.length, dropped };
}

/** Rule 3: a bill exported one-row-per-line-item is a single purchase. Collapse
 *  by `ref` (bill id); the bill total is identical on each line, so take the
 *  first. Rows without a ref fall back to (date|vendor|total) identity. */
export function dedupeBillsByRef(rows: { ref: string | null; date: string | null; vendor: string | null; total: number | null }[]): DedupeResult<CleanPurchase> {
  const seen = new Set<string>();
  const clean: CleanPurchase[] = [];
  let dropped = 0;
  for (const r of rows) {
    if (!r.date || r.total == null || !Number.isFinite(r.total)) continue;
    const vendor = (r.vendor ?? "").trim() || "Unknown";
    const ref = (r.ref ?? "").trim() || null;
    const key = ref ?? `${r.date}|${vendor.toLowerCase()}|${round2(r.total)}`;
    if (seen.has(key)) { dropped += 1; continue; }
    seen.add(key);
    clean.push({ date: r.date, vendor, total: round2(r.total), ref });
  }
  clean.sort((a, b) => a.date.localeCompare(b.date));
  return { clean, kept: clean.length, dropped };
}

/** Cheques: de-duplicate by (date, amount) — separate ledger, never profit. */
export function dedupeCheques(rows: { date: string | null; amount: number | null }[]): DedupeResult<CleanCheque> {
  const seen = new Set<string>();
  const clean: CleanCheque[] = [];
  let dropped = 0;
  for (const r of rows) {
    if (!r.date || r.amount == null || !Number.isFinite(r.amount)) continue;
    const key = `${r.date}|${round2(r.amount)}`;
    if (seen.has(key)) { dropped += 1; continue; }
    seen.add(key);
    clean.push({ date: r.date, amount: round2(r.amount) });
  }
  clean.sort((a, b) => a.date.localeCompare(b.date));
  return { clean, kept: clean.length, dropped };
}

/** A reconciliation snapshot the UI can show after a clean. */
export interface Reconciliation { salesDays: number; salesTotal: number; expensesTotal: number; purchasesTotal: number; chequesTotal: number; from: string | null; to: string | null }
export function reconcile(sales: CleanSale[], expenses: CleanExpense[], purchases: CleanPurchase[], cheques: CleanCheque[]): Reconciliation {
  const dates = sales.map((s) => s.date).sort();
  const sum = (xs: number[]) => round2(xs.reduce((s, n) => s + n, 0));
  return {
    salesDays: sales.length,
    salesTotal: sum(sales.map((s) => s.total)),
    expensesTotal: sum(expenses.map((e) => e.amount)),
    purchasesTotal: sum(purchases.map((p) => p.total)),
    chequesTotal: sum(cheques.map((c) => c.amount)),
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
  };
}
