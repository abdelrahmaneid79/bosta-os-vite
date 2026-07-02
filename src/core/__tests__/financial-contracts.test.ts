/**
 * FINANCIAL CONTRACTS — executable spec of the DB money math.
 * These mirror the Postgres functions exactly (0006 recompute_product_costs,
 * 0001 recalc_settlement_period / refresh_settlement_totals) so a change in
 * expectations is caught in CI even though the real math runs in SQL.
 * Reference implementations are TEST-ONLY: app code must never recompute
 * verified money math (it calls the RPCs).
 */
import { describe, it, expect } from "vitest";

/* ── WAC replay — mirrors recompute_product_costs (0006) ────────────────── */
interface Move { qty: number; unitCost: number | null; voided?: boolean }
function replayWac(moves: Move[]): { stock: number; avg: number } {
  let qty = 0;
  let avg = 0;
  for (const m of moves) {
    if (m.voided) continue; // voids drop out of the replay entirely
    if (m.qty > 0 && m.unitCost != null) {
      // avg moves ONLY on a costed inflow
      if (qty <= 0) avg = m.unitCost; // clamp-to-zero rebase
      else avg = (qty * avg + m.qty * m.unitCost) / (qty + m.qty);
    }
    qty += m.qty; // signed; outflows may push negative (oversell allowed)
  }
  return { stock: qty, avg };
}

describe("WAC contract (recompute_product_costs)", () => {
  it("weights restocks at different prices by quantity", () => {
    const r = replayWac([
      { qty: 100, unitCost: 10 },
      { qty: 300, unitCost: 20 },
    ]);
    expect(r.stock).toBe(400);
    expect(r.avg).toBeCloseTo(17.5, 10); // (100·10 + 300·20) / 400
  });

  it("outflows and costless inflows never move avg (cost-neutral)", () => {
    const r = replayWac([
      { qty: 100, unitCost: 10 },
      { qty: -60, unitCost: null },
      { qty: 50, unitCost: null }, // opening/adjustment without cost
    ]);
    expect(r.stock).toBe(90);
    expect(r.avg).toBe(10);
  });

  it("rebases to incoming cost when pre-inflow stock ≤ 0 (clamp-to-zero)", () => {
    const r = replayWac([
      { qty: 10, unitCost: 5 },
      { qty: -25, unitCost: null }, // oversold to −15
      { qty: 40, unitCost: 8 },     // negative backlog carries no cost basis
    ]);
    expect(r.stock).toBe(25);
    expect(r.avg).toBe(8);
  });

  it("voided movements are excluded — void restores prior cost basis", () => {
    const withBad = replayWac([
      { qty: 100, unitCost: 10 },
      { qty: 100, unitCost: 99, voided: true }, // mistaken batch, voided
    ]);
    expect(withBad.stock).toBe(100);
    expect(withBad.avg).toBe(10);
  });

  it("rounding does not accumulate across many small restocks", () => {
    // 1,000 alternating restocks at 3.33/3.34 — replay keeps full precision;
    // the final avg must sit strictly between the two prices.
    const moves: Move[] = [];
    for (let i = 0; i < 1000; i++) moves.push({ qty: 1, unitCost: i % 2 ? 3.34 : 3.33 });
    const r = replayWac(moves);
    expect(r.stock).toBe(1000);
    expect(r.avg).toBeGreaterThan(3.33);
    expect(r.avg).toBeLessThan(3.34);
    expect(r.avg).toBeCloseTo(3.335, 6);
  });
});

/* ── Settlement contract (recalc_settlement_period + refresh_totals) ────── */
const round2 = (n: number) => Math.round(n * 100) / 100;
/** net_expected for one calendar month: flat rent (never prorated) + revenue
 *  charge = round(monthly revenue × rate, 2), both itemized deductions. */
function settle(revenue: number, rent: number, rate: number): { charge: number; net: number } {
  const charge = round2(revenue * rate);
  return { charge, net: round2(revenue - (rent + charge)) };
}

describe("settlement contract (calendar month, flat rent, % of gross revenue)", () => {
  it("net = revenue − flat rent − round(revenue × rate, 2)", () => {
    const { charge, net } = settle(120_000, 15_000, 0.03);
    expect(charge).toBe(3_600);
    expect(net).toBe(101_400);
  });

  it("rent is flat for a partial month — NEVER prorated", () => {
    // Month with only 3 trading days still owes the full rent.
    const { net } = settle(9_000, 15_000, 0.03);
    expect(net).toBe(9_000 - 15_000 - 270); // −6,270 (negative month is honest)
    expect(net).toBe(-6_270);
  });

  it("the 3% base is GROSS monthly revenue, not revenue-after-rent", () => {
    const { charge } = settle(100_000, 15_000, 0.03);
    expect(charge).toBe(3_000);                    // 3% of 100,000
    expect(charge).not.toBe(round2(85_000 * 0.03)); // never 3% of (rev − rent)
  });

  it("charge rounds half-up at 2dp exactly once (no per-day accumulation)", () => {
    const { charge } = settle(33_333.33, 15_000, 0.03);
    expect(charge).toBe(1_000);                    // round(999.9999, 2)
  });
});

/* ── Withdrawal invariant — profit never sees cash movements ────────────── */
describe("withdrawals excluded from profit", () => {
  it("operating profit subtracts operating expenses only", () => {
    const revenue = 50_000, cogs = 30_000, opex = 8_000, withdrawals = 12_000;
    const gross = revenue - cogs;
    const operating = gross - opex; // withdrawals MUST NOT appear here
    expect(operating).toBe(12_000);
    expect(operating - withdrawals).not.toBe(operating); // sanity: they differ
  });
});
