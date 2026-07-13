/** Inventory count intelligence — PURE (Cycle 8).
 *
 *  First count = opening baseline (a baseline adjustment, NOT a purchase or
 *  sale, never touching operating profit). Later counts reconcile expected vs
 *  physical and classify variance NEUTRALLY (never "theft"). Missing cost →
 *  quantity-known / value-unknown. Unit mismatch blocks calculations. */

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

/* ── first count (opening baseline) ──────────────────────────────────── */

export interface CountLine { productId: string; name: string; countedQty: number | null; unit: string | null; avgCost: number | null; hasCost: boolean }

export interface BaselineResult {
  counted: number;
  skipped: number;
  missingUnits: string[];
  missingCosts: string[];
  knownStockValue: number;
  unknownValueProducts: string[];
  note: string;
  unlocks: string[];
}

export function summarizeOpeningStockCount(lines: CountLine[]): BaselineResult {
  const counted = lines.filter((l) => l.countedQty != null);
  const missingUnits = counted.filter((l) => !l.unit).map((l) => l.name);
  const missingCosts = counted.filter((l) => l.countedQty! > 0 && !l.hasCost).map((l) => l.name);
  let value = 0;
  const unknownValue: string[] = [];
  for (const l of counted) {
    if (l.hasCost && l.avgCost != null && l.unit) value += (l.countedQty ?? 0) * l.avgCost;
    else if ((l.countedQty ?? 0) > 0) unknownValue.push(l.name);
  }
  return {
    counted: counted.length,
    skipped: lines.length - counted.length,
    missingUnits,
    missingCosts,
    knownStockValue: r0(value),
    unknownValueProducts: unknownValue,
    note: "Opening stock baseline — recorded as a baseline adjustment, NOT a purchase or sale. It does not affect operating profit. Products without a cost are quantity-known / value-unknown.",
    unlocks: ["live inventory", "days of cover", "purchase quantities", "stock-risk & excess alerts"],
  };
}

/* ── later counts (variance) ─────────────────────────────────────────── */

export type VarianceClass = "waste" | "sampling" | "damaged" | "counting_error" | "purchase_unrecorded" | "sale_unrecorded" | "unit_mismatch" | "unknown";

export interface CountVariance {
  productId: string;
  name: string;
  expectedQty: number | null;
  countedQty: number;
  variance: number | null;          // counted − expected
  variancePct: number | null;
  valueImpact: number | null;       // variance × avg cost (null when cost unknown)
  blocked: boolean;                 // unit mismatch → cannot compute
  candidates: VarianceClass[];
  note: string;
}

export function computeCountVariance(
  line: { productId: string; name: string; expectedQty: number | null; countedQty: number; expectedUnit: string | null; countedUnit: string | null; avgCost: number | null },
): CountVariance {
  if (line.expectedUnit && line.countedUnit && line.expectedUnit !== line.countedUnit) {
    return { productId: line.productId, name: line.name, expectedQty: line.expectedQty, countedQty: line.countedQty, variance: null, variancePct: null, valueImpact: null, blocked: true, candidates: ["unit_mismatch"], note: `Unit mismatch (${line.expectedUnit} vs ${line.countedUnit}) — variance can't be computed until units agree.` };
  }
  if (line.expectedQty == null) {
    return { productId: line.productId, name: line.name, expectedQty: null, countedQty: line.countedQty, variance: null, variancePct: null, valueImpact: null, blocked: false, candidates: ["unknown"], note: "No expected quantity (no prior baseline for this product) — this count sets its baseline." };
  }
  const v = line.countedQty - line.expectedQty;
  const pct = line.expectedQty !== 0 ? r1((v / line.expectedQty) * 100) : null;
  const shortage = v < 0;
  const candidates: VarianceClass[] = shortage
    ? ["sale_unrecorded", "waste", "damaged", "counting_error"]
    : ["purchase_unrecorded", "counting_error", "sampling"];
  return {
    productId: line.productId, name: line.name,
    expectedQty: r1(line.expectedQty), countedQty: r1(line.countedQty),
    variance: r1(v), variancePct: pct,
    valueImpact: line.avgCost != null ? r0(v * line.avgCost) : null,
    blocked: false,
    candidates,
    note: shortage
      ? "Physical is below expected — most often an unrecorded sale or normal waste. NOT assumed to be theft; every adjustment keeps an audit trail."
      : "Physical is above expected — most often an unrecorded purchase or a counting difference.",
  };
}
