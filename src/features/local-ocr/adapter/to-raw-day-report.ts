/**
 * ADAPTER — ExtractedReport (local OCR) → RawDayReport (the exact shape the
 * existing pure pipeline in core/import/day-sales already validates, matches and
 * reconciles). This is the seam that lets the local engine drop in behind the
 * current importer without touching its review/approve/save code.
 */
import type { ExtractedReport, ExtractedRow } from "@/features/local-ocr/types/local-ocr";
import type { RawDayReport, RawDayLine } from "@/core/import/day-sales";

const num = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function toLine(r: ExtractedRow): RawDayLine {
  return {
    item_code: r.itemCode.normalizedValue ?? "",
    barcode: r.barcode.normalizedValue ?? "",
    name_ar: r.nameAr.normalizedValue ?? "",
    avg_unit_price: num(r.unitPrice.normalizedValue),
    qty_sold: num(r.qtySold.normalizedValue),
    qty_returned: num(r.qtyReturned.normalizedValue) ?? 0,
    net_qty: num(r.netQty.normalizedValue),
    net_value: num(r.netValue.normalizedValue),
  };
}

/** Keep rows that carry at least one identifier or a value — blank grid rows are
 *  dropped, but nothing with data is silently discarded (the pipeline surfaces
 *  unmatched codes for review). */
function rowHasSignal(r: ExtractedRow): boolean {
  return !!(r.itemCode.normalizedValue || r.barcode.normalizedValue || r.netValue.normalizedValue != null || r.netQty.normalizedValue != null);
}

/** The rows that survive into the report (blank grid rows dropped). */
export function signalRows(ex: ExtractedReport): ExtractedRow[] {
  return ex.rows.filter(rowHasSignal);
}

export function toRawDayReport(ex: ExtractedReport): RawDayReport {
  return {
    sale_date: ex.date.normalizedValue,
    branch_total_net: num(ex.branchTotalNet.normalizedValue),
    line_items: signalRows(ex).map(toLine),
  };
}

/** Combined per-line confidence (0..1) and the warnings a reviewer should see. */
export function lineProvenance(r: ExtractedRow): { confidence: number; warnings: string[] } {
  const fields = [r.itemCode, r.netQty, r.unitPrice, r.netValue];
  const confidence = fields.reduce((m, f) => Math.min(m, f.confidence || 0), 1);
  const warnings = [...new Set([r.itemCode, r.nameAr, r.unitPrice, r.qtySold, r.netQty, r.netValue].flatMap((f) => f.warnings))];
  return { confidence, warnings };
}
