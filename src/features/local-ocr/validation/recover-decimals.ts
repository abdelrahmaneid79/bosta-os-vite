/**
 * DECIMAL-MAGNITUDE RECOVERY (pure, unit-tested).
 * -----------------------------------------------
 * Tesseract occasionally drops a value's decimal point on this font ("110.08" →
 * "11008"), which makes that one line ~100× too large and wrecks the document
 * total. The values are otherwise correct. Because every line on a day report is
 * the same order of magnitude, an outlier that is a clean power-of-ten multiple
 * of the row median almost certainly lost its point — we rescale it and FLAG the
 * correction (never silent). Anchored on the row median, and re-checked against
 * the printed branch total when available.
 */

export interface Recovered { value: number; scaled: boolean; from: number }

/** Median of a numeric list (0 for empty). */
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

/**
 * Rescale clear outliers to the row's magnitude. Only a value far above the row
 * median (≥ `factor`×, impossible for a single line on a report that sums to a
 * small multiple of the median) is treated as a lost decimal, and it's divided by
 * the exact power of ten that snaps it CLOSEST to the median — so a ×100 loss
 * ("110.08"→"11008") recovers in one call, while a merely-large (2–10× median)
 * legitimate line is left untouched. Under-correcting is safer than corrupting a
 * real value, so ambiguous ×10 cases are deliberately not rescaled.
 */
export function recoverNetValueDecimals(values: (number | null)[], factor = 30): Recovered[] {
  const present = values.filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  const med = median(present);
  if (med <= 0) return values.map((v) => ({ value: v ?? 0, scaled: false, from: v ?? 0 }));
  return values.map((v) => {
    if (v == null || !Number.isFinite(v) || v <= 0 || v <= med * factor) return { value: v ?? 0, scaled: false, from: v ?? 0 };
    const steps = Math.min(4, Math.max(1, Math.round(Math.log10(v / med)))); // nearest power of ten to median
    const value = Math.round((v / 10 ** steps) * 100) / 100;
    return { value, scaled: true, from: v };
  });
}
