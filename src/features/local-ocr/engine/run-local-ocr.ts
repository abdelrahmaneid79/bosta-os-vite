/**
 * RUN LOCAL OCR (browser orchestrator).
 * -------------------------------------
 * File → preprocess → local OCR → structured ExtractedReport + the RawDayReport
 * the existing day-sales pipeline consumes. Emits owner-friendly progress stages.
 * Everything runs on-device; nothing leaves the browser.
 */
import type { ExtractedReport } from "@/features/local-ocr/types/local-ocr";
import type { RawDayReport } from "@/core/import/day-sales";
import { extractReport } from "@/features/local-ocr/extraction/extract-report";
import { toRawDayReport } from "@/features/local-ocr/adapter/to-raw-day-report";
import { getOcrWorker, terminateOcrWorker } from "@/features/local-ocr/engine/worker-manager";
import { loadImageToCanvas, canvasToGray, makeBrowserOcrRegion, type LoadedImage } from "@/features/local-ocr/engine/browser-image";

export type OcrStage =
  | "Preparing image" | "Finding receipt" | "Reading text locally"
  | "Reconstructing rows" | "Checking totals" | "Ready for review";

export interface LocalOcrResult {
  extraction: ExtractedReport;
  report: RawDayReport;
  image: LoadedImage;
  durationMs: number;
}

/** Read one day-report image entirely on-device. */
export async function runLocalDayReportOCR(file: File, onStage?: (s: string) => void): Promise<LocalOcrResult> {
  const t0 = performance.now();
  onStage?.("Preparing image");
  const image = await loadImageToCanvas(file);
  const gray = canvasToGray(image.canvas);

  let worker;
  try { worker = await getOcrWorker(); }
  catch (e) {
    await terminateOcrWorker();
    throw new Error("The local reader isn't ready yet — its offline files are still downloading. Try again in a moment.");
  }

  const ocr = makeBrowserOcrRegion(worker, image.canvas);
  let extraction: ExtractedReport;
  try {
    extraction = await extractReport(gray, ocr, { now: () => performance.now(), onStage });
  } catch (err) {
    await terminateOcrWorker(); // recycle a wedged worker for the next attempt
    throw err;
  }
  onStage?.("Ready for review");
  return { extraction, report: toRawDayReport(extraction), image, durationMs: performance.now() - t0 };
}
