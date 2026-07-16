/**
 * EXTRACTION ORCHESTRATOR (core, environment-agnostic).
 * -----------------------------------------------------
 * Turns a grayscale day-report image + an injected per-region OCR function into
 * a structured ExtractedReport. Strategy proven on the real fixtures:
 *   1. detect the table grid (columns);
 *   2. anchor on the NAME column (widest) and CODE column (rightmost);
 *   3. OCR the code column → its lines ARE the product rows (row anchors);
 *   4. OCR each other column strip and snap its lines to the nearest row anchor;
 *   5. parse every cell deterministically; never invent a missing value.
 * The heavy image work (crop/upscale/worker) lives in the injected `ocr` fn, so
 * this module is pure logic and unit-testable with a fake OCR function.
 */
import type {
  GrayImage, OcrRegionFn, OcrCellLine, ExtractedReport, ExtractedRow, ExtractedField, BBox, PixelRect,
} from "@/features/local-ocr/types/local-ocr";
import { detectGrid } from "@/features/local-ocr/preprocessing/grid";
import { widestColumnIndex, assignRoles, chooseTemplate, type ColRole, type RoleMap } from "@/features/local-ocr/templates/day-report-templates";
import { parseCode, parseMoney, parseQuantity, parseHeaderDate } from "@/features/local-ocr/parsing/normalize";
import { reconcileLine } from "@/features/local-ocr/validation/reconcile-line";
import { recoverNetValueDecimals } from "@/features/local-ocr/validation/recover-decimals";
import { otsuThreshold } from "@/features/local-ocr/preprocessing/binarize";
import { harvestTemplates, readNumericCell, placeDecimal } from "@/features/local-ocr/glyph/matcher";

const INSET = 3; // px inset so a column strip excludes its bounding rules

function field<T>(rawText: string, value: T | null, conf: number, bbox: BBox | null, warnings: string[] = []): ExtractedField<T> {
  const status = value == null ? "unresolved" : warnings.length ? "warning" : "accepted";
  return { rawText, normalizedValue: value, confidence: Math.max(0, Math.min(1, conf)), sourceBoundingBoxes: bbox ? [bbox] : [], status, warnings };
}
const emptyField = <T,>(): ExtractedField<T> => field<T>("", null, 0, null);

/** Median of consecutive gaps → the row pitch. */
function rowPitch(anchors: number[]): number {
  if (anchors.length < 2) return 20;
  const gaps = anchors.slice(1).map((y, i) => y - anchors[i]).sort((a, b) => a - b);
  return gaps[gaps.length >> 1] || 20;
}

/** Snap a column's OCR lines to row anchors by nearest y within tolerance. */
function byRow(lines: OcrCellLine[], anchors: number[], tol: number): (OcrCellLine | null)[] {
  return anchors.map((ay) => {
    let best: OcrCellLine | null = null, bestD = tol;
    for (const l of lines) { const d = Math.abs(l.yMid - ay); if (d < bestD) { bestD = d; best = l; } }
    return best;
  });
}

export interface ExtractOptions { now?: () => number; onStage?: (stage: string) => void; ink?: GrayImage }

export async function extractReport(img: GrayImage, ocr: OcrRegionFn, opts: ExtractOptions = {}): Promise<ExtractedReport> {
  const clock = opts.now ?? (() => 0);
  const stage = opts.onStage ?? (() => {});
  const t0 = clock();
  stage("Finding receipt");
  const grid = detectGrid(img);
  const warnings: string[] = [];
  const meta = { imageWidth: img.width, imageHeight: img.height, columnsDetected: grid.columns.length, variant: "unknown" as ExtractedReport["receiptType"], durationMs: 0 };

  if (grid.columns.length < 4) {
    return { receiptType: "unknown", date: emptyField(), branchTotalNet: emptyField(), rows: [], warnings: ["This layout is not recognized yet — too few table columns were found."], meta };
  }

  const nameIdx = widestColumnIndex(grid.columns);
  const codeIdx = grid.columns.length - 1;
  const hasBarcode = codeIdx - nameIdx >= 2;
  const template = chooseTemplate(hasBarcode);
  meta.variant = template.id;
  const roles = assignRoles(template, nameIdx, codeIdx);

  const colRect = (idx: number, top: number, bottom: number): PixelRect => ({
    left: grid.columns[idx].x0 + INSET,
    top,
    width: Math.max(1, grid.columns[idx].width - INSET * 2),
    height: Math.max(1, bottom - top),
  });

  // 1) CODE column over the FULL height → row anchors. The code column is the
  //    primary key and reads cleanly; its code-shaped lines ARE the product rows
  //    and self-define the product band (grid rules include header/border lines
  //    that must not bound it). Header/footer are then derived from the anchors.
  stage("Reading text locally");
  const codeLinesAll = await ocr(colRect(codeIdx, 0, img.height), { digits: true });
  const codeLines = codeLinesAll
    .filter((l) => { const n = parseCode(l.text).length; return n >= 6 && n <= 10; })
    .sort((a, b) => a.yMid - b.yMid);
  const anchors = codeLines.map((l) => l.yMid);
  if (anchors.length < 2) {
    return { receiptType: template.id, date: emptyField(), branchTotalNet: emptyField(), rows: [], warnings: ["No product codes could be read — check the photo is straight and sharp."], meta };
  }
  const pitch = rowPitch(anchors);
  const tol = pitch * 0.6;
  const band = { top: Math.max(0, anchors[0] - pitch), bottom: Math.min(img.height, anchors[anchors.length - 1] + pitch) };

  // 2) Read the mapped columns. Text columns (code, barcode, name) via Tesseract,
  //    which reads long/distinctive strings and Arabic well. The fractional
  //    NUMERIC columns are read by the glyph MATCHER directly off the grayscale
  //    image — Tesseract can't reliably read the ~4px digits, but they're a fixed
  //    font, so per-image templates harvested from the code column match them.
  //    Any cell the matcher isn't confident about falls back to a Tesseract strip.
  stage("Reconstructing rows");
  // The glyph matcher reads from the color-aware "ink" plane (min channel) when
  // provided — POS screenshots chromatically alias the digits, and luminance
  // washes out fringed strokes. Grid detection above stays on luminance.
  const inkImg = opts.ink ?? img;
  const T = otsuThreshold(inkImg);
  const codeCol = grid.columns[codeIdx];
  const cellHalf = Math.max(6, Math.round(pitch * 0.48)); // uniform row band (see numeric loop)
  const tpl = harvestTemplates(inkImg, T, codeLines.map((l) => ({ code: parseCode(l.text), col: codeCol, top: Math.round(l.yMid - cellHalf), bot: Math.round(l.yMid + cellHalf) })));

  const perRole: Partial<Record<ColRole, (OcrCellLine | null)[]>> = { code: codeLines };
  for (const role of ["barcode", "name"] as ColRole[]) {
    const idx = roles[role as keyof RoleMap];
    if (idx == null) { perRole[role] = anchors.map(() => null); continue; }
    const lines = await ocr(colRect(idx, Math.max(0, band.top - 4), Math.min(img.height, band.bottom + 4)), { digits: false, lang: role === "name" ? "ara" : "eng" });
    perRole[role] = byRow(lines, anchors, tol);
  }

  // Fixed decimal precision by column type: money columns are 2dp, weights 3dp.
  // The glyph matcher reads digit SEQUENCES reliably; the point is placed here
  // rather than segmented (a ~4px decimal dot merges with a digit). Applied to
  // the Tesseract fallback too, so both sources agree on the decimal.
  const PRECISION: Partial<Record<ColRole, number>> = { unitPrice: 2, salesValue: 2, netValue: 2, qtySold: 3, returnQty: 3, netQty: 3 };
  for (const role of ["unitPrice", "qtySold", "returnQty", "netQty", "netValue"] as ColRole[]) {
    const idx = roles[role as keyof RoleMap];
    if (idx == null) { perRole[role] = anchors.map(() => null); continue; }
    const col = grid.columns[idx];
    const dp = PRECISION[role] ?? 2;
    // UNIFORM band per row (cellHalf) so no row clips a digit — per-code-bbox bands
    // vary and a clipped last digit becomes a 10× error.
    let fallback: (OcrCellLine | null)[] | null = null; // Tesseract strip, OCR'd once, only if a cell is weak
    const out: (OcrCellLine | null)[] = [];
    for (let i = 0; i < codeLines.length; i++) {
      const cl = codeLines[i];
      const top = Math.round(cl.yMid - cellHalf), bottom = Math.round(cl.yMid + cellHalf);
      const bbox = { x0: col.x0, y0: top, x1: col.x1, y1: bottom };
      const read = readNumericCell(inkImg, T, tpl, col, top, bottom);
      if (read.digits) { out.push({ text: placeDecimal(read.digits, dp), conf: read.confident ? 92 : 55, yMid: cl.yMid, bbox }); continue; }
      // glyph matcher found nothing → Tesseract strip fallback (OCR'd once)
      if (!fallback) fallback = byRow(await ocr(colRect(idx, Math.max(0, band.top - 4), Math.min(img.height, band.bottom + 4)), { digits: true }), anchors, tol);
      const fb = fallback[i];
      const digits = fb ? fb.text.replace(/\D/g, "") : "";
      out.push(digits ? { text: placeDecimal(digits, dp), conf: 45, yMid: cl.yMid, bbox } : null);
    }
    perRole[role] = out;
  }

  // 3) build rows, then arithmetically reconcile the noisy numeric reads
  //    (net_value = net_qty × price) so a mis-read fractional weight is derived
  //    from the two more-reliable terms rather than trusted blindly.
  const cell = (role: ColRole, i: number) => perRole[role]?.[i] ?? null;
  const rows: ExtractedRow[] = anchors.map((ay, i) => {
    const c = (role: ColRole) => cell(role, i);
    const raw = (role: ColRole, parse: (s: string) => number | null): ExtractedField<number> => {
      const l = c(role); if (!l) return emptyField<number>(); return field(l.text, parse(l.text), l.conf / 100, l.bbox);
    };
    const codeL = c("code"), barL = c("barcode"), nameL = c("name");
    const priceF = raw("unitPrice", parseMoney);
    const qtySoldF = raw("qtySold", parseQuantity);
    const retF = raw("returnQty", parseQuantity);
    const netQtyF = raw("netQty", parseQuantity);
    const netValF = raw("netValue", parseMoney);

    // reconcile using net_qty when present, else qty_sold, as the weight term.
    const qtyBase = netQtyF.normalizedValue ?? qtySoldF.normalizedValue;
    const rec = reconcileLine({
      qty: qtyBase, price: priceF.normalizedValue, netValue: netValF.normalizedValue,
      qtyConf: (netQtyF.confidence || qtySoldF.confidence), priceConf: priceF.confidence, valueConf: netValF.confidence,
    });
    const apply = (base: ExtractedField<number>, value: number | null, derived: boolean, extra: string[]): ExtractedField<number> => ({
      ...base, normalizedValue: value, confidence: rec.confidence,
      warnings: [...base.warnings, ...extra],
      status: value == null ? "unresolved" : derived || extra.length || !rec.reconciles ? "warning" : "accepted",
    });
    return {
      itemCode: codeL ? field(codeL.text, parseCode(codeL.text) || null, codeL.conf / 100, codeL.bbox) : emptyField<string>(),
      barcode: barL ? field(barL.text, parseCode(barL.text) || null, barL.conf / 100, barL.bbox) : emptyField<string>(),
      nameAr: nameL ? field(nameL.text, nameL.text.trim() || null, nameL.conf / 100, nameL.bbox) : emptyField<string>(),
      unitPrice: apply(priceF, rec.price, rec.priceDerived, rec.priceDerived ? ["price " + rec.warnings.join("; ")] : []),
      qtySold: qtySoldF,
      qtyReturned: retF,
      netQty: apply(netQtyF, rec.qty, rec.qtyDerived, rec.qtyDerived ? rec.warnings : []),
      netValue: apply(netValF, rec.netValue, rec.valueDerived, rec.valueDerived ? rec.warnings : []),
      rowY: ay,
    };
  });

  // 3b) recover any net_value whose decimal point was dropped (one row reading
  //     ~100× the others would otherwise wreck the document total). Flagged.
  const nvRec = recoverNetValueDecimals(rows.map((r) => r.netValue.normalizedValue));
  rows.forEach((r, i) => {
    const rec = nvRec[i];
    if (rec.scaled) r.netValue = { ...r.netValue, normalizedValue: rec.value, status: "warning", confidence: r.netValue.confidence * 0.8, warnings: [...r.netValue.warnings, `value ${rec.from} → ${rec.value} (recovered lost decimal)`] };
  });

  // 4) header date (everything above the first product row) + branch total
  //    (footer band below the last row, read from the net-value column).
  stage("Checking totals");
  const headerBottom = Math.max(12, Math.round(band.top + pitch * 0.4));
  const headerLines = await ocr({ left: 0, top: 0, width: img.width, height: headerBottom }, { lang: "ara+eng" });
  const headerText = headerLines.map((l) => l.text).join(" ");
  const isoDate = parseHeaderDate(headerText);
  const dateField = field(headerText.slice(0, 120), isoDate, isoDate ? 0.9 : 0, null, isoDate ? [] : ["date not read from header"]);

  const netValIdx = roles.netValue;
  let branchField = emptyField<number>();
  if (netValIdx != null) {
    const footer = await ocr(colRect(netValIdx, band.bottom - 2, Math.min(img.height, band.bottom + Math.round(img.height * 0.12))), { digits: true });
    // the printed اجمالى الفرع sits in the footer; take the largest footer value.
    const vals = footer.map((l) => ({ v: parseMoney(l.text), l })).filter((x) => x.v != null) as { v: number; l: OcrCellLine }[];
    vals.sort((a, b) => b.v - a.v);
    if (vals[0]) branchField = field(vals[0].l.text, vals[0].v, vals[0].l.conf / 100, vals[0].l.bbox);
  }

  meta.durationMs = clock() - t0;
  return { receiptType: template.id, date: dateField, branchTotalNet: branchField, rows, warnings, meta };
}
