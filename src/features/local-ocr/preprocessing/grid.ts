/**
 * GRID DETECTION (pure) — the POS day report is a ruled table. Naive full-image
 * OCR fails on it (the box-drawing rules get read as characters), so instead we
 * find the table's vertical + horizontal rules by projection profile and OCR
 * each column strip on its own. Operates on a GrayImage; no DOM/Node APIs.
 */
import type { GrayImage, DetectedGrid, GridColumn } from "@/features/local-ocr/types/local-ocr";

const DARK = 128; // gray < DARK counts as ink/rule

/** Convert interleaved RGBA bytes to a single grayscale plane. */
export function rgbaToGray(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    data[i] = (rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114) | 0;
  }
  return { width, height, data };
}

/** Color-aware "ink" plane: the DARKEST channel per pixel. POS screenshots have
 *  chromatic-aliased digits (blue/orange sub-pixel fringing); on those a colored
 *  edge pixel always has one low channel, so min(r,g,b) keeps faint fringed digits
 *  solid where luminance would wash them out. Used by the glyph matcher; grid
 *  detection keeps luminance. */
export function rgbaToInk(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    data[i] = r < g ? (r < b ? r : b) : (g < b ? g : b);
  }
  return { width, height, data };
}

/** Dark-pixel count per column (x) and per row (y). */
function projections(img: GrayImage): { col: Int32Array; row: Int32Array } {
  const { width: W, height: H, data } = img;
  const col = new Int32Array(W);
  const row = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    const base = y * W;
    for (let x = 0; x < W; x++) {
      if (data[base + x] < DARK) { col[x]++; row[y]++; }
    }
  }
  return { col, row };
}

/** A rule = a run of lines whose ink coverage exceeds `frac` of the perpendicular
 *  dimension. Adjacent hits are merged (thick rules / anti-aliasing) and rules
 *  closer than `mergeGap` collapse to their midpoint. */
function findRules(profile: Int32Array, span: number, frac: number, mergeGap: number): number[] {
  const t = span * frac;
  const raw: number[] = [];
  let run: [number, number] | null = null;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] >= t) { if (!run) run = [i, i]; else run[1] = i; }
    else if (run) { raw.push((run[0] + run[1]) >> 1); run = null; }
  }
  if (run) raw.push((run[0] + run[1]) >> 1);
  const merged: number[] = [];
  for (const h of raw) {
    if (merged.length && h - merged[merged.length - 1] < mergeGap) merged[merged.length - 1] = (merged[merged.length - 1] + h) >> 1;
    else merged.push(h);
  }
  return merged;
}

export interface GridOptions {
  vFrac?: number;      // vertical-rule coverage threshold (fraction of height)
  hFrac?: number;      // horizontal-rule coverage threshold (fraction of width)
  minColWidth?: number; // discard columns narrower than this (px)
}

/** Detect the table grid. Columns come from vertical rules; the product band is
 *  the y-range spanned by the horizontal rules (header sits above the first,
 *  totals below the last). Row assignment itself is anchored on the code column
 *  later — the h-rules only bound the band and gauge row pitch. */
export function detectGrid(img: GrayImage, opts: GridOptions = {}): DetectedGrid {
  const { vFrac = 0.5, hFrac = 0.5, minColWidth = 12 } = opts;
  const { col, row } = projections(img);
  const vRules = findRules(col, img.height, vFrac, 10);
  const hRules = findRules(row, img.width, hFrac, 6);

  const columns: GridColumn[] = [];
  for (let i = 0; i < vRules.length - 1; i++) {
    const x0 = vRules[i], x1 = vRules[i + 1];
    if (x1 - x0 >= minColWidth) columns.push({ x0, x1, width: x1 - x0 });
  }
  const productBand = hRules.length >= 2
    ? { top: hRules[0], bottom: hRules[hRules.length - 1] }
    : { top: 0, bottom: img.height };
  return { columns, hRules, productBand };
}
