/** Pure cash-ledger sign logic. The `money_movements` ledger is cash-only: it
 *  records what enters/leaves the drawer and NEVER feeds profit & loss. P&L is
 *  driven solely by the `expenses` table (operating costs) and sale-item COGS.
 *  Keeping this pure makes the money signs + the "never affects profit"
 *  invariant unit-testable without touching Supabase. */
import type { Enums } from "@/core/db/tables";

export type MoneyType = Enums<"money_movement_type">;

/** Types that increase cash. */
export const MONEY_INFLOW: readonly MoneyType[] = ["cheque_inflow", "owner_injection"];
/** Types that decrease cash. */
export const MONEY_OUTFLOW: readonly MoneyType[] = ["personal_withdrawal", "cash_expense", "salary"];

/** Signed amount for the cash ledger: inflow → +, outflow → −, adjustment uses
 *  the caller's direction (an adjustment can move the balance either way). */
export function signMoney(type: MoneyType, magnitude: number, direction?: "in" | "out"): number {
  if (MONEY_INFLOW.includes(type)) return Math.abs(magnitude);
  if (MONEY_OUTFLOW.includes(type)) return -Math.abs(magnitude);
  return direction === "out" ? -Math.abs(magnitude) : Math.abs(magnitude); // adjustment
}

/** Invariant: NO cash movement affects profit. Operating expenses live in the
 *  `expenses` table; personal withdrawals and generic cash-out are drawer-only.
 *  This predicate exists so that invariant is explicit and tested. */
export function affectsProfit(_type: MoneyType): boolean {
  return false;
}
