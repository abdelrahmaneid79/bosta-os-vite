/**
 * LOCAL OCR — unit tests for the deterministic core (no Tesseract, no DOM).
 * Covers the parsing, arithmetic reconciliation, decimal recovery, grid
 * detection, template role-mapping and the RawDayReport adapter.
 */
import { describe, it, expect } from "vitest";
import {
  toWesternDigits, fixNumericConfusions, parseCode, parseMoney, parseQuantity,
  parseHeaderDate, normaliseDateParts,
} from "@/features/local-ocr/parsing/normalize";
import { reconcileLine } from "@/features/local-ocr/validation/reconcile-line";
import { recoverNetValueDecimals } from "@/features/local-ocr/validation/recover-decimals";
import { checkAgainstCatalog } from "@/features/local-ocr/validation/catalog-check";
import { placeDecimal } from "@/features/local-ocr/glyph/matcher";
import { detectGrid, rgbaToGray } from "@/features/local-ocr/preprocessing/grid";
import {
  assignRoles, widestColumnIndex, chooseTemplate, TEMPLATE_V2024, TEMPLATE_V2025,
} from "@/features/local-ocr/templates/day-report-templates";
import { toRawDayReport, signalRows, lineProvenance } from "@/features/local-ocr/adapter/to-raw-day-report";
import type { ExtractedReport, ExtractedField, ExtractedRow, GrayImage } from "@/features/local-ocr/types/local-ocr";

// ── numeral / text normalisation ────────────────────────────────────────────
describe("Arabic + Western numerals", () => {
  it("converts Arabic-Indic digits to Western", () => {
    expect(toWesternDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(toWesternDigits("۲۰۲٦")).toBe("2026"); // eastern-arabic
    expect(toWesternDigits("abc")).toBe("abc");
  });
  it("fixes numeric letter confusions only where intended", () => {
    expect(fixNumericConfusions("O.5O")).toBe("0.50");
    expect(fixNumericConfusions("l2")).toBe("12");
    expect(fixNumericConfusions("1٫5")).toBe("1.5"); // arabic decimal sep
  });
});

// ── code parsing (leading zeros preserved) ──────────────────────────────────
describe("parseCode", () => {
  it("keeps leading zeros and strips non-digits", () => {
    expect(parseCode("00021044")).toBe("00021044");
    expect(parseCode(" 0002-1045 ")).toBe("00021045");
    expect(parseCode("٠٠٠٢١٢٩٦")).toBe("00021296");
    expect(parseCode("abc")).toBe("");
  });
});

// ── money + quantity ────────────────────────────────────────────────────────
describe("parseMoney / parseQuantity", () => {
  it("parses money with separators, arabic numerals, confusions", () => {
    expect(parseMoney("1,040.33")).toBe(1040.33);
    expect(parseMoney("5688.27")).toBe(5688.27);
    expect(parseMoney("١١٠٫٠٨")).toBeCloseTo(110.08, 2);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("—")).toBeNull();
  });
  it("parses 3-dp weights", () => {
    expect(parseQuantity("0.430")).toBe(0.43);
    expect(parseQuantity("3.575")).toBe(3.575);
  });
});

// ── dates: prefer «من», avoid print date ────────────────────────────────────
describe("parseHeaderDate", () => {
  it("takes the «من» from-date, not the print date", () => {
    const header = "تاريخ الطباعة 2024/11/05 خلال الفترة من 2024/11/01 الى 2024/11/01";
    expect(parseHeaderDate(header)).toBe("2024-11-01");
  });
  it("reads a clean single-day 2025 header", () => {
    expect(parseHeaderDate("خلال الفترة من 2025/09/16 الى 2025/09/16")).toBe("2025-09-16");
  });
  it("handles dd/mm/yyyy and returns null on garbage", () => {
    expect(normaliseDateParts("16", "9", "2025")).toBe("2025-09-16");
    expect(normaliseDateParts("2025", "13", "40")).toBeNull();
    expect(parseHeaderDate("no date here")).toBeNull();
  });
});

// ── arithmetic reconciliation (conservative) ────────────────────────────────
describe("reconcileLine", () => {
  it("keeps consistent reads and marks them reconciled", () => {
    const r = reconcileLine({ qty: 0.43, price: 256, netValue: 110.08, qtyConf: 0.9, priceConf: 0.9, valueConf: 0.9 });
    expect(r.reconciles).toBe(true);
    expect(r.qty).toBe(0.43);
    expect(r.warnings).toHaveLength(0);
  });
  it("derives a MISSING term but never overwrites a present one", () => {
    const missingValue = reconcileLine({ qty: 0.5, price: 200, netValue: null, qtyConf: 0.8, priceConf: 0.8, valueConf: 0 });
    expect(missingValue.netValue).toBe(100);
    expect(missingValue.valueDerived).toBe(true);

    // present-but-inconsistent qty is FLAGGED, not silently changed
    const inconsistent = reconcileLine({ qty: 99, price: 256, netValue: 110.08, qtyConf: 0.5, priceConf: 0.9, valueConf: 0.9 });
    expect(inconsistent.qty).toBe(99);           // untouched
    expect(inconsistent.reconciles).toBe(false);
    expect(inconsistent.warnings.some((w) => /review/.test(w))).toBe(true);
    expect(inconsistent.confidence).toBeLessThan(0.6);
  });
  it("derives qty from value ÷ price when qty is missing", () => {
    const r = reconcileLine({ qty: null, price: 291, netValue: 1040.33, qtyConf: 0, priceConf: 0.9, valueConf: 0.9 });
    expect(r.qty).toBeCloseTo(3.575, 3);
    expect(r.qtyDerived).toBe(true);
  });
});

// ── decimal-magnitude recovery ──────────────────────────────────────────────
describe("recoverNetValueDecimals", () => {
  it("rescales a lost-decimal outlier to the row magnitude and flags it", () => {
    const vals = [110.08, 53.82, 11008, 157.2, 91.76]; // 11008 lost its point
    const out = recoverNetValueDecimals(vals);
    expect(out[2].scaled).toBe(true);
    expect(out[2].value).toBeCloseTo(110.08, 2);
    expect(out[0].scaled).toBe(false);
  });
  it("leaves a normal row untouched", () => {
    const out = recoverNetValueDecimals([100, 120, 90, 110]);
    expect(out.every((o) => !o.scaled)).toBe(true);
  });
});

// ── glyph matcher: fixed-precision decimal placement ────────────────────────
describe("placeDecimal", () => {
  it("places money (2dp) and weight (3dp) points by column precision", () => {
    expect(placeDecimal("11008", 2)).toBe("110.08");
    expect(placeDecimal("25600", 2)).toBe("256.00");
    expect(placeDecimal("430", 3)).toBe("0.430");
    expect(placeDecimal("3575", 3)).toBe("3.575");
    expect(placeDecimal("200", 2)).toBe("2.00");
    expect(placeDecimal("", 2)).toBe("");
  });
});

// ── catalog integrity (protects inventory + COGS) ───────────────────────────
describe("checkAgainstCatalog", () => {
  it("passes a line whose implied price matches the catalog", () => {
    const c = checkAgainstCatalog({ qty: 0.43, price: 256, value: 110.08 }, 256);
    expect(c.qtyRisk).toBe(false);
    expect(c.priceOff).toBe(false);
  });
  it("flags a mis-read weight (implied price far from catalog) and suggests the fix", () => {
    // true 0.43 × 256 = 110.08; a bad qty of 4.3 implies 25.6/unit vs 256 catalog
    const c = checkAgainstCatalog({ qty: 4.3, price: 256, value: 110.08 }, 256);
    expect(c.qtyRisk).toBe(true);
    expect(c.suggestedQty).toBeCloseTo(0.43, 2); // value ÷ catalog price
    expect(c.warnings.some((w) => /stock/.test(w))).toBe(true);
  });
  it("suggests the catalog price when the OCR price is missing", () => {
    const c = checkAgainstCatalog({ qty: 0.43, price: null, value: 110.08 }, 256);
    expect(c.suggestedPrice).toBe(256);
  });
  it("no-ops when the product has no catalog price", () => {
    const c = checkAgainstCatalog({ qty: 0.43, price: 256, value: 110.08 }, null);
    expect(c.qtyRisk).toBe(false);
    expect(c.suggestedQty).toBeNull();
  });
});

// ── grid detection on a synthetic ruled table ───────────────────────────────
describe("detectGrid", () => {
  it("finds columns from vertical rules", () => {
    const W = 120, H = 60;
    const rgba = new Uint8Array(W * H * 4).fill(255); // white
    const paintCol = (x: number) => { for (let y = 0; y < H; y++) { const i = (y * W + x) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = 0; } };
    const paintRow = (y: number) => { for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = 0; } };
    [10, 50, 90].forEach(paintCol); // 3 vertical rules → 2 columns
    [5, 25, 45].forEach(paintRow);
    const gray: GrayImage = rgbaToGray(rgba, W, H);
    const grid = detectGrid(gray, { vFrac: 0.5, hFrac: 0.5, minColWidth: 10 });
    expect(grid.columns.length).toBe(2);
    expect(grid.columns[0].x0).toBeGreaterThanOrEqual(9);
    expect(grid.columns[0].x1).toBeLessThanOrEqual(51);
  });
});

// ── template role mapping ───────────────────────────────────────────────────
describe("templates", () => {
  const cols = (widths: number[]) => { let x = 0; return widths.map((w) => { const c = { x0: x, x1: x + w, width: w }; x += w; return c; }); };
  it("v2025: anchors on name (widest) + code (rightmost)", () => {
    const c = cols([60, 50, 55, 60, 55, 55, 55, 200, 120, 65]); // name idx7 widest, code idx9
    expect(widestColumnIndex(c)).toBe(7);
    const t = chooseTemplate(true);
    expect(t).toBe(TEMPLATE_V2025);
    const roles = assignRoles(t, 7, 9);
    expect(roles.code).toBe(9);
    expect(roles.barcode).toBe(8);
    expect(roles.name).toBe(7);
    expect(roles.unitPrice).toBe(6);
    expect(roles.netValue).toBe(0);
  });
  it("v2024: no barcode column", () => {
    const c = cols([60, 55, 50, 60, 55, 55, 55, 55, 200, 65]); // name idx8, code idx9
    expect(widestColumnIndex(c)).toBe(8);
    const t = chooseTemplate(false);
    expect(t).toBe(TEMPLATE_V2024);
    const roles = assignRoles(t, 8, 9);
    expect(roles.code).toBe(9);
    expect(roles.name).toBe(8);
    expect(roles.barcode).toBeUndefined();
    expect(roles.unitPrice).toBe(7);
  });
});

// ── adapter → RawDayReport ──────────────────────────────────────────────────
function f<T>(v: T | null, conf = 0.9, warnings: string[] = []): ExtractedField<T> {
  return { rawText: String(v ?? ""), normalizedValue: v, confidence: conf, sourceBoundingBoxes: [], status: v == null ? "unresolved" : "accepted", warnings };
}
function row(over: Partial<ExtractedRow> = {}): ExtractedRow {
  return {
    itemCode: f("00021044"), barcode: f("2301607000003"), nameAr: f("كاجو"),
    unitPrice: f(256), qtySold: f(0.43), qtyReturned: f(0), netQty: f(0.43), netValue: f(110.08),
    rowY: 0, ...over,
  };
}
describe("adapter", () => {
  const ex: ExtractedReport = {
    receiptType: "bosta_day_report_v2025",
    date: f("2025-09-16"), branchTotalNet: f(5688.27),
    rows: [row(), row({ itemCode: f<string>(null), barcode: f<string>(null), netValue: f<number>(null), netQty: f<number>(null) })],
    warnings: [], meta: { imageWidth: 700, imageHeight: 700, columnsDetected: 10, variant: "bosta_day_report_v2025", durationMs: 100 },
  };
  it("drops blank rows and maps fields to RawDayReport", () => {
    const rep = toRawDayReport(ex);
    expect(rep.sale_date).toBe("2025-09-16");
    expect(rep.branch_total_net).toBe(5688.27);
    expect(rep.line_items).toHaveLength(1);
    expect(rep.line_items[0].item_code).toBe("00021044");
    expect(rep.line_items[0].net_value).toBe(110.08);
    expect(signalRows(ex)).toHaveLength(1);
  });
  it("surfaces per-line confidence + warnings for review", () => {
    const p = lineProvenance(row({ netQty: f(0.43, 0.4, ["reconciled from value ÷ price"]) }));
    expect(p.confidence).toBeCloseTo(0.4, 2);
    expect(p.warnings).toContain("reconciled from value ÷ price");
  });
});
