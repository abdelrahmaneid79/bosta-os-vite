import { describe, it, expect } from "vitest";
import { detectLineMap, parseProductLines, dedupeLines, classifyLines, summarize, type Resolver } from "@/core/import/product-lines";
import type { Row } from "@/core/import/csv";

describe("detectLineMap", () => {
  it("detects English + Arabic headers", () => {
    const m = detectLineMap(["Date", "Item Name", "Quantity", "Unit Price", "Line Total"]);
    expect(m).toEqual({ date: "Date", product: "Item Name", qty: "Quantity", unitPrice: "Unit Price", lineTotal: "Line Total" });
    const ar = detectLineMap(["التاريخ", "الصنف", "الكمية", "السعر", "القيمة"]);
    expect(ar.product).toBe("الصنف");
    expect(ar.qty).toBe("الكمية");
  });
});

const map = { date: "d", product: "p", qty: "q", unitPrice: "u", lineTotal: "t" };

describe("parseProductLines", () => {
  it("parses + flags issues, computes total from qty×price when missing", () => {
    const rows: Row[] = [
      { d: "2026/03/01", p: "كاجو محمص", q: "3", u: "100", t: "" },
      { d: "", p: "", q: "0", u: "", t: "" },
    ];
    const out = parseProductLines(rows, map);
    expect(out[0]).toMatchObject({ date: "2026-03-01", rawName: "كاجو محمص", qty: 3, lineTotal: 300, issues: [] });
    expect(out[1].issues).toEqual(expect.arrayContaining(["no date", "no product", "no quantity", "no amount"]));
  });
});

describe("dedupeLines", () => {
  it("drops exact duplicate rows", () => {
    const base = { date: "2026-03-01", rawName: "A", qty: 1, unitPrice: 10, lineTotal: 10, issues: [] };
    const { kept, dropped } = dedupeLines([base, { ...base }, { ...base, qty: 2 }]);
    expect(kept).toHaveLength(2);
    expect(dropped).toBe(1);
  });
});

describe("classifyLines + summarize", () => {
  const resolve: Resolver = (name) => (name === "cashew" ? { id: "p1", name: "Roasted cashew" } : null);
  it("classifies ready / unmapped / invalid", () => {
    const lines = [
      { date: "2026-03-01", rawName: "cashew", qty: 1, unitPrice: 10, lineTotal: 10, issues: [] },
      { date: "2026-03-01", rawName: "mystery", qty: 1, unitPrice: 10, lineTotal: 10, issues: [] },
      { date: null, rawName: "", qty: null, unitPrice: null, lineTotal: null, issues: ["no date"] },
    ];
    const c = classifyLines(lines, resolve);
    expect(c[0].status).toBe("ready");
    expect(c[0].productId).toBe("p1");
    expect(c[1].status).toBe("unmapped");
    expect(c[2].status).toBe("invalid");
    expect(summarize(c)).toEqual({ ready: 1, unmapped: 1, invalid: 1, days: 1 });
  });
});
