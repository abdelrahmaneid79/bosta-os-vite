/**
 * BROWSER IMAGE LOADING + REGION OCR (canvas).
 * --------------------------------------------
 * The DOM/canvas counterpart to the Node pngjs harness: decode the uploaded file
 * (correcting EXIF orientation for phone photos), cap its size to protect mobile
 * memory, expose a grayscale plane for grid detection, and provide the injected
 * per-region OCR that crops + upscales each column strip and runs it through the
 * shared worker. Same extraction/parsing core runs on top of this and the Node
 * harness, so accuracy proven in the benchmark is the accuracy shipped.
 */
import type { Worker, PSM } from "tesseract.js";
import type { GrayImage, OcrRegionFn, OcrRegionOpts } from "@/features/local-ocr/types/local-ocr";
import { rgbaToGray } from "@/features/local-ocr/preprocessing/grid";

const MAX_DIM = 2600;   // cap longest side (phone photos); screenshots are ~800px
const DEFAULT_UPSCALE = 4;

export interface LoadedImage { canvas: HTMLCanvasElement; width: number; height: number; previewUrl: string }

/** Decode a File to a canvas, EXIF-corrected and size-capped. Keeps a preview URL
 *  of the ORIGINAL for the review screen. */
export async function loadImageToCanvas(file: File): Promise<LoadedImage> {
  const previewUrl = URL.createObjectURL(file);
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
    .catch(() => createImageBitmap(file));
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return { canvas, width, height, previewUrl };
}

/** Grayscale plane for grid detection. */
export function canvasToGray(canvas: HTMLCanvasElement): GrayImage {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return rgbaToGray(data, canvas.width, canvas.height);
}

/** Build the injected OCR function: crop a region, nearest-neighbour upscale so
 *  small digits/decimals survive, and OCR it via the shared worker. yMid is
 *  mapped back to ORIGINAL-image coordinates for row snapping. */
export function makeBrowserOcrRegion(worker: Worker, source: HTMLCanvasElement): OcrRegionFn {
  const scratch = document.createElement("canvas");
  const sctx = scratch.getContext("2d", { willReadFrequently: true })!;
  return async (rect, opts: OcrRegionOpts = {}) => {
    const scale = opts.upscale ?? DEFAULT_UPSCALE;
    const w = Math.max(1, Math.round(rect.width * scale)), h = Math.max(1, Math.round(rect.height * scale));
    scratch.width = w; scratch.height = h;
    sctx.imageSmoothingEnabled = false;
    sctx.clearRect(0, 0, w, h);
    sctx.drawImage(source, rect.left, rect.top, rect.width, rect.height, 0, 0, w, h);
    await worker.setParameters({
      tessedit_char_whitelist: opts.digits ? "0123456789." : "",
      tessedit_pageseg_mode: "6" as PSM, // SINGLE_BLOCK
      preserve_interword_spaces: "1",
    });
    const { data } = await worker.recognize(scratch);
    return (data.lines ?? []).map((l) => ({
      text: l.text.replace(/\n/g, " ").trim(),
      conf: l.confidence,
      yMid: rect.top + (l.bbox.y0 + l.bbox.y1) / 2 / scale,
      bbox: { x0: rect.left + l.bbox.x0 / scale, y0: rect.top + l.bbox.y0 / scale, x1: rect.left + l.bbox.x1 / scale, y1: rect.top + l.bbox.y1 / scale },
    })).filter((l) => l.text);
  };
}
