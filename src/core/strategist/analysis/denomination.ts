/** Denomination-assisted cash counting — PURE Layer 2 (Cycle 9).
 *
 *  Optional aid: the owner can count the drawer by denomination, or just key a
 *  manual total. When both exist and disagree, the mismatch is surfaced and
 *  saving requires explicit confirmation — the count is never silently forced
 *  to one figure. Denominations are configurable (EGP defaults) so this never
 *  hard-codes a currency, and they never become separate financial accounts. */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Common EGP denominations (notes + coins). Configurable per currency. */
export const EGP_DENOMINATIONS = [200, 100, 50, 20, 10, 5, 1, 0.5, 0.25];

export interface DenomLine { denom: number; qty: number }

export interface DenomCountInput {
  lines: DenomLine[];
  manualTotal?: number | null;   // owner-keyed total (may differ from the denomination tally)
  pettyCash?: number | null;     // tracked separately, not part of the drawer
  bankBalance?: number | null;   // tracked separately
}

export interface DenomCountResult {
  breakdown: { denom: number; qty: number; subtotal: number }[];
  denomTotal: number;
  manualTotal: number | null;
  drawerTotal: number;           // the figure that will be saved as the count
  pettyCash: number | null;
  bankBalance: number | null;
  mismatch: boolean;
  mismatchAmount: number;        // manualTotal − denomTotal
  requiresConfirmation: boolean; // true when a mismatch must be acknowledged before save
  note: string;
}

export function computeDenomCount(input: DenomCountInput): DenomCountResult {
  const breakdown = input.lines
    .filter((l) => l.qty > 0)
    .map((l) => ({ denom: l.denom, qty: Math.floor(l.qty), subtotal: r2(l.denom * Math.floor(l.qty)) }))
    .sort((a, b) => b.denom - a.denom);
  const denomTotal = r2(breakdown.reduce((s, l) => s + l.subtotal, 0));
  const manualTotal = input.manualTotal ?? null;
  // when a manual total is entered it wins (owner may be counting faster than
  // the denomination grid), but any disagreement must be acknowledged
  const hasManual = manualTotal != null;
  const mismatchAmount = hasManual ? r2(manualTotal - denomTotal) : 0;
  const mismatch = hasManual && breakdown.length > 0 && Math.abs(mismatchAmount) >= 0.5;
  const drawerTotal = hasManual ? manualTotal : denomTotal;

  const note = mismatch
    ? `Denomination tally (${denomTotal.toLocaleString()}) and manual total (${manualTotal!.toLocaleString()}) differ by ${Math.abs(mismatchAmount).toLocaleString()} EGP. Re-check, or confirm the manual total to save.`
    : hasManual && breakdown.length === 0
      ? "Manual total only — no denomination breakdown entered."
      : breakdown.length > 0
        ? "Counted by denomination."
        : "No amounts entered yet.";

  return {
    breakdown, denomTotal, manualTotal, drawerTotal,
    pettyCash: input.pettyCash ?? null, bankBalance: input.bankBalance ?? null,
    mismatch, mismatchAmount, requiresConfirmation: mismatch, note,
  };
}
