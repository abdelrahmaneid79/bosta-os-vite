import { describe, it, expect } from "vitest";
import { buildOverview, catLabel, BANK_CATEGORIES, type BankTxn, type BankMonth, type BankReversal } from "@/core/read/bank";

const txn = (o: Partial<BankTxn>): BankTxn => ({
  id: o.id ?? Math.random().toString(36).slice(2), date: o.date ?? "2025-08-01",
  merchant: o.merchant ?? "BM GARDNIA ATM-No 01590952", place: o.place ?? "Gardenia", bank: o.bank ?? "Banque Misr",
  direction: o.direction ?? "debit", amount: o.amount ?? 0, balanceAfter: o.balanceAfter ?? 0,
  category: o.category ?? "cash_stock", side: o.side ?? "business", edited: o.edited ?? false, note: o.note ?? null,
  chainGap: o.chainGap ?? 0, depositAmount: o.depositAmount ?? null,
  isReversalRefund: o.isReversalRefund ?? false, balanceDerived: o.balanceDerived ?? false, raw: o.raw ?? null,
});
const month = (o: Partial<BankMonth>): BankMonth => ({
  month: o.month ?? "2025-08", chequesNet: o.chequesNet ?? 0, chequeCount: o.chequeCount ?? 0,
  banked: o.banked ?? 0, keptAsCash: o.keptAsCash ?? 0, cashOut: o.cashOut ?? 0,
  personalSpend: o.personalSpend ?? 0, movements: o.movements ?? 1, unreadableBreaks: o.unreadableBreaks ?? 0,
});
const rev = (amount: number, refundConfirmed = true): BankReversal =>
  ({ id: String(amount), dayMonth: "17/08", merchant: "BM BR GARD", amount, refundConfirmed, note: null });

describe("bank overview", () => {
  it("keeps cheque money the owner never banked, as cheques minus what arrived", () => {
    const o = buildOverview([], [
      month({ month: "2025-08", chequesNet: 100_000, banked: 70_000 }),
      month({ month: "2025-09", chequesNet: 50_000, banked: 50_000 }),
    ], []);
    expect(o.chequesNet).toBe(150_000);
    expect(o.banked).toBe(120_000);
    expect(o.keptAsCash).toBe(30_000);
  });

  it("excludes failed ATM attempts from cash out — the money never left", () => {
    // A reversed withdrawal texts a debit and then a refund. Counting the debit
    // would double the cash the owner actually walked away with.
    const o = buildOverview(
      [txn({ amount: 17_300, isReversalRefund: true })],
      [month({ cashOut: 60_000 })],
      [rev(17_300)],
    );
    expect(o.cashOut).toBe(60_000 - 17_300);
    expect(o.reversedTotal).toBe(17_300);
  });

  it("ignores months with no movements so empty months never dilute the totals", () => {
    const o = buildOverview([], [
      month({ month: "2025-08", chequesNet: 40_000, banked: 40_000, movements: 12 }),
      month({ month: "2026-03", chequesNet: 90_000, banked: 0, movements: 0 }), // outside the recording
    ], []);
    expect(o.chequesNet).toBe(40_000);
    expect(o.totalMonths).toBe(1);
  });

  it("counts a month as exact only when its chain has no breaks", () => {
    const o = buildOverview([], [
      month({ month: "2025-08", unreadableBreaks: 0 }),
      month({ month: "2025-09", unreadableBreaks: 3 }),
      month({ month: "2025-10", unreadableBreaks: 0 }),
    ], []);
    expect(o.exactMonths).toBe(2);
    expect(o.totalMonths).toBe(3);
  });

  it("reads opening and closing balance off the ends of the dated ledger", () => {
    const o = buildOverview([
      txn({ date: "2026-07-17", balanceAfter: 22_622.44 }),
      txn({ date: "2025-07-08", balanceAfter: 52_385.15 }),
      txn({ date: null, balanceAfter: 999 }),          // undated rows must not become an end
    ], [], []);
    expect(o.openingBalance).toBe(52_385.15);
    expect(o.closingBalance).toBe(22_622.44);
    expect(o.from).toBe("2025-07-08");
    expect(o.to).toBe("2026-07-17");
  });

  it("gives every category a label and a defensible side", () => {
    expect(catLabel("cash_stock")).toBe("Cash — stock run");
    expect(catLabel("nonsense")).toBe("nonsense");
    // Nothing at an ATM may be labelled personal: cash leaves as cash, and what
    // it was spent on is not knowable from the bank message.
    expect(BANK_CATEGORIES.find((c) => c.key === "cash_stock")!.side).toBe("business");
    expect(BANK_CATEGORIES.find((c) => c.key === "cash_small")!.side).toBe("check");
    // A shop we can read but not classify is personal, never a guessed industry.
    expect(BANK_CATEGORIES.find((c) => c.key === "personal_other")!.side).toBe("personal");
  });
});
