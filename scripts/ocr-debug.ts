// Dump a full ExtractedReport for ONE fixture to diagnose extraction issues.
//   npx vite-node scripts/ocr-debug.ts -- fixtures/day-reports/2024-11-04.png
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import Tesseract from "tesseract.js";
import { rgbaToGray, rgbaToInk, detectGrid } from "@/features/local-ocr/preprocessing/grid";
import { extractReport } from "@/features/local-ocr/extraction/extract-report";
import type { PixelRect, OcrRegionOpts } from "@/features/local-ocr/types/local-ocr";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const path = resolve(process.argv.slice(2).filter((a) => a !== "--")[0]);
const png = PNG.sync.read(readFileSync(path));
const rgba = Uint8Array.from(png.data), W = png.width, H = png.height;
const gray = rgbaToGray(rgba, W, H);
const grid = detectGrid(gray);
console.log(`image ${W}x${H}`);
console.log("columns:", grid.columns.map((c, i) => `${i}:${c.x0}-${c.x1}(${c.width})`).join(" "));
console.log("productBand:", grid.productBand, "hRules:", grid.hRules.length);

const worker = await Tesseract.createWorker("ara+eng", 1, {
  corePath: resolve(ROOT, "node_modules/tesseract.js-core"),
  langPath: resolve(ROOT, "public/ocr/lang"),
  cachePath: resolve(ROOT, "node_modules/.cache/tesseract"),
  gzip: true, logger: () => {},
});
function cropUpscale(rect: PixelRect, scale: number): Buffer {
  const left = Math.max(0, rect.left | 0), top = Math.max(0, rect.top | 0);
  const width = Math.min(W - left, Math.max(1, rect.width | 0)), height = Math.min(H - top, Math.max(1, rect.height | 0));
  const ow = width * scale, oh = height * scale;
  const out = new PNG({ width: ow, height: oh });
  for (let y = 0; y < oh; y++) { const sy = top + ((y / scale) | 0); for (let x = 0; x < ow; x++) { const sx = left + ((x / scale) | 0); const si = (sy * W + sx) * 4, di = (y * ow + x) * 4; out.data[di] = rgba[si]; out.data[di + 1] = rgba[si + 1]; out.data[di + 2] = rgba[si + 2]; out.data[di + 3] = 255; } }
  return PNG.sync.write(out);
}
const ocr = async (rect: PixelRect, opts: OcrRegionOpts = {}) => {
  const scale = opts.upscale ?? 4;
  await worker.setParameters({ tessedit_char_whitelist: opts.digits ? "0123456789." : "", tessedit_pageseg_mode: "6" as Tesseract.PSM, preserve_interword_spaces: "1" });
  const { data } = await worker.recognize(cropUpscale(rect, scale));
  return (data.lines ?? []).map((l) => ({ text: l.text.replace(/\n/g, " ").trim(), conf: l.confidence, yMid: rect.top + (l.bbox.y0 + l.bbox.y1) / 2 / scale, bbox: { x0: rect.left + l.bbox.x0 / scale, y0: rect.top + l.bbox.y0 / scale, x1: rect.left + l.bbox.x1 / scale, y1: rect.top + l.bbox.y1 / scale } })).filter((l) => l.text);
};

const ex = await extractReport(gray, ocr, { now: () => Date.now(), ink: rgbaToInk(rgba, W, H) });
await worker.terminate();
console.log(`\nreceiptType: ${ex.receiptType}`);
console.log(`date: "${ex.date.rawText}" → ${ex.date.normalizedValue}`);
console.log(`branchTotalNet: "${ex.branchTotalNet.rawText}" → ${ex.branchTotalNet.normalizedValue}`);
console.log(`rows: ${ex.rows.length}`);
console.log("\nfirst 6 rows [code | barcode | name | price | qtySold | netQty | netValue]:");
for (const r of ex.rows.slice(0, 6)) {
  console.log(`  "${r.itemCode.rawText}"→${r.itemCode.normalizedValue} | "${r.barcode.rawText}" | "${r.nameAr.rawText}" | p"${r.unitPrice.rawText}"→${r.unitPrice.normalizedValue} | q"${r.qtySold.rawText}"→${r.qtySold.normalizedValue} | nq"${r.netQty.rawText}"→${r.netQty.normalizedValue} | nv"${r.netValue.rawText}"→${r.netValue.normalizedValue}`);
}
