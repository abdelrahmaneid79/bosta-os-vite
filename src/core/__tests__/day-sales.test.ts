import { describe, it, expect } from "vitest";
import {
  canonCode, buildCodeIndex, analyzeLine, analyzeDayReport, lineConfidence,
  decideDayAction, actionCanSave, marketCodeFromBarcode,
  type CodedProduct, type RawDayLine, type RawDayReport,
} from "@/core/import/day-sales";

const products: CodedProduct[] = [
  { id: "p-cashew", nameEn: "Roasted cashew", nameAr: "كاجو محمص", posCode: "00021296", marketCode: "1626" },
  { id: "p-fool", nameEn: "Aswan fava", nameAr: "فول اسوانى", posCode: "00021749", marketCode: "1669" },
  { id: "p-uncoded", nameEn: "No code", nameAr: "بدون كود", posCode: null, marketCode: null },
];
const index = buildCodeIndex(products);

describe("canonCode folds leading zeros / non-digits", () => {
  it("normalizes zero-padded and bare codes to the same key", () => {
    expect(canonCode("00021296")).toBe("21296");
    expect(canonCode("21296")).toBe("21296");
    expect(canonCode("0021296")).toBe("21296");
  });
  it("empty / all-zero / junk → empty", () => {
    expect(canonCode("")).toBe("");
    expect(canonCode("0000")).toBe("");
    expect(canonCode(null)).toBe("");
  });
});

describe("buildCodeIndex skips uncoded products", () => {
  it("indexes coded products under namespaced pos + market keys", () => {
    expect(index.size).toBe(4); // 2 coded products × (pos key + market key)
    expect(index.get("p:21296")?.id).toBe("p-cashew");
    expect(index.get("m:1626")?.id).toBe("p-cashew");
  });
});

const line = (o: Partial<RawDayLine>): RawDayLine => ({
  item_code: "00021296", barcode: "2301626000008", name_ar: "كاجو محمص", avg_unit_price: 1100, qty_sold: 0.11,
  qty_returned: 0, net_qty: 0.11, net_value: 121, ...o,
});

describe("marketCodeFromBarcode — 230(XXXX) slice, programmatic", () => {
  it("slices the 4 digits after the 230 prefix", () => {
    expect(marketCodeFromBarcode("2301606000004")).toBe("1606");
    expect(marketCodeFromBarcode("2301718000008")).toBe("1718");
  });
  it("returns null for a barcode that doesn't fit the pattern", () => {
    expect(marketCodeFromBarcode("")).toBeNull();
    expect(marketCodeFromBarcode(null)).toBeNull();
    expect(marketCodeFromBarcode("12345")).toBeNull();
  });
});

describe("analyzeLine — code match + arithmetic", () => {
  it("matches a padded code even when read bare, clean line has no issues", () => {
    const a = analyzeLine(line({ item_code: "21296" }), index);
    expect(a.productId).toBe("p-cashew");
    expect(a.productMarketCode).toBe("1626"); // matched product's owner-facing code
    expect(a.issues).toEqual([]);
  });
  it("flags net qty ≠ sold − returned", () => {
    const a = analyzeLine(line({ qty_sold: 1, qty_returned: 0.2, net_qty: 0.9 }), index);
    expect(a.issues).toContain("net qty ≠ sold − returned");
  });
  it("subtracts a non-zero return correctly (no issue)", () => {
    const a = analyzeLine(line({ qty_sold: 1, qty_returned: 0.2, net_qty: 0.8, avg_unit_price: 100, net_value: 80 }), index);
    expect(a.issues).toEqual([]);
  });
  it("flags value ≠ qty × price", () => {
    const a = analyzeLine(line({ net_value: 999 }), index);
    expect(a.issues).toContain("value ≠ qty × price");
  });
  it("infers a missing net_value and marks it", () => {
    const a = analyzeLine(line({ net_value: null }), index);
    expect(a.netValue).toBe(121);
    expect(a.inferred).toBe(true);
    expect(a.issues).toContain("value inferred from qty × price");
  });
  it("unmatched code is surfaced, never matched", () => {
    const a = analyzeLine(line({ item_code: "00099999", barcode: "" }), index);
    expect(a.productId).toBeNull();
    expect(a.issues).toContain("code not matched");
  });
  it("falls back to the barcode's market code when the item code misreads", () => {
    // item code misread (00021751) but barcode reads clean (→ market 1626 = cashew)
    const a = analyzeLine(line({ item_code: "00021751", barcode: "2301626000008" }), index);
    expect(a.productId).toBe("p-cashew");
    expect(a.matchedByBarcode).toBe(true);
    expect(a.issues).not.toContain("code not matched");
  });
});

const report = (lines: RawDayLine[], total: number | null, date: string | null = "2024-12-25"): RawDayReport => ({
  sale_date: date, branch_total_net: total, line_items: lines,
});

describe("analyzeDayReport — totals + reconciliation", () => {
  const lines = [
    line({ item_code: "00021296", net_qty: 0.11, avg_unit_price: 1100, net_value: 121 }),
    line({ item_code: "00021749", name_ar: "فول اسوانى", qty_sold: 0.6, qty_returned: 0, net_qty: 0.6, avg_unit_price: 220, net_value: 132 }),
  ];
  it("reconciles when Σ net_value ≈ branch total", () => {
    const a = analyzeDayReport(report(lines, 253), index);
    expect(a.readTotal).toBe(253);
    expect(a.totalReconciles).toBe(true);
    expect(a.matchedCount).toBe(2);
    expect(a.issues).toEqual([]);
  });
  it("does NOT reconcile when the total disagrees, and says so", () => {
    const a = analyzeDayReport(report(lines, 300), index);
    expect(a.totalReconciles).toBe(false);
    expect(a.issues.some((i) => i.includes("300"))).toBe(true);
  });
  it("collects unmatched codes for the review queue", () => {
    const a = analyzeDayReport(report([line({ item_code: "00088888", barcode: "", net_value: 50, net_qty: 0.5, avg_unit_price: 100 })], 50), index);
    expect(a.unmatchedCodes).toEqual(["88888"]);
    expect(a.matchedCount).toBe(0);
  });
});

describe("lineConfidence — enum, gated by doc reconciliation", () => {
  const clean = analyzeLine(line({}), index);
  it("verified when matched, reconciled, clean", () => {
    expect(lineConfidence(clean, true)).toBe("verified");
  });
  it("unverified when the doc total failed to reconcile", () => {
    expect(lineConfidence(clean, false)).toBe("unverified");
  });
  it("estimated when a value was inferred", () => {
    expect(lineConfidence(analyzeLine(line({ net_value: null }), index), true)).toBe("estimated");
  });
  it("partially_verified when a matched line has an arithmetic issue", () => {
    expect(lineConfidence(analyzeLine(line({ net_value: 999 }), index), true)).toBe("partially_verified");
  });
  it("unverified when the line has no matched product", () => {
    expect(lineConfidence(analyzeLine(line({ item_code: "00077777", barcode: "" }), index), true)).toBe("unverified");
  });
});

describe("decideDayAction — attach / create / duplicate / block", () => {
  const ok = { readTotal: 253, totalReconciles: true };
  it("attaches when the day exists as a total with no lines", () => {
    const d = decideDayAction(ok, { id: "s1", total: 253, lineCount: 0 });
    expect(d.action).toBe("attach");
    expect(d.totalsMatch).toBe(true);
    expect(actionCanSave(d.action)).toBe(true);
  });
  it("attaches but flags a total mismatch", () => {
    const d = decideDayAction(ok, { id: "s1", total: 900, lineCount: 0 });
    expect(d.action).toBe("attach");
    expect(d.totalsMatch).toBe(false);
  });
  it("proposes create when no day exists", () => {
    expect(decideDayAction(ok, null).action).toBe("create");
  });
  it("blocks a duplicate when the day already has matching lines", () => {
    const d = decideDayAction(ok, { id: "s1", total: 253, lineCount: 5 });
    expect(d.action).toBe("duplicate_block");
    expect(actionCanSave(d.action)).toBe(false);
  });
  it("flags a duplicate when the existing lines' total differs", () => {
    const d = decideDayAction(ok, { id: "s1", total: 400, lineCount: 5 });
    expect(d.action).toBe("duplicate_flag");
    expect(actionCanSave(d.action)).toBe(false);
  });
  it("blocks everything when the doc didn't reconcile", () => {
    const d = decideDayAction({ readTotal: 253, totalReconciles: false }, { id: "s1", total: 253, lineCount: 0 });
    expect(d.action).toBe("blocked_unreconciled");
    expect(actionCanSave(d.action)).toBe(false);
  });
});
