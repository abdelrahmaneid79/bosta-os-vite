/**
 * SELF-CALIBRATING DIGIT GLYPH MATCHER (pure, operates on the GrayImage).
 * ----------------------------------------------------------------------
 * Tesseract can't reliably read the ~4px fractional numbers on these screenshots,
 * but they're a FIXED font rendered identically every time — so template matching
 * beats a general OCR model. Two things make it work at this tiny scale:
 *   1. Each numeric cell is BILINEAR-UPSCALED before thresholding. The digits are
 *      anti-aliased, so the grey edge pixels carry real sub-pixel detail; blowing
 *      the cell up first "develops" that into clean pixels, so the gaps between
 *      digits (and the decimal dot) survive instead of collapsing.
 *   2. Templates are harvested from the CODE column (which Tesseract reads well),
 *      labelled by the read code, at the same scale — so matching is scale-exact.
 * No worker calls for numerics — fast + deterministic. The decimal POINT is not
 * segmented (it merges at small sizes); the caller places it by column precision.
 */
import type { GrayImage, GridColumn } from "@/features/local-ocr/types/local-ocr";

const GW = 12, GH = 20;   // normalized glyph box
const SCALE = 3;          // cell upscale factor before thresholding

export interface Glyph { x0: number; x1: number; wide: number; tall: number; vec: Float32Array }
export interface DigitTemplates { proto: Map<string, Float32Array>; medW: number; medH: number; covered: string }

/** Bilinear-upscale a cell region of the gray image and threshold it to a binary
 *  ink mask (1 = ink). Working at SCALE× makes thin strokes/gaps robust. */
function cellMask(g: GrayImage, T: number, x0: number, x1: number, y0: number, y1: number, scale = SCALE): { w: number; h: number; bin: Uint8Array } {
  x0 = Math.max(0, x0); x1 = Math.min(g.width, x1); y0 = Math.max(0, y0); y1 = Math.min(g.height, y1);
  const sw = x1 - x0, sh = y1 - y0;
  if (sw < 1 || sh < 1) return { w: 0, h: 0, bin: new Uint8Array(0) };
  const w = sw * scale, h = sh * scale;
  const bin = new Uint8Array(w * h);
  const at = (x: number, y: number) => g.data[Math.min(g.height - 1, y) * g.width + Math.min(g.width - 1, x)];
  for (let oy = 0; oy < h; oy++) {
    const fy = y0 + oy / scale, iy = Math.floor(fy), ty = fy - iy;
    for (let ox = 0; ox < w; ox++) {
      const fx = x0 + ox / scale, ix = Math.floor(fx), tx = fx - ix;
      const v = at(ix, iy) * (1 - tx) * (1 - ty) + at(ix + 1, iy) * tx * (1 - ty) + at(ix, iy + 1) * (1 - tx) * ty + at(ix + 1, iy + 1) * tx * ty;
      bin[oy * w + ox] = v < T ? 1 : 0;
    }
  }
  return { w, h, bin };
}

/** Build a normalized glyph from an x-range [a,b] of the mask. */
function makeGlyph(w: number, bin: Uint8Array, a: number, b: number, ty0: number, ty1: number): Glyph | null {
  let gy0 = ty1, gy1 = ty0;
  for (let x = a; x <= b; x++) for (let y = ty0; y <= ty1; y++) if (bin[y * w + x]) { if (y < gy0) gy0 = y; if (y > gy1) gy1 = y; }
  if (gy1 < gy0) return null;
  const wide = b - a + 1, tall = gy1 - gy0 + 1;
  if (wide * tall < 2 * SCALE) return null; // stray speck (dots are bigger after upscale)
  const vec = new Float32Array(GW * GH);
  for (let ny = 0; ny < GH; ny++) for (let nx = 0; nx < GW; nx++) {
    const sx = a + Math.floor((nx / GW) * wide), sy = gy0 + Math.floor((ny / GH) * tall);
    vec[ny * GW + nx] = bin[sy * w + sx];
  }
  return { x0: a, x1: b + 1, wide, tall, vec };
}

/** Segment a binary cell mask into glyphs: drop full-width horizontal rules, treat
 *  near-full-height columns as vertical rules/separators, split at blank columns.
 *  When `expectedW` is given, a run much wider than one digit (touching digits) is
 *  split into equal parts — at ~4px, adjacent digits often share a column. */
function segmentMask(w: number, h: number, bin: Uint8Array, expectedW?: number): Glyph[] {
  if (!w || !h) return [];
  // vertical crop to the non-rule rows (ink across <70% width is text, not a rule)
  let ty0 = -1, ty1 = -1;
  for (let y = 0; y < h; y++) { let c = 0; for (let x = 0; x < w; x++) c += bin[y * w + x]; if (c > 0 && c < w * 0.7) { if (ty0 < 0) ty0 = y; ty1 = y; } }
  if (ty0 < 0) return [];
  const cellH = ty1 - ty0 + 1;
  const colInk = new Int32Array(w);
  for (let x = 0; x < w; x++) { let c = 0; for (let y = ty0; y <= ty1; y++) c += bin[y * w + x]; colInk[x] = c >= cellH * 0.85 ? 0 : c; }
  const runs: [number, number][] = []; let s = -1;
  for (let x = 0; x < w; x++) { if (colInk[x] > 0) { if (s < 0) s = x; } else if (s >= 0) { runs.push([s, x - 1]); s = -1; } }
  if (s >= 0) runs.push([s, w - 1]);

  const glyphs: Glyph[] = [];
  for (const [a, b] of runs) {
    const wide = b - a + 1;
    // split a wide run of touching digits into equal parts
    const n = expectedW && expectedW > 0 ? Math.max(1, Math.round(wide / expectedW)) : 1;
    if (n >= 2 && wide >= expectedW! * 1.5) {
      for (let k = 0; k < n; k++) {
        const sa = a + Math.round((k * wide) / n), sb = a + Math.round(((k + 1) * wide) / n) - 1;
        const gl = makeGlyph(w, bin, sa, Math.max(sa, sb), ty0, ty1);
        if (gl) glyphs.push(gl);
      }
    } else {
      const gl = makeGlyph(w, bin, a, b, ty0, ty1);
      if (gl) glyphs.push(gl);
    }
  }
  return glyphs;
}

export function segmentCell(g: GrayImage, T: number, cx0: number, cx1: number, cy0: number, cy1: number, expectedW?: number): Glyph[] {
  const m = cellMask(g, T, cx0, cx1 + 1, cy0, cy1);
  return segmentMask(m.w, m.h, m.bin, expectedW);
}

const dist = (a: Float32Array, b: Float32Array) => { let d = 0; for (let i = 0; i < a.length; i++) { const e = a[i] - b[i]; d += e * e; } return d; };
const median = (xs: number[]) => xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : 0;

/** Build averaged digit templates from labelled code cells (glyph count must
 *  equal the code length to label unambiguously). Accepts extra prior templates
 *  (e.g. learned across many images) to cover digits absent from this image. */
export function harvestTemplates(g: GrayImage, T: number, cells: { code: string; col: GridColumn; top: number; bot: number }[], prior?: Map<string, Float32Array>): DigitTemplates {
  const sums = new Map<string, { sum: Float32Array; n: number }>();
  const widths: number[] = [], heights: number[] = [];
  for (const c of cells) {
    const gs = segmentCell(g, T, c.col.x0, c.col.x1, c.top, c.bot);
    if (gs.length !== c.code.length) continue;
    for (let i = 0; i < gs.length; i++) {
      widths.push(gs[i].wide); heights.push(gs[i].tall);
      const d = c.code[i];
      let e = sums.get(d); if (!e) { e = { sum: new Float32Array(GW * GH), n: 0 }; sums.set(d, e); }
      for (let k = 0; k < GW * GH; k++) e.sum[k] += gs[i].vec[k];
      e.n++;
    }
  }
  const proto = new Map<string, Float32Array>(prior ? [...prior] : []);
  for (const [d, e] of sums) { const v = new Float32Array(GW * GH); for (let k = 0; k < v.length; k++) v[k] = e.sum[k] / e.n; proto.set(d, v); }
  return { proto, medW: median(widths) || 6, medH: median(heights) || 12, covered: [...proto.keys()].sort().join("") };
}

export interface CellRead { digits: string; confident: boolean }

/** Read one numeric cell → DIGIT SEQUENCE only (the caller places the decimal by
 *  the column's known precision). Tiny baseline blobs (decimal points) are
 *  skipped. `confident` is false on a weak/ambiguous match so the caller can fall
 *  back to Tesseract for that cell. */
export function readNumericCell(g: GrayImage, T: number, tpl: DigitTemplates, col: GridColumn, top: number, bot: number): CellRead {
  const gs = segmentCell(g, T, col.x0, col.x1, top, bot, tpl.medW);
  if (!gs.length) return { digits: "", confident: false };
  let digits = "", confident = true;
  const cellArea = GW * GH;
  const maxTall = Math.max(...gs.map((x) => x.tall));
  for (let gi = 0; gi < gs.length; gi++) {
    const glyph = gs[gi];
    // A decimal point / comma is a small INTERIOR glyph — never the LAST glyph of
    // a number. Never skipping a trailing glyph as a dot stops slightly-clipped
    // last digits being dropped (the 10× errors).
    const isLast = gi === gs.length - 1;
    if (!isLast && glyph.tall <= maxTall * 0.42 && glyph.wide <= Math.max(2 * SCALE, tpl.medW * 0.75)) continue;
    let best = "", bd = Infinity, second = Infinity;
    for (const [d, v] of tpl.proto) { const dd = dist(glyph.vec, v); if (dd < bd) { second = bd; bd = dd; best = d; } else if (dd < second) second = dd; }
    if (!best) { confident = false; continue; }
    digits += best;
    const normBad = bd / cellArea;
    if (normBad > 0.2 || (second < Infinity && bd > second * 0.82)) confident = false;
  }
  return { digits, confident };
}

/** Place a decimal point into a digit string at a fixed precision from the right
 *  (money = 2, weight = 3). "11008",2 → "110.08"; "430",3 → "0.430". */
export function placeDecimal(digits: string, precision: number): string {
  const d = digits.replace(/\D/g, "");
  if (!d) return "";
  if (precision <= 0) return d;
  const padded = d.padStart(precision + 1, "0");
  return `${padded.slice(0, -precision)}.${padded.slice(-precision)}`;
}
