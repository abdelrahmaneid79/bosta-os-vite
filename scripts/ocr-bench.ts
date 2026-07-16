/**
 * ACCURACY BENCHMARK (the Phase-1 "prove" gate).
 * Runs the REAL shared local-OCR core (src/features/local-ocr/*) over the sampled
 * real fixtures, in Node, via pngjs decode + a self-hosted Tesseract worker, and
 * scores it. Nothing here ships to the browser — it exercises the same pure
 * extraction/parsing code the browser will call, so accuracy is measured on
 * actual images (not typed strings). One worker is reused across all fixtures.
 *
 *   npx vite-node scripts/ocr-bench.ts -- [limit] [--variant v2024|v2025]
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import Tesseract from "tesseract.js";
import { rgbaToGray, rgbaToInk } from "@/features/local-ocr/preprocessing/grid";
import { extractReport } from "@/features/local-ocr/extraction/extract-report";
import { toRawDayReport } from "@/features/local-ocr/adapter/to-raw-day-report";
import type { GrayImage, OcrRegionFn, PixelRect, OcrRegionOpts } from "@/features/local-ocr/types/local-ocr";
import { marketCodeFromBarcode, canonCode } from "@/core/import/day-sales";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = resolve(ROOT, "fixtures/day-reports");
const UPSCALE = 4;

const args = process.argv.slice(2).filter((a) => a !== "--");
const limit = Number(args.find((a) => /^\d+$/.test(a))) || Infinity;
const variantFilter = args.includes("--variant") ? args[args.indexOf("--variant") + 1] : null;

// ── product catalog from the committed seed (barcodes read ~perfectly) ──────
const csv = readFileSync(resolve(ROOT, "public/seed/products.csv"), "utf8");
const productBarcodes = new Set([...csv.matchAll(/\b(\d{13})\b/g)].map((m) => m[1]));
const productMarketCodes = new Set([...productBarcodes].map((b) => marketCodeFromBarcode(b)).filter(Boolean) as string[]);

// ── node PNG decode + crop/upscale + OCR region (mirrors the browser canvas) ─
function decode(path: string): { rgba: Uint8Array; width: number; height: number } {
  const png = PNG.sync.read(readFileSync(path));
  return { rgba: Uint8Array.from(png.data), width: png.width, height: png.height };
}
function cropUpscale(rgba: Uint8Array, W: number, H: number, rect: PixelRect, scale: number): Buffer {
  const left = Math.max(0, rect.left | 0), top = Math.max(0, rect.top | 0);
  const width = Math.min(W - left, Math.max(1, rect.width | 0)), height = Math.min(H - top, Math.max(1, rect.height | 0));
  const ow = width * scale, oh = height * scale;
  const out = new PNG({ width: ow, height: oh });
  for (let y = 0; y < oh; y++) {
    const sy = top + ((y / scale) | 0);
    for (let x = 0; x < ow; x++) {
      const sx = left + ((x / scale) | 0);
      const si = (sy * W + sx) * 4, di = (y * ow + x) * 4;
      out.data[di] = rgba[si]; out.data[di + 1] = rgba[si + 1]; out.data[di + 2] = rgba[si + 2]; out.data[di + 3] = 255;
    }
  }
  return PNG.sync.write(out);
}
function makeOcr(worker: Tesseract.Worker, rgba: Uint8Array, W: number, H: number): OcrRegionFn {
  return async (rect: PixelRect, opts: OcrRegionOpts = {}) => {
    const scale = opts.upscale ?? UPSCALE;
    const png = cropUpscale(rgba, W, H, rect, scale);
    await worker.setParameters({
      tessedit_char_whitelist: opts.digits ? "0123456789." : "",
      tessedit_pageseg_mode: "6" as Tesseract.PSM,
      preserve_interword_spaces: "1",
    });
    const { data } = await worker.recognize(png);
    return (data.lines ?? []).map((l) => ({
      text: l.text.replace(/\n/g, " ").trim(),
      conf: l.confidence,
      yMid: rect.top + (l.bbox.y0 + l.bbox.y1) / 2 / scale,
      bbox: { x0: rect.left + l.bbox.x0 / scale, y0: rect.top + l.bbox.y0 / scale, x1: rect.left + l.bbox.x1 / scale, y1: rect.top + l.bbox.y1 / scale },
    })).filter((l) => l.text);
  };
}

// ── run ─────────────────────────────────────────────────────────────────────
if (!existsSync(resolve(FIX, "manifest.json"))) { console.error("No fixtures. Run: node scripts/sample-fixtures.mjs"); process.exit(1); }
type Man = { file: string; date: string; variantGuess: string; source: string };
let manifest: Man[] = JSON.parse(readFileSync(resolve(FIX, "manifest.json"), "utf8"));
if (variantFilter) manifest = manifest.filter((m) => m.variantGuess.includes(variantFilter));
manifest = manifest.slice(0, limit === Infinity ? manifest.length : limit);

const worker = await Tesseract.createWorker("ara+eng", 1, {
  corePath: resolve(ROOT, "node_modules/tesseract.js-core"),
  langPath: resolve(ROOT, "public/ocr/lang"),
  cachePath: resolve(ROOT, "node_modules/.cache/tesseract"),
  gzip: true, logger: () => {},
});

const money = (v: number) => Math.round(v * 100) / 100;
const agg = { n: 0, dateOk: 0, reconOk: 0, rows: 0, codeValid: 0, codeTotal: 0, bcMatch: 0, bcTotal: 0, mktMatch: 0, tied: 0, tieable: 0, ms: 0 };
console.log(`\nBenchmarking ${manifest.length} fixture(s), upscale ${UPSCALE}x, one reused worker…\n`);
console.log("date        var    rows  date  recon   code%  bc-match%  mkt%   Σnet / printed        ms");
console.log("─".repeat(95));

for (const m of manifest) {
  const path = resolve(FIX, m.file);
  if (!existsSync(path)) continue;
  const { rgba, width, height } = decode(path);
  const gray: GrayImage = rgbaToGray(rgba, width, height);
  const ocr = makeOcr(worker, rgba, width, height);
  const t0 = Date.now();
  const ex = await extractReport(gray, ocr, { now: () => Date.now(), ink: rgbaToInk(rgba, width, height) });
  const report = toRawDayReport(ex);
  const ms = Date.now() - t0;

  const lines = report.line_items;
  const codeValid = lines.filter((l) => canonCode(l.item_code).length >= 6 && canonCode(l.item_code).length <= 9).length;
  const bc = lines.filter((l) => l.barcode);
  const bcMatch = bc.filter((l) => productBarcodes.has(l.barcode.replace(/\D/g, ""))).length;
  const mkt = lines.filter((l) => { const mc = marketCodeFromBarcode(l.barcode); return mc && productMarketCodes.has(mc); }).length;
  const sumNet = money(lines.reduce((s, l) => s + (l.net_value ?? 0), 0));
  const printed = report.branch_total_net;
  const recon = printed != null && Math.abs(sumNet - printed) <= Math.max(1, Math.abs(printed) * 0.01);
  const dateOk = report.sale_date === m.date;
  const tieable = lines.filter((l) => l.net_qty != null && l.avg_unit_price != null && l.net_value != null);
  const tied = tieable.filter((l) => Math.abs((l.net_qty as number) * (l.avg_unit_price as number) - (l.net_value as number)) <= Math.max(1, Math.abs(l.net_value as number) * 0.02));

  agg.n++; agg.rows += lines.length; agg.codeValid += codeValid; agg.codeTotal += lines.length;
  agg.bcMatch += bcMatch; agg.bcTotal += bc.length; agg.mktMatch += mkt; agg.ms += ms;
  agg.tied += tied.length; agg.tieable += tieable.length;
  if (dateOk) agg.dateOk++; if (recon) agg.reconOk++;

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  console.log(
    `${m.date}  ${ex.receiptType.includes("2024") ? "24" : "25"}   ${String(lines.length).padStart(4)}   ${dateOk ? " ✓" : " ✗"}   ${recon ? " ✓ " : " ✗ "}   ${String(pct(codeValid, lines.length)).padStart(4)}   ${String(pct(bcMatch, bc.length)).padStart(6)}   ${String(pct(mkt, lines.length)).padStart(4)}   ${String(sumNet).padStart(9)} / ${String(printed ?? "—").padStart(9)}  ${String(ms).padStart(6)}`
  );
}
await worker.terminate();

const P = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "0.0");
console.log("─".repeat(95));
console.log(`\nAGGREGATE over ${agg.n} fixture(s):`);
console.log(`  date accuracy (vs filename):   ${P(agg.dateOk, agg.n)}%  (${agg.dateOk}/${agg.n})`);
console.log(`  reconciliation (Σnet≈printed): ${P(agg.reconOk, agg.n)}%  (${agg.reconOk}/${agg.n})`);
console.log(`  rows read total:               ${agg.rows}  (avg ${(agg.rows / agg.n).toFixed(1)}/report)`);
console.log(`  item-code shape-valid:         ${P(agg.codeValid, agg.codeTotal)}%`);
console.log(`  barcode exact catalog match:   ${P(agg.bcMatch, agg.bcTotal)}%  (of ${agg.bcTotal} barcodes read)`);
console.log(`  market-code catalog match:     ${P(agg.mktMatch, agg.codeTotal)}%`);
console.log(`  per-line arithmetic tie:       ${P(agg.tied, agg.tieable)}%  (qty×price≈value, of ${agg.tieable})`);
console.log(`  avg processing time:           ${(agg.ms / agg.n / 1000).toFixed(1)}s/report`);
