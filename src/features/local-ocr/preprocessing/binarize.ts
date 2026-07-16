/**
 * THRESHOLDING (pure) — Otsu's method picks the ink/paper cut-off from each
 * screenshot's own histogram, so the glyph matcher adapts to varying contrast.
 */
import type { GrayImage } from "@/features/local-ocr/types/local-ocr";

/** Otsu's method → the grayscale threshold that best separates ink from paper. */
export function otsuThreshold(img: GrayImage): number {
  const hist = new Int32Array(256);
  for (let i = 0; i < img.data.length; i++) hist[img.data[i]]++;
  const total = img.data.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thresh = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thresh = t; }
  }
  return thresh;
}
