import { describe, it, expect } from "vitest";
import { detectLineMap, parseSheet, parseProductLines, dedupeLines, classifyLines, summarize, type Resolver, type ProductLineMap } from "@/core/import/product-lines";
import type { Row } from "@/core/import/csv";

describe("detectLineMap", () => {
  it("detects English headers incl. barcode", () => {
    const m = detectLineMap(["Date", "Barcode", "Item Name", "Quantity", "Unit Price", "Line Total"]);
    expect(m).toMatchObject({ date: "Date", barcode: "Barcode", product: "Item Name", qty: "Quantity", unitPrice: "Unit Price", lineTotal: "Line Total" });
  });
  it("detects the real Arabic POS columns (net qty/value, avg price, barcode)", () => {
    const m = detectLineMap(["كود الصنف", "الباركود", "اسم الصنف", "متوسط سعر البيع", "الكمية المباعة", "المبيعات", "صافى الكمية", "صافى القيمة"]);
    expect(m.barcode).toBe("الباركود");
    expect(m.product).toBe("اسم الصنف");
    expect(m.unitPrice).toBe("متوسط سعر البيع");
    expect(m.qty).toBe("صافى الكمية");      // net preferred over المباعة
    expect(m.lineTotal).toBe("صافى القيمة"); // net value preferred over المبيعات
  });
});

describe("parseSheet (finds header under POS metadata + sniffs the day)", () => {
  const grid: unknown[][] = [
    ["تيسكو مارت", "", "", ""],
    ["الفرع : جاردينيا مول", "خلال الفترة من 2024/12/03 الى 2024/12/03", "", ""],
    ["تاريخ الطباعة 2024/12/04 16:13", "", "", ""],
    ["الباركود", "اسم الصنف", "متوسط سعر البيع", "صافى القيمة"],
    ["2301606000004", "جامى طوفى فواكه وزن", "149.99", "167.24"],
    ["", "اجمالي الفرع", "", "3403.17"],
  ];
  it("locates the header row beneath the metadata", () => {
    const s = parseSheet(grid);
    expect(s.headers).toEqual(["الباركود", "اسم الصنف", "متوسط سعر البيع", "صافى القيمة"]);
    expect(s.rows).toHaveLength(2); // product row + totals row (filtered later)
    expect(s.rows[0]["الباركود"]).toBe("2301606000004");
  });
  it("sniffs the trading day (period), not the print date", () => {
    expect(parseSheet(grid).date).toBe("2024-12-03"); // earliest = period, not 12/04 print
  });
  it("plain CSV with headers on row 0 still works", () => {
    const s = parseSheet([["Barcode", "Item", "Qty", "Total"], ["123", "x", "2", "20"]]);
    expect(s.headers).toEqual(["Barcode", "Item", "Qty", "Total"]);
    expect(s.rows).toHaveLength(1);
  });
});

const map: ProductLineMap = { date: "", barcode: "الباركود", product: "اسم الصنف", qty: "صافى الكمية", unitPrice: "متوسط سعر البيع", lineTotal: "صافى القيمة" };

describe("parseProductLines (POS shape, single-day via fallbackDate)", () => {
  const rows: Row[] = [
    { "الباركود": "2301606000004", "اسم الصنف": "جامى طوفى فواكه وزن", "متوسط سعر البيع": "149.99", "صافى الكمية": "1.115", "صافى القيمة": "167.24" },
    { "الباركود": "", "اسم الصنف": "اجمالي الفرع", "متوسط سعر البيع": "", "صافى الكمية": "", "صافى القيمة": "3403.17" },
  ];
  const out = parseProductLines(rows, map, "2024-12-03");
  it("uses the file's day for every row and reads net value as the line total", () => {
    expect(out[0]).toMatchObject({ date: "2024-12-03", barcode: "2301606000004", qty: 1.115, lineTotal: 167.24, issues: [] });
  });
  it("flags the totals row so it's excluded", () => {
    expect(out[1].issues).toContain("totals row");
  });
});

describe("classifyLines resolves by barcode first, then name; summarize sums day total", () => {
  const resolve: Resolver = (name, barcode) =>
    barcode === "2301606000004" ? { id: "p1", name: "Fruit toffee" } : name === "كاجو محمص" ? { id: "p2", name: "Roasted cashew" } : null;
  const lines = parseProductLines([
    { "الباركود": "2301606000004", "اسم الصنف": "wrong name", "متوسط سعر البيع": "150", "صافى الكمية": "2", "صافى القيمة": "300" },
    { "الباركود": "", "اسم الصنف": "كاجو محمص", "متوسط سعر البيع": "1100", "صافى الكمية": "1", "صافى القيمة": "1100" },
    { "الباركود": "", "اسم الصنف": "mystery", "متوسط سعر البيع": "10", "صافى الكمية": "1", "صافى القيمة": "10" },
  ], map, "2024-12-03");
  const c = classifyLines(lines, resolve);
  it("barcode beats a wrong name", () => { expect(c[0].productId).toBe("p1"); expect(c[0].status).toBe("ready"); });
  it("falls back to name when no barcode", () => { expect(c[1].productId).toBe("p2"); });
  it("queues the unmatched row", () => { expect(c[2].status).toBe("unmapped"); });
  it("summarize totals the ready lines' value", () => {
    const s = summarize(c);
    expect(s).toMatchObject({ ready: 2, unmapped: 1, invalid: 0, days: 1 });
    expect(s.total).toBe(1400); // 300 + 1100
  });
});

describe("dedupeLines", () => {
  it("drops exact duplicates by barcode", () => {
    const base = { date: "2024-12-03", barcode: "1", rawName: "a", qty: 1, unitPrice: 10, lineTotal: 10, issues: [] };
    const { kept, dropped } = dedupeLines([base, { ...base }, { ...base, qty: 2 }]);
    expect(kept).toHaveLength(2); expect(dropped).toBe(1);
  });
});
