import { describe, it, expect } from "vitest";
import { foldDigits, inferRoles, parseOcrProductLines } from "@/core/import/ocr-lines";

describe("foldDigits", () => {
  it("folds Arabic-Indic digits to ASCII", () => {
    expect(foldDigits("١٢٣٤٥")).toBe("12345");
    expect(foldDigits("سعر ٦٢٥٫٥")).toBe("سعر 625٫5");
  });
});

describe("inferRoles", () => {
  it("recovers total from price × qty regardless of order", () => {
    expect(inferRoles([625, 2.5, 1562.5])).toEqual({ qty: 2.5, unitPrice: 625, lineTotal: 1562.5 });
    // total first, then qty, then price
    expect(inferRoles([1562.5, 2.5, 625])).toEqual({ qty: 2.5, unitPrice: 625, lineTotal: 1562.5 });
  });
  it("tolerates rounding in the printed total", () => {
    const r = inferRoles([142.9, 1.115, 159.33]); // 142.9*1.115 = 159.33...
    expect(r.lineTotal).toBe(159.33);
    expect(r.unitPrice).toBe(142.9);
    expect(r.qty).toBe(1.115);
  });
  it("handles a two-number row (qty + total) by deriving price", () => {
    expect(inferRoles([3, 1725])).toEqual({ qty: 3, unitPrice: 575, lineTotal: 1725 });
  });
  it("returns just a total for a single number", () => {
    expect(inferRoles([400])).toEqual({ qty: null, unitPrice: null, lineTotal: 400 });
  });
});

describe("parseOcrProductLines", () => {
  const report = [
    "فرع هايبر هاب جاردينيا",
    "الفترة من 2024/12/03 الى 2024/12/03",
    "الصنف         السعر    الكمية    الاجمالي",
    "كاجو محمص      625      2.5       1562.5",
    "لوز محمص       575      1         575",
    "جيلى ساور      143.3    3         429.9",
    "الاجمالي                          2567.4",
    "تاريخ الطباعة 2024/12/04 09:15",
  ].join("\n");

  it("reads the day, the product lines and the grand total", () => {
    const out = parseOcrProductLines(report);
    expect(out.date).toBe("2024-12-03");
    expect(out.dayTotal).toBe(2567.4);
    expect(out.lines).toHaveLength(3);
    expect(out.lines[0]).toMatchObject({ rawName: "كاجو محمص", qty: 2.5, unitPrice: 625, lineTotal: 1562.5 });
    expect(out.lines[1]).toMatchObject({ rawName: "لوز محمص", lineTotal: 575 });
  });

  it("does not turn header/metadata rows into products", () => {
    const out = parseOcrProductLines(report);
    expect(out.lines.every((l) => l.rawName && !l.rawName.includes("الفترة"))).toBe(true);
    expect(out.lines.every((l) => !/طباعة/.test(l.rawName))).toBe(true);
  });

  it("falls back to the sum of lines when no total row is present", () => {
    const noTotal = ["كاجو محمص 625 2 1250", "لوز محمص 575 1 575"].join("\n");
    const out = parseOcrProductLines(noTotal);
    expect(out.dayTotal).toBe(1825);
  });
});
