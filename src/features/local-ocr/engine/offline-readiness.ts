/**
 * OFFLINE READINESS — reports whether the local OCR assets are available on this
 * device (served fresh when online, or served from the service-worker cache when
 * offline). Used to show the owner a clear state and to warm the worker up front.
 */
import { getOcrWorker } from "@/features/local-ocr/engine/worker-manager";

export type OcrReadiness =
  | "checking"      // probing
  | "ready"         // assets present (works offline)
  | "downloading"   // assets missing but reachable — being fetched/cached
  | "unavailable";  // offline and not cached, or assets missing

const REQUIRED = [
  "/ocr/worker.min.js",
  "/ocr/tesseract-core-simd-lstm.wasm",
  "/ocr/lang/eng.traineddata.gz",
  "/ocr/lang/ara.traineddata.gz",
];

/** True if every required asset resolves (from network or SW cache). */
export async function checkOcrReadiness(): Promise<OcrReadiness> {
  try {
    const oks = await Promise.all(REQUIRED.map((u) =>
      fetch(u, { method: "HEAD", cache: "force-cache" }).then((r) => r.ok).catch(() => false)));
    if (oks.every(Boolean)) return "ready";
    return navigator.onLine ? "downloading" : "unavailable";
  } catch { return navigator.onLine ? "downloading" : "unavailable"; }
}

/** Kick off worker init (which fetches + caches wasm/lang) ahead of first use. */
export async function warmOcr(): Promise<boolean> {
  try { await getOcrWorker(); return true; } catch { return false; }
}
