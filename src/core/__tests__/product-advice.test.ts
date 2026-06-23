import { describe, it, expect } from "vitest";
import { recommendProductAction, type ProductSignals } from "@/core/products/advice";

const base: ProductSignals = { onHand: 100, isNegative: false, hasCost: true, daysCover: 30, lifetimeRank: 25, lifetimeCount: 59, active: true };

describe("recommendProductAction (priority order)", () => {
  it("negative stock is critical first", () => {
    expect(recommendProductAction({ ...base, isNegative: true, onHand: -5 }).tone).toBe("critical");
  });
  it("stock without cost warns to add a purchase", () => {
    expect(recommendProductAction({ ...base, hasCost: false }).title).toMatch(/cost/i);
  });
  it("out of stock (active) → restock warning", () => {
    const r = recommendProductAction({ ...base, onHand: 0 });
    expect(r.tone).toBe("warn");
    expect(r.title).toMatch(/restock/i);
  });
  it("low days of cover → restock soon", () => {
    expect(recommendProductAction({ ...base, daysCover: 3 }).title).toMatch(/low cover/i);
  });
  it("top-10 lifetime rank → star", () => {
    const r = recommendProductAction({ ...base, lifetimeRank: 3 });
    expect(r.tone).toBe("good");
    expect(r.title).toMatch(/top seller/i);
  });
  it("bottom of a large catalog → slow mover", () => {
    const r = recommendProductAction({ ...base, lifetimeRank: 55, lifetimeCount: 59 });
    expect(r.title).toMatch(/slow mover/i);
  });
  it("otherwise healthy", () => {
    expect(recommendProductAction(base).title).toBe("Healthy");
  });
});
