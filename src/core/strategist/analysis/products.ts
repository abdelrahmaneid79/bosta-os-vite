/** Product intelligence — PURE Layer 2 modules (Cycle 6).
 *
 *  Contribution analysis, price/volume/mix/cost decomposition, portfolio
 *  classification, shelf priority, pricing-review and purchase-review
 *  signals. Every output carries coverage, confidence and explicit unknowns.
 *
 *  Honesty rules encoded here:
 *  - attribution runs only when BOTH periods have enough product coverage;
 *    the un-covered slice stays visible as "unexplained", never distributed
 *  - missing costs/stock/prices are never treated as zero
 *  - thresholds come from BusinessContext (owner-confirmed or labeled default) */
import type { StrategistSnapshot, ProductPeriodEntry } from "../contract";
import type { FindingConfidence } from "./types";

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const egp = (n: number) => `EGP ${Math.round(n).toLocaleString("en-US")}`;

export const MIN_ATTRIBUTION_COVERAGE = 60; // % of revenue that must have product detail, both periods

/* ═══ CONTRIBUTION ANALYSIS ═══════════════════════════════════════════ */

export interface Contributor { name: string; delta: number; sharePct: number }
export interface ContributionAnalysis {
  available: boolean;
  reason?: string;                 // when unavailable
  metric: "revenue" | "grossProfit";
  totalChange: number;             // header-level change (the truth to explain)
  explainedChange: number;         // Σ product deltas (covered slice only)
  explainedPct: number | null;     // |explained| / |total|
  unexplained: number;             // total − explained (uncovered days, unmapped, rounding)
  positive: Contributor[];         // top gainers
  negative: Contributor[];         // top decliners
  concentrated: boolean;           // top 3 ≥ 70% of |explained|
  coverage: { periodPct: number; comparePct: number };
  confidence: FindingConfidence;
  missing: string[];
}

export function analyzeContribution(
  s: StrategistSnapshot,
  which: "revenue" | "grossProfit" = "revenue",
): ContributionAnalysis {
  const cur = s.products.detail.value ?? [];
  const prior = s.products.compareDetail.value ?? [];
  const covP = s.products.detail.completeness ?? 0;
  const covC = s.products.compareDetail.completeness ?? 0;
  const coverage = { periodPct: r1(covP), comparePct: r1(covC) };

  const totalChange = which === "revenue"
    ? (s.revenue.periodRevenue.value ?? 0) - (s.revenue.priorRevenue.value ?? 0)
    : ((): number => {
        // gross-profit header change is only knowable from covered lines
        const gp = (list: ProductPeriodEntry[]) => list.reduce((a, p) => a + (p.grossProfit ?? 0), 0);
        return gp(cur) - gp(prior);
      })();

  const base = { metric: which, totalChange: r0(totalChange), coverage } as const;

  if (covP < MIN_ATTRIBUTION_COVERAGE || covC < MIN_ATTRIBUTION_COVERAGE) {
    return {
      ...base, available: false,
      reason: `product-line coverage is ${r1(Math.min(covP, covC))}% in the weaker period — below the ${MIN_ATTRIBUTION_COVERAGE}% needed for honest attribution`,
      explainedChange: 0, explainedPct: null, unexplained: r0(totalChange),
      positive: [], negative: [], concentrated: false, confidence: "low",
      missing: ["product-line detail for the uncovered days (photo importer)"],
    };
  }

  const priorBy = new Map(prior.map((p) => [p.name, p]));
  const names = new Set([...cur.map((p) => p.name), ...prior.map((p) => p.name)]);
  const missing: string[] = [];
  const deltas: Contributor[] = [];
  for (const name of names) {
    const a = cur.find((p) => p.name === name);
    const b = priorBy.get(name);
    const va = which === "revenue" ? a?.revenue ?? 0 : a?.grossProfit ?? null;
    const vb = which === "revenue" ? b?.revenue ?? 0 : b?.grossProfit ?? null;
    if (which === "grossProfit" && ((a && a.grossProfit == null) || (b && b.grossProfit == null))) {
      missing.push(`${name} cost (its profit contribution is unknowable)`);
      continue; // unknown stays unknown — never zero
    }
    const d = (va ?? 0) - (vb ?? 0);
    if (Math.abs(d) >= 1) deltas.push({ name, delta: r0(d), sharePct: 0 });
  }

  const explained = deltas.reduce((a, d) => a + d.delta, 0);
  const absExplained = deltas.reduce((a, d) => a + Math.abs(d.delta), 0) || 1;
  for (const d of deltas) d.sharePct = r1((Math.abs(d.delta) / absExplained) * 100);
  deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const top3Share = deltas.slice(0, 3).reduce((a, d) => a + d.sharePct, 0);

  const explainedPct = totalChange !== 0 ? r1(Math.min(150, Math.abs(explained / totalChange) * 100)) : null;
  return {
    ...base, available: true,
    explainedChange: r0(explained),
    explainedPct,
    unexplained: r0(totalChange - explained),
    positive: deltas.filter((d) => d.delta > 0).slice(0, 5),
    negative: deltas.filter((d) => d.delta < 0).slice(0, 5),
    concentrated: top3Share >= 70,
    confidence: covP >= 90 && covC >= 90 ? "high" : "medium",
    missing,
  };
}

/* ═══ PRICE / VOLUME / MIX / COST DECOMPOSITION ═══════════════════════ */

export interface Decomposition {
  available: boolean;
  reason?: string;
  period: string;
  comparePeriod: string;
  /** all in EGP, on covered products present in both periods */
  volumeEffect: number;   // Δqty at prior price
  priceEffect: number;    // current qty × Δ observed unit price
  costEffect: number;     // current qty × Δ unit cost (negative = costs rose)
  mixEffect: number;      // margin shift from volume moving between products
  residual: number;       // header change − (all effects) — NEVER redistributed
  coverage: number;       // % of current-period covered revenue included
  knownProducts: number;
  excludedProducts: string[]; // present in one period only / missing units or cost
  confidence: FindingConfidence;
}

/** Decompose the change in GROSS PROFIT on covered products. Requires per-
 *  product comparable units in both periods and known costs. */
export function decomposeChange(s: StrategistSnapshot): Decomposition {
  const cur = s.products.detail.value ?? [];
  const prior = s.products.compareDetail.value ?? [];
  const covP = s.products.detail.completeness ?? 0;
  const covC = s.products.compareDetail.completeness ?? 0;
  const base = { period: s.meta.period.label, comparePeriod: s.meta.comparePeriod.label };

  if (covP < MIN_ATTRIBUTION_COVERAGE || covC < MIN_ATTRIBUTION_COVERAGE) {
    return { ...base, available: false, reason: `coverage below ${MIN_ATTRIBUTION_COVERAGE}% (${r1(Math.min(covP, covC))}%)`, volumeEffect: 0, priceEffect: 0, costEffect: 0, mixEffect: 0, residual: 0, coverage: r1(Math.min(covP, covC)), knownProducts: 0, excludedProducts: [], confidence: "low" };
  }

  const priorBy = new Map(prior.map((p) => [p.name, p]));
  const excluded: string[] = [];
  let volume = 0, price = 0, cost = 0, gpNow = 0, gpPrior = 0;
  let includedRevenue = 0;
  let known = 0;

  // portfolio-average prior margin (for the mix split of the volume effect)
  const priorKnown = prior.filter((p) => p.units > 0 && p.grossProfit != null);
  const priorAvgMarginPerEgp = priorKnown.length
    ? priorKnown.reduce((a, p) => a + (p.grossProfit ?? 0), 0) / Math.max(1, priorKnown.reduce((a, p) => a + p.revenue, 0))
    : 0;
  let volumeAtAvgMargin = 0;

  for (const a of cur) {
    const b = priorBy.get(a.name);
    if (!b) { excluded.push(`${a.name} (new this period)`); gpNow += a.grossProfit ?? 0; continue; }
    if (a.units <= 0 || b.units <= 0 || a.grossProfit == null || b.grossProfit == null) {
      excluded.push(`${a.name} (${a.grossProfit == null || b.grossProfit == null ? "missing cost" : "missing units"})`);
      continue;
    }
    const p0 = b.revenue / b.units, p1 = a.revenue / a.units;   // observed avg selling price
    const c0 = b.cogs / b.units, c1 = a.cogs / a.units;         // observed avg unit cost
    const dq = a.units - b.units;
    volume += dq * (p0 - c0);                 // more/less of the SAME economics
    volumeAtAvgMargin += dq * p0 * priorAvgMarginPerEgp;
    price += a.units * (p1 - p0);             // selling-price change at current volume
    cost -= a.units * (c1 - c0);              // cost increase reduces GP
    gpNow += a.grossProfit; gpPrior += b.grossProfit;
    includedRevenue += a.revenue;
    known += 1;
  }
  for (const b of prior) if (!cur.find((p) => p.name === b.name)) { excluded.push(`${b.name} (dropped out)`); gpPrior += b.grossProfit ?? 0; }

  if (known < 3) {
    return { ...base, available: false, reason: "fewer than 3 products have comparable units and costs in both periods", volumeEffect: 0, priceEffect: 0, costEffect: 0, mixEffect: 0, residual: 0, coverage: r1(covP), knownProducts: known, excludedProducts: excluded.slice(0, 8), confidence: "low" };
  }

  // mix = the part of the volume effect that comes from volume shifting toward
  // richer/poorer products than the portfolio average
  const mix = volume - volumeAtAvgMargin;
  const pureVolume = volumeAtAvgMargin;
  const headerChange = gpNow - gpPrior;
  const residual = headerChange - (pureVolume + mix + price + cost);

  const curRevenue = cur.reduce((x, p) => x + p.revenue, 0) || 1;
  return {
    ...base, available: true,
    volumeEffect: r0(pureVolume), mixEffect: r0(mix), priceEffect: r0(price), costEffect: r0(cost),
    residual: r0(residual),
    coverage: r1((includedRevenue / curRevenue) * 100),
    knownProducts: known,
    excludedProducts: excluded.slice(0, 8),
    confidence: covP >= 90 && covC >= 90 && excluded.length <= 2 ? "high" : "medium",
  };
}

/* ═══ PORTFOLIO CLASSIFICATION ════════════════════════════════════════ */

export type ProductTag =
  | "star" | "volume_driver" | "profit_driver" | "high_volume_low_margin"
  | "low_volume_high_margin" | "weak" | "declining" | "emerging" | "stock_risk"
  | "cost_unknown" | "data_insufficient" | "dormant"
  | "review_pricing" | "review_purchasing" | "review_shelf_space";

export interface ProductClassification {
  name: string;
  tags: ProductTag[];
  reasons: string[];
  revenue: number;
  grossProfit: number | null;
  marginPct: number | null;
  daysSold: number;
  frequencyPct: number;         // daysSold / period trading days
  trendPct: number | null;      // revenue change vs compare period
  revenueSharePct: number;
  gpSharePct: number | null;
  onHand: number | null;        // null when inventory untracked
  coveragePct: number;          // period product coverage (context for every claim)
  confidence: FindingConfidence;
  recommendedAction: string;
  resolutionCriteria: string;
}

export interface ThresholdInfo { name: string; value: number | string; basis: "owner confirmed" | "system default" | "derived" }

export interface PortfolioAnalysis {
  available: boolean;
  reason?: string;
  classifications: ProductClassification[];
  thresholds: ThresholdInfo[];
  period: string;
}

export function classifyPortfolio(s: StrategistSnapshot): PortfolioAnalysis {
  const cur = s.products.detail.value ?? [];
  const covP = s.products.detail.completeness ?? 0;
  const period = s.meta.period.label;
  if (covP < MIN_ATTRIBUTION_COVERAGE || cur.length < 3) {
    return { available: false, reason: `product coverage ${r1(covP)}% is below ${MIN_ATTRIBUTION_COVERAGE}% — classifications would be guesses`, classifications: [], thresholds: [], period };
  }

  const ctx = s.context;
  const ownerBasis = (m: { basis: string }) => (m.basis === "fact" ? "owner confirmed" : "system default") as ThresholdInfo["basis"];
  const marginFloor = ctx.grossMarginFloorPct.value ?? 25;
  const deadDays = ctx.deadStockDays.value ?? 30;
  const stockTol = ctx.stockoutToleranceDays.value ?? 7;

  const periodDays = s.products.periodDays.value ?? 30;
  const totalRev = cur.reduce((a, p) => a + p.revenue, 0) || 1;
  const totalGp = cur.reduce((a, p) => a + (p.grossProfit ?? 0), 0) || 1;
  const margins = cur.map((p) => p.marginPct).filter((m): m is number => m != null).sort((a, b) => a - b);
  const medianMargin = margins.length ? margins[Math.floor(margins.length / 2)] : marginFloor;
  const priorBy = new Map((s.products.compareDetail.value ?? []).map((p) => [p.name, p]));
  const posBy = new Map((s.products.positions.value ?? []).map((p) => [p.name, p]));
  const stockTracked = s.inventory.hasLiveData;
  const dormantCandidates = (s.products.compareDetail.value ?? []).filter((b) => !cur.find((p) => p.name === b.name));

  const conf: FindingConfidence = covP >= 90 ? "high" : "medium";

  const out: ProductClassification[] = [];
  const classify = (p: ProductPeriodEntry | null, dormantOf?: ProductPeriodEntry): void => {
    const name = p?.name ?? dormantOf!.name;
    const prior = priorBy.get(name);
    const pos = posBy.get(name);
    const revenue = p?.revenue ?? 0;
    const trend = p && prior && prior.revenue > 0 ? r1(((p.revenue - prior.revenue) / prior.revenue) * 100) : null;
    const revShare = r1((revenue / totalRev) * 100);
    const gpShare = p?.grossProfit != null ? r1(((p.grossProfit) / totalGp) * 100) : null;
    const freq = p ? r1((p.daysSold / Math.max(1, periodDays)) * 100) : 0;

    const tags: ProductTag[] = [];
    const reasons: string[] = [];
    const add = (t: ProductTag, why: string) => { tags.push(t); reasons.push(why); };

    if (!p) {
      add("dormant", `sold ${egp(dormantOf!.revenue)} in ${s.meta.comparePeriod.label} but nothing this period (dead-stock threshold ${deadDays} days)`);
    } else if (p.units <= 0 || p.daysSold < 3) {
      add("data_insufficient", `only ${p.daysSold} sale day(s) this period — too thin to judge`);
    } else {
      if (p.missingCost || p.marginPct == null) add("cost_unknown", "no recorded cost — margin unknowable until a cost is added");
      const m = p.marginPct;
      if (m != null) {
        if (revShare >= 5 && m >= medianMargin && (trend == null || trend >= -5)) add("star", `${revShare}% of revenue at ${m}% margin (median ${r1(medianMargin)}%), holding or growing`);
        if (revShare >= 8 && m < medianMargin) add("high_volume_low_margin", `${revShare}% of revenue but ${m}% margin is below the portfolio median (${r1(medianMargin)}%)`);
        if (revShare < 4 && m >= medianMargin + 10) add("low_volume_high_margin", `${m}% margin but only ${revShare}% of revenue`);
        if (revShare < 3 && m < medianMargin && freq < 33) add("weak", `below-median margin (${m}%), ${revShare}% of revenue, sells on only ${freq}% of days`);
        if (m < marginFloor && revenue >= 500) add("review_pricing", `margin ${m}% is under your ${marginFloor}% floor on ${egp(revenue)} of sales`);
      }
      if (gpShare != null && gpShare >= 10) add("profit_driver", `${gpShare}% of gross profit`);
      if (revShare >= 10 && !tags.includes("star")) add("volume_driver", `${revShare}% of revenue`);
      if (trend != null && trend <= -20 && (prior?.revenue ?? 0) >= 1_000) add("declining", `revenue down ${Math.abs(trend)}% vs ${s.meta.comparePeriod.label}`);
      if ((trend != null && trend >= 30 && revenue >= 500) || (!prior && revenue >= 1_000)) add("emerging", trend != null ? `revenue up ${trend}% vs prior period` : "new this period with material sales");
      if (stockTracked && pos && (pos.isLow || pos.onHand < 0)) {
        add("stock_risk", pos.onHand < 0 ? "negative recorded stock" : "at or under its low-stock threshold");
        if (revShare >= 5) add("review_purchasing", `top seller (${revShare}% of revenue) with stock risk — restock before it gaps (tolerance ${stockTol} days)`);
      }
    }

    if (tags.length === 0) add("data_insufficient", "no classification threshold met — unremarkable in this period");

    // shelf review flags come from the shelf model; placeholder resolved below
    const primary = tags[0];
    const ACTION: Partial<Record<ProductTag, [string, string]>> = {
      star: ["Protect availability and placement — this product carries the portfolio.", "remains ≥5% of revenue at ≥median margin next period"],
      high_volume_low_margin: ["Review its price or purchase cost — volume is proven, economics lag.", `margin at or above the ${marginFloor}% floor next period`],
      low_volume_high_margin: ["Give it better placement/visibility for two weeks and watch velocity.", "revenue share up ≥1 point without margin loss"],
      weak: ["Consider phasing out or repositioning; free the space for movers.", "either revenue share >3% or product deactivated"],
      declining: ["Check availability, price and placement — find why it's fading.", "decline stops (trend ≥ −5%) next period"],
      emerging: ["Ensure stock and placement support its growth.", "growth persists a second period"],
      stock_risk: ["Restock now.", "stock above its low threshold"],
      cost_unknown: ["Record its cost (invoice or estimate flagged as estimate).", "cost recorded; margin measurable"],
      dormant: ["Confirm whether it's discontinued; deactivate or restock deliberately.", "either a sale is recorded or the product is deactivated"],
      review_pricing: ["Run the pricing review below.", `margin at or above ${marginFloor}%`],
      review_purchasing: ["Run the purchase review below.", "stock above threshold"],
      data_insufficient: ["No action — not enough signal this period.", "≥3 sale days in a period"],
    };
    const [action, resolution] = ACTION[primary] ?? ACTION.data_insufficient!;

    out.push({
      name, tags, reasons,
      revenue: r0(revenue), grossProfit: p?.grossProfit ?? null, marginPct: p?.marginPct ?? null,
      daysSold: p?.daysSold ?? 0, frequencyPct: freq, trendPct: trend,
      revenueSharePct: revShare, gpSharePct: gpShare,
      onHand: stockTracked ? pos?.onHand ?? null : null,
      coveragePct: r1(covP),
      confidence: p ? conf : "medium",
      recommendedAction: action, resolutionCriteria: resolution,
    });
  };

  for (const p of cur) classify(p);
  for (const d of dormantCandidates) classify(null, d);
  out.sort((a, b) => b.revenue - a.revenue);

  return {
    available: true, period,
    classifications: out,
    thresholds: [
      { name: "gross-margin floor", value: `${marginFloor}%`, basis: ownerBasis(ctx.grossMarginFloorPct) },
      { name: "median portfolio margin", value: `${r1(medianMargin)}%`, basis: "derived" },
      { name: "dead-stock threshold", value: `${deadDays} days`, basis: ownerBasis(ctx.deadStockDays) },
      { name: "stockout tolerance", value: `${stockTol} days`, basis: ownerBasis(ctx.stockoutToleranceDays) },
    ],
  };
}

/* ═══ SHELF PRIORITY ══════════════════════════════════════════════════ */

export type ShelfVerdict = "expand_consideration" | "maintain" | "reduce_consideration" | "investigate" | "insufficient_data";
export interface ShelfPriority {
  name: string; score: number; verdict: ShelfVerdict; why: string; caveat: string;
}

export function shelfPriorities(portfolio: PortfolioAnalysis): ShelfPriority[] {
  if (!portfolio.available) return [];
  const caveat = "relative priority only — shelf dimensions are not recorded, so this is not a physical allocation";
  return portfolio.classifications
    .filter((c) => !c.tags.includes("dormant"))
    .map((c) => {
      const gp = c.gpSharePct ?? 0;
      const score = r0(
        gp * 3 + c.revenueSharePct * 2 + (c.marginPct ?? 0) * 0.3 +
        c.frequencyPct * 0.3 + Math.max(-20, Math.min(20, c.trendPct ?? 0)) * 0.5,
      );
      let verdict: ShelfVerdict; let why: string;
      if (c.tags.includes("data_insufficient") || c.tags.includes("cost_unknown")) {
        verdict = "insufficient_data"; why = c.reasons[0];
      } else if ((c.tags.includes("star") || c.tags.includes("low_volume_high_margin") || c.tags.includes("emerging")) && gp >= 3) {
        verdict = "expand_consideration"; why = `${gp}% of gross profit, sells on ${c.frequencyPct}% of days${c.trendPct != null && c.trendPct > 0 ? `, growing ${c.trendPct}%` : ""}`;
      } else if (c.tags.includes("weak") || c.tags.includes("declining")) {
        verdict = c.tags.includes("declining") ? "investigate" : "reduce_consideration";
        why = c.reasons[0];
      } else {
        verdict = "maintain"; why = `steady contributor (${c.revenueSharePct}% of revenue)`;
      }
      return { name: c.name, score, verdict, why, caveat };
    })
    .sort((a, b) => b.score - a.score);
}

/* ═══ PRICING REVIEW ══════════════════════════════════════════════════ */

export interface PricingReview {
  name: string;
  observedPrice: number | null;    // revenue / units this period
  listPrice: number | null;
  unitCost: number | null;
  marginPct: number | null;
  targetMarginPct: number;
  breakEvenPrice: number | null;
  priceForTargetMargin: number | null;
  demandContext: string;
  risk: string;
  signals: string[];
  confidence: FindingConfidence;
  missing: string[];
}

export function pricingReviews(s: StrategistSnapshot): PricingReview[] {
  if (!(s.context.allowPriceRecommendations.value ?? true)) return [];
  const cur = s.products.detail.value ?? [];
  const covP = s.products.detail.completeness ?? 0;
  if (covP < MIN_ATTRIBUTION_COVERAGE) return [];
  const target = s.context.grossMarginFloorPct.value ?? 25;
  const posBy = new Map((s.products.positions.value ?? []).map((p) => [p.name, p]));
  const periodDays = s.products.periodDays.value ?? 30;

  const out: PricingReview[] = [];
  for (const p of cur) {
    if (p.revenue < 500) continue;
    const pos = posBy.get(p.name);
    const observed = p.units > 0 ? r1(p.revenue / p.units) : null;
    const unitCost = p.units > 0 && !p.missingCost && p.cogs > 0 ? r1(p.cogs / p.units) : (pos?.hasCost ? r1(pos.avgCost) : null);
    const signals: string[] = [];
    const missing: string[] = [];

    if (p.marginPct != null && p.marginPct < target) signals.push(`margin ${p.marginPct}% is below the ${target}% target`);
    if (p.marginPct == null) missing.push("recorded cost (margin unknowable)");
    if (observed != null && pos?.sellingPrice != null && Math.abs(observed - pos.sellingPrice) / pos.sellingPrice > 0.1) {
      signals.push(`observed selling price ${egp(observed)} differs >10% from the list price ${egp(pos.sellingPrice)} — check the scale/POS price`);
    }
    if (p.marginPct != null && p.marginPct < target && p.daysSold >= periodDays * 0.5) {
      signals.push(`high demand (${p.daysSold} sale days) with weak margin — volume is carrying poor economics`);
    }
    if (signals.length === 0) continue;

    out.push({
      name: p.name,
      observedPrice: observed,
      listPrice: pos?.sellingPrice ?? null,
      unitCost,
      marginPct: p.marginPct,
      targetMarginPct: target,
      breakEvenPrice: unitCost != null ? r1(unitCost) : null,
      priceForTargetMargin: unitCost != null ? r1(unitCost / (1 - target / 100)) : null,
      demandContext: `${p.daysSold} of ${periodDays} trading days · ${r1(p.units)} units · ${egp(p.revenue)}`,
      risk: "demand response unknown — no historical price-response data exists; test before full rollout",
      signals,
      confidence: p.marginPct != null ? (covP >= 90 ? "high" : "medium") : "low",
      missing,
    });
  }
  return out.sort((a, b) => (b.signals.length - a.signals.length) || 0).slice(0, 8);
}

/* ═══ PURCHASE REVIEW ═════════════════════════════════════════════════ */

export interface PurchaseReview {
  name: string;
  onHand: number | null;
  velocityPerDay: number | null;   // units per trading day this period
  daysCover: number | null;
  urgency: "now" | "this_week" | "monitor" | "data_first";
  kind: "stockout_risk" | "excess_stock" | "no_stock_position" | "weak_mover";
  why: string;
  nextStep: string;
  confidence: FindingConfidence;
}

export function purchaseReviews(s: StrategistSnapshot): PurchaseReview[] {
  const cur = s.products.detail.value ?? [];
  const covP = s.products.detail.completeness ?? 0;
  if (covP < MIN_ATTRIBUTION_COVERAGE || cur.length === 0) return [];
  const periodDays = s.products.periodDays.value ?? 30;
  const tol = s.context.stockoutToleranceDays.value ?? 7;
  const maxCover = s.context.maxStockCoverDays.value ?? 45;
  const stockTracked = s.inventory.hasLiveData;
  const posBy = new Map((s.products.positions.value ?? []).map((p) => [p.name, p]));
  const totalRev = cur.reduce((a, p) => a + p.revenue, 0) || 1;

  const out: PurchaseReview[] = [];
  for (const p of cur) {
    const share = (p.revenue / totalRev) * 100;
    const velocity = p.units > 0 && periodDays > 0 ? r1(p.units / periodDays) : null;
    const pos = posBy.get(p.name);

    if (!stockTracked) {
      if (share >= 8) {
        out.push({
          name: p.name, onHand: null, velocityPerDay: velocity, daysCover: null,
          urgency: "data_first", kind: "no_stock_position",
          why: `${r1(share)}% of revenue but its stock position is untracked — a stockout would be invisible until sales gap`,
          nextStep: `Record a physical count for ${p.name} (Settings → Opening balances) — then days-of-cover becomes computable`,
          confidence: "high", // high confidence that the DATA action is right
        });
      }
      continue;
    }
    if (!pos || velocity == null) continue;
    const cover = velocity > 0 ? r1(pos.onHand / velocity) : null;
    if (cover != null && cover < tol && share >= 3) {
      out.push({
        name: p.name, onHand: pos.onHand, velocityPerDay: velocity, daysCover: cover,
        urgency: cover < tol / 2 ? "now" : "this_week", kind: "stockout_risk",
        why: `~${cover} days of cover at current velocity (${velocity}/day), below your ${tol}-day tolerance`,
        nextStep: `Reorder ${p.name} — at ${velocity}/day you need roughly ${r0(velocity * (tol + 7))} units to cover ${tol + 7} days (assumes ~7-day lead time; confirm with the vendor)`,
        confidence: "medium",
      });
    } else if (cover != null && cover > maxCover && share < 3) {
      out.push({
        name: p.name, onHand: pos.onHand, velocityPerDay: velocity, daysCover: cover,
        urgency: "monitor", kind: "excess_stock",
        why: `~${cover} days of cover on a slow mover (${r1(share)}% of revenue) — cash parked on the shelf, freshness at risk`,
        nextStep: `Pause purchases of ${p.name}; consider promotion or reduced facing`,
        confidence: "medium",
      });
    }
  }
  const order = { now: 0, this_week: 1, data_first: 2, monitor: 3 };
  return out.sort((a, b) => order[a.urgency] - order[b.urgency]).slice(0, 8);
}
