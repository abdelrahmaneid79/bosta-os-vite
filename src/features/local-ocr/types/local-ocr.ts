/**
 * LOCAL OCR — shared types (environment-agnostic).
 * ------------------------------------------------
 * These types are used by both the browser pipeline (canvas + web worker) and
 * the Node benchmark harness (pngjs + tesseract worker). Nothing here imports a
 * DOM or Node API, so the extraction/parsing core stays pure and unit-testable.
 */

/** Pixel-space rectangle in the ORIGINAL (un-upscaled) image. */
export interface PixelRect { left: number; top: number; width: number; height: number }

/** Tesseract-style bounding box (original image pixels). */
export interface BBox { x0: number; y0: number; x1: number; y1: number }

/** A single grayscale image plane: `data[y*width+x]` = 0 (black) … 255 (white). */
export interface GrayImage { width: number; height: number; data: Uint8Array }

/** One OCR'd text line within a region, mapped back to original-image y. */
export interface OcrCellLine {
  text: string;
  conf: number;      // 0..100 (Tesseract line confidence)
  yMid: number;      // vertical centre in ORIGINAL image pixels
  bbox: BBox;        // in ORIGINAL image pixels
}

/** OCR of a single rectangular region. `digits` restricts the char whitelist to
 *  `0-9.` (numeric/code columns); otherwise the Arabic+English model runs free.
 *  Injected by the environment so the core never touches a worker directly. */
export interface OcrRegionOpts { digits?: boolean; lang?: "ara" | "eng" | "ara+eng"; upscale?: number }
export type OcrRegionFn = (rect: PixelRect, opts?: OcrRegionOpts) => Promise<OcrCellLine[]>;

/** Vertical column band (between two detected rules). */
export interface GridColumn { x0: number; x1: number; width: number }

/** Detected table geometry. */
export interface DetectedGrid {
  columns: GridColumn[];
  hRules: number[];        // y of every horizontal rule
  productBand: { top: number; bottom: number }; // y-range holding product rows
}

/** Per-field provenance — the charter's required shape for every extracted value. */
export type FieldStatus = "accepted" | "warning" | "unresolved";
export interface ExtractedField<T> {
  rawText: string;
  normalizedValue: T | null;
  confidence: number;      // 0..1 combined confidence
  sourceBoundingBoxes: BBox[];
  status: FieldStatus;
  warnings: string[];
}

/** One reconstructed product row before it becomes a RawDayLine. */
export interface ExtractedRow {
  itemCode: ExtractedField<string>;
  barcode: ExtractedField<string>;
  nameAr: ExtractedField<string>;
  unitPrice: ExtractedField<number>;
  qtySold: ExtractedField<number>;
  qtyReturned: ExtractedField<number>;
  netQty: ExtractedField<number>;
  netValue: ExtractedField<number>;
  rowY: number;
}

export type ReceiptType = "bosta_day_report_v2024" | "bosta_day_report_v2025" | "unknown";

/** Whole-document extraction result (pre-adapter). */
export interface ExtractedReport {
  receiptType: ReceiptType;
  date: ExtractedField<string>;          // ISO yyyy-mm-dd
  branchTotalNet: ExtractedField<number>;
  rows: ExtractedRow[];
  warnings: string[];
  meta: {
    imageWidth: number;
    imageHeight: number;
    columnsDetected: number;
    variant: ReceiptType;
    durationMs: number;
  };
}
