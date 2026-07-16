/**
 * TESSERACT WORKER MANAGER (browser).
 * -----------------------------------
 * Owns ONE reused Tesseract web-worker for the whole session (loading the ~6 MB
 * of wasm + language data once, not per image). All asset paths are SAME-ORIGIN
 * self-hosted under /ocr/ — never a CDN — so the service worker can cache them
 * for offline use. The worker is recreated safely after a fatal error.
 */
import { createWorker, type Worker } from "tesseract.js";

/** Same-origin asset locations (served from public/ocr, cached by the SW). */
export const OCR_ASSETS = {
  workerPath: "/ocr/worker.min.js",
  corePath: "/ocr/",                 // dir → tesseract picks the simd-lstm core
  langPath: "/ocr/lang",             // holds ara/eng .traineddata.gz
  langs: "ara+eng",
} as const;

let workerPromise: Promise<Worker> | null = null;

/** Get (creating once) the shared OCR worker. Concurrent callers share the load. */
export function getOcrWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker(OCR_ASSETS.langs, 1, {
      workerPath: OCR_ASSETS.workerPath,
      corePath: OCR_ASSETS.corePath,
      langPath: OCR_ASSETS.langPath,
      workerBlobURL: false, // use our self-hosted worker script, not a blob/CDN
      gzip: true,
      logger: () => {},
      errorHandler: () => {},
    }).catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

/** Terminate + drop the worker (call after a fatal error, then getOcrWorker() again). */
export async function terminateOcrWorker(): Promise<void> {
  const p = workerPromise;
  workerPromise = null;
  if (p) { try { (await p).terminate(); } catch { /* already gone */ } }
}

/** Run `fn` with the worker; on failure, recycle the worker once and retry. */
export async function withOcrWorker<T>(fn: (w: Worker) => Promise<T>): Promise<T> {
  try {
    return await fn(await getOcrWorker());
  } catch (err) {
    await terminateOcrWorker();
    return await fn(await getOcrWorker()); // one clean retry on a fresh worker
    void err;
  }
}
