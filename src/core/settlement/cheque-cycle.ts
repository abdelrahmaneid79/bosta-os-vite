/**
 * CHEQUE CYCLE (pure)
 * -------------------
 * Models the real Bosta Bites flow: daily sales accumulate; a settlement cheque
 * arrives every so often (no fixed schedule) and "closes the tab" for the sales
 * since the previous cheque. We cross-reference each cheque against the actual
 * sales in its window to derive its coverage period (date-to-date), the revenue
 * it settled, and the implied mall deduction.
 *
 * Honest about gaps: cheques weren't recorded before the first one on file
 * (early sales were settled as cash), so that span is reported as a "cash era",
 * not as money owed. The first recorded cheque has no known prior boundary, so
 * its coverage is left unknown rather than guessed. The "open tab" is the sales
 * accumulated since the last cheque — what the next cheque will settle.
 */
export interface ChequeIn { id: string; date: string; amount: number }
export interface DayRev { date: string; total: number }

export interface ChequeCoverage {
  id: string; date: string; amount: number;
  coverFrom: string | null; coverTo: string; coverDays: number | null;
  coverRevenue: number | null;
  impliedDeduction: number | null;   // coverRevenue − amount (mall's cut)
  deductionPct: number | null;
}
export interface OpenTab { from: string | null; to: string; revenue: number; days: number }
export interface CashEra { from: string; to: string; revenue: number }

export interface ChequeCycle {
  cheques: ChequeCoverage[];   // newest first
  totalReceived: number;
  openTab: OpenTab;
  cashEra: CashEra | null;
  blendedDeductionPct: number | null;  // over cheques with known coverage
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const dayAfter = (iso: string) => isoAdd(iso, 1);
const dayBefore = (iso: string) => isoAdd(iso, -1);
function isoAdd(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;

export function buildChequeCycle(cheques: ChequeIn[], daily: DayRev[], today: string): ChequeCycle {
  const sorted = [...cheques].sort((a, b) => a.date.localeCompare(b.date));
  const sumRange = (a: string, b: string) => a > b ? 0 : r2(daily.reduce((s, d) => (d.date >= a && d.date <= b ? s + d.total : s), 0));
  const earliest = daily.length ? daily.map((d) => d.date).sort()[0] : null;

  const cov: ChequeCoverage[] = sorted.map((c, i) => {
    if (i === 0) {
      return { id: c.id, date: c.date, amount: c.amount, coverFrom: null, coverTo: c.date, coverDays: null, coverRevenue: null, impliedDeduction: null, deductionPct: null };
    }
    const coverFrom = dayAfter(sorted[i - 1].date);
    const coverTo = c.date;
    const coverRevenue = sumRange(coverFrom, coverTo);
    const impliedDeduction = r2(coverRevenue - c.amount);
    const deductionPct = coverRevenue > 0 ? r2((impliedDeduction / coverRevenue) * 100) : null;
    return { id: c.id, date: c.date, amount: c.amount, coverFrom, coverTo, coverDays: daysBetween(coverFrom, coverTo), coverRevenue, impliedDeduction, deductionPct };
  });

  const lastDate = sorted.length ? sorted[sorted.length - 1].date : null;
  const openFrom = lastDate ? dayAfter(lastDate) : earliest;
  const openTab: OpenTab = {
    from: openFrom, to: today,
    revenue: openFrom ? sumRange(openFrom, today) : 0,
    days: openFrom && openFrom <= today ? daysBetween(openFrom, today) : 0,
  };

  const firstDate = sorted.length ? sorted[0].date : null;
  const cashEra: CashEra | null = firstDate && earliest && earliest < firstDate
    ? { from: earliest, to: dayBefore(firstDate), revenue: sumRange(earliest, dayBefore(firstDate)) }
    : null;

  const known = cov.filter((c) => c.coverRevenue != null && c.coverRevenue > 0);
  const totRev = known.reduce((s, c) => s + (c.coverRevenue ?? 0), 0);
  const totDed = known.reduce((s, c) => s + (c.impliedDeduction ?? 0), 0);
  const blendedDeductionPct = totRev > 0 ? r2((totDed / totRev) * 100) : null;

  return {
    cheques: cov.reverse(), // newest first for display
    totalReceived: r2(sorted.reduce((s, c) => s + c.amount, 0)),
    openTab, cashEra, blendedDeductionPct,
  };
}
