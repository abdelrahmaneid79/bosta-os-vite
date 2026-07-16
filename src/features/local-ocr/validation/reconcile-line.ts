/**
 * ARITHMETIC RECONCILIATION (pure, unit-tested).
 * ----------------------------------------------
 * On this report Tesseract reads the money column (net_value) and the price
 * reliably, but the small fractional weights (qty) unreliably. Rather than trust
 * a shaky qty, we exploit the receipt's own identity  net_value = net_qty × price
 * to CROSS-CHECK and, where a read is implausible, DERIVE the missing/wrong term
 * from the two more-reliable ones. Corrections are never silent — every repaired
 * value carries a warning and a lowered confidence for the review screen.
 *
 * Reliability order used as the anchor: net_value > price > qty.
 */

export interface NoisyNumbers {
  qty: number | null;        // net_qty (OCR)
  price: number | null;      // avg_unit_price (OCR)
  netValue: number | null;   // net_value / line money (OCR)
  qtyConf: number;           // 0..1 raw OCR confidences
  priceConf: number;
  valueConf: number;
}

export interface ReconciledNumbers {
  qty: number | null;
  price: number | null;
  netValue: number | null;
  qtyDerived: boolean;
  priceDerived: boolean;
  valueDerived: boolean;
  reconciles: boolean;       // the three agree within tolerance
  confidence: number;        // combined 0..1
  warnings: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** relative difference, guarding divide-by-zero. */
function relDiff(a: number, b: number): number {
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m === 0 ? 0 : Math.abs(a - b) / m;
}

const TOL = 0.02; // 2% — absorbs last-digit OCR wobble on this font

/**
 * Reconcile one line. Prefers keeping consistent reads; derives a term only when
 * it's missing or clearly contradicts the other two. Whole-number prices on this
 * report mean a derived qty from an integer-clean price is trustworthy.
 */
export function reconcileLine(n: NoisyNumbers): ReconciledNumbers {
  let { qty, price, netValue } = n;
  const warnings: string[] = [];
  let qtyDerived = false, priceDerived = false, valueDerived = false;

  const have = (v: number | null): v is number => v != null && Number.isFinite(v);
  const consistent = (q: number, p: number, v: number) => relDiff(q * p, v) <= TOL;

  // CONSERVATIVE policy: net_value is the reliable financial anchor (it reads
  // well and reconciles to the printed branch total). qty/price fractional reads
  // are noisy on this font, so we DERIVE a term only when it is entirely MISSING
  // — never overwrite a value that was read, however suspect. A read that is
  // present but inconsistent is FLAGGED for review, not silently rewritten.
  if (!have(netValue) && have(qty) && have(price)) {
    netValue = qty * price; valueDerived = true; warnings.push("value derived from qty × price");
  } else if (!have(qty) && have(netValue) && have(price) && price > 0) {
    qty = netValue / price; qtyDerived = true; warnings.push("qty derived from value ÷ price");
  } else if (!have(price) && have(netValue) && have(qty) && qty > 0) {
    price = netValue / qty; priceDerived = true; warnings.push("price derived from value ÷ qty");
  }

  const reconciles = have(qty) && have(price) && have(netValue) ? consistent(qty, price, netValue) : false;
  if (have(qty) && have(price) && have(netValue) && !reconciles) {
    warnings.push(`does not reconcile: ${r3(qty)} × ${r2(price)} ≠ ${r2(netValue)} — review`);
  }

  // confidence: anchored on the net_value read; penalise derivations + mismatch.
  let confidence = have(netValue) ? n.valueConf * 0.6 + n.priceConf * 0.2 + n.qtyConf * 0.2 : n.qtyConf * 0.5;
  if (qtyDerived || priceDerived || valueDerived) confidence *= 0.85;
  if (have(qty) && have(price) && have(netValue) && !reconciles) confidence *= 0.5;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    qty: have(qty) ? r3(qty) : null,
    price: have(price) ? r2(price) : null,
    netValue: have(netValue) ? r2(netValue) : null,
    qtyDerived, priceDerived, valueDerived, reconciles, confidence, warnings,
  };
}
