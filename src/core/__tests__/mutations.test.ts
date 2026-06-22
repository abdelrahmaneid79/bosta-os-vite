/** Mocked-Supabase mutation tests. We can't reach a real database in this
 *  sandbox, so we stub the engine seam with a tiny chainable client that records
 *  inserts and returns configurable results. This proves the write *logic*
 *  (duplicate-day guard, cash sign, recalc trigger) without a live backend. */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mock = vi.hoisted(() => {
  const captured: { table: string; op: "insert" | "update"; payload: Record<string, unknown> }[] = [];
  const results = {
    select: { data: [] as unknown[], error: null as unknown },
    insert: { data: { id: "new" } as unknown, error: null as unknown },
    update: { data: null as unknown, error: null as unknown },
  };
  function makeBuilder(table: string) {
    let op: "select" | "insert" | "update" = "select";
    const b: Record<string, unknown> = {};
    const ret = () => b;
    Object.assign(b, {
      select: ret, is: ret, eq: ret, gte: ret, lte: ret, in: ret, order: ret, limit: ret, ilike: ret, not: ret, single: ret,
      insert: (payload: Record<string, unknown>) => { op = "insert"; captured.push({ table, op, payload }); return b; },
      update: (payload: Record<string, unknown>) => { op = "update"; captured.push({ table, op, payload }); return b; },
      then: (resolve: (v: unknown) => unknown) => resolve(results[op]),
    });
    return b;
  }
  return { captured, results, fakeClient: { from: (t: string) => makeBuilder(t) } };
});

vi.mock("@/core/db/engine", () => ({
  requireEngine: () => mock.fakeClient,
  recalcMoneyAccount: vi.fn(() => Promise.resolve()),
  ensureMonthlySettlementPeriod: vi.fn(() => Promise.resolve()),
  createPurchase: vi.fn(() => Promise.resolve()),
  createSaleItem: vi.fn(() => Promise.resolve()),
  updateSaleItem: vi.fn(() => Promise.resolve()),
  deleteSaleItem: vi.fn(() => Promise.resolve()),
  voidSaleMovements: vi.fn(() => Promise.resolve()),
}));

import { createSale, createMovement, recordWithdrawal } from "@/core/db/mutations";
import { recalcMoneyAccount } from "@/core/db/engine";

beforeEach(() => {
  mock.captured.length = 0;
  mock.results.select = { data: [], error: null };
  mock.results.insert = { data: { id: "new" }, error: null };
  mock.results.update = { data: null, error: null };
  vi.clearAllMocks();
});

describe("createSale duplicate-day guard", () => {
  it("blocks a second sale on the same day with a clear message", async () => {
    mock.results.select = { data: [{ id: "existing" }], error: null };
    await expect(createSale({ date: "2026-06-01", total: 100, locationId: "L", channelId: "C" }))
      .rejects.toThrow(/already exists for that day/);
    // must NOT have attempted an insert
    expect(mock.captured.some((c) => c.table === "sales" && c.op === "insert")).toBe(false);
  });
  it("inserts and returns the new id when the day is free", async () => {
    mock.results.select = { data: [], error: null };
    mock.results.insert = { data: { id: "S1" }, error: null };
    const id = await createSale({ date: "2026-06-01", total: 4200, locationId: "L", channelId: "C" });
    expect(id).toBe("S1");
    const ins = mock.captured.find((c) => c.table === "sales" && c.op === "insert");
    expect(ins?.payload).toMatchObject({ sale_date: "2026-06-01", total_amount: 4200, location_id: "L", channel_id: "C" });
  });
});

describe("createMovement signs + recalculates", () => {
  it("posts a withdrawal as negative cash and recalcs the account", async () => {
    await recordWithdrawal("A", 500, "2026-06-01", "rent money");
    const mv = mock.captured.find((c) => c.table === "money_movements");
    expect(mv?.payload).toMatchObject({ movement_type: "personal_withdrawal", amount: -500, account_id: "A" });
    expect(recalcMoneyAccount).toHaveBeenCalledWith("A");
  });
  it("posts an owner injection as positive cash", async () => {
    await createMovement({ accountId: "A", type: "owner_injection", amount: 1000, date: "2026-06-01", notes: null });
    const mv = mock.captured.find((c) => c.table === "money_movements");
    expect(mv?.payload.amount).toBe(1000);
  });
});
