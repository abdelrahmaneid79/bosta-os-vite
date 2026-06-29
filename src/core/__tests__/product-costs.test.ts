import { describe, it, expect } from "vitest";
import { detectCostMap, parseCosts, classifyCosts, summarizeCosts } from "@/core/import/product-costs";

describe("detectCostMap", () => {
  it("detects English columns", () => {
    expect(detectCostMap(["barcode", "name", "cost price", "selling price"]))
      .toEqual({ barcode: "barcode", name: "name", cost: "cost price", price: "selling price" });
  });
  it("detects Arabic columns (folded)", () => {
    const m = detectCostMap(["الباركود", "اسم الصنف", "سعر التكلفة", "سعر البيع"]);
    expect(m.barcode).toBe("الباركود");
    expect(m.cost).toBe("سعر التكلفة");
    expect(m.price).toBe("سعر البيع");
  });
});

describe("parseCosts", () => {
  const map = { barcode: "barcode", name: "name", cost: "cost", price: "price" };
  it("parses numbers and flags empty rows", () => {
    const rows = [
      { barcode: "2301608000002", name: "جامى جيلى كاندى وزن", cost: "142.9", price: "275" },
      { barcode: "", name: "", cost: "", price: "" },
    ];
    const out = parseCosts(rows, map);
    expect(out[0]).toMatchObject({ barcode: "2301608000002", cost: 142.9, price: 275, issues: [] });
    expect(out[1].issues).toContain("no product");
  });
});

describe("classifyCosts + summarize", () => {
  const map = { barcode: "barcode", name: "name", cost: "cost", price: "price" };
  const rows = [
    { barcode: "111", name: "A", cost: "10", price: "20" },
    { barcode: "999", name: "Ghost", cost: "5", price: "9" },
    { barcode: "", name: "", cost: "", price: "" },
  ];
  const resolve = (_n: string, b: string) => (b === "111" ? { id: "p1", name: "Product A" } : null);
  it("resolves by barcode, queues unmapped, flags invalid", () => {
    const c = classifyCosts(parseCosts(rows, map), resolve);
    expect(c[0].status).toBe("ready");
    expect(c[0].productId).toBe("p1");
    expect(c[1].status).toBe("unmapped");
    expect(c[2].status).toBe("invalid");
    const s = summarizeCosts(c);
    expect(s).toMatchObject({ ready: 1, unmapped: 1, invalid: 1, withCost: 1, withPrice: 1 });
  });
});
