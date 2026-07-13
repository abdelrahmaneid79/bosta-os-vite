/** Purchase quantity engine + cash-aware purchasing — PURE (Cycle 8).
 *
 *  Activates ONLY with reliable data: consistent units, live stock, enough
 *  sales velocity, a lead time (confirmed or clearly estimated). Otherwise it
 *  refuses with the exact data action. It never bypasses cash safety — a
 *  needed product can still be unaffordable. Never auto-creates a purchase. */
import type { StrategistSnapshot } from "../contract";
import type { FindingConfidence } from "./types";
import type { CashState } from "./cash";
import { assessAffordability } from "./affordability";

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const egp = (n: number) => `EGP ${Math.round(n).toLocaleString("en-US")}`;

const DEFAULT_LEAD_DAYS = 7;
const MIN_VELOCITY_DAYS = 7;     // need at least this many observed sale days

export type QtyVerdict = "buy_now" | "buy_soon" | "maintain" | "do_not_buy" | "count_first" | "investigate";
export type CombinedVerdict =
  | "needed_and_affordable" | "needed_but_cash_constrained" | "affordable_not_justified"
  | "wait_for_cheque" | "count_first" | "supplier_data_required" | "unsafe";

export interface PurchaseQtyRec {
  name: string;
  verdict: QtyVerdict;
  currentStock: number | null;
  velocityPerDay: number | null;
  daysCover: number | null;
  leadTimeDays: number;
  leadTimeAssumed: boolean;
  targetCoverDays: number;
  safetyStockDays: number;
  recommendedQty: number | null;
  estimatedCost: number | null;
  confidence: FindingConfidence;
  reason: string;
  blockers: string[];
  /** cash-aware layer */
  combined: CombinedVerdict;
  affordabilityNote: string;
}

export interface PurchasePlan {
  available: boolean;
  reason?: string;
  recommendations: PurchaseQtyRec[];
  assumptions: string[];
}

export function buildPurchasePlan(s: StrategistSnapshot, cash: CashState): PurchasePlan {
  const stockTracked = s.inventory.hasLiveData;
  const cov = s.products.detail.completeness ?? 0;
  const assumptions: string[] = [];

  if (cov < 60) {
    return { available: false, reason: `product-line coverage ${r1(cov)}% is too low to size purchases`, recommendations: [], assumptions: [] };
  }
  if (!stockTracked) {
    // still return the count-first recommendations for the top movers
    const top = (s.products.detail.value ?? []).slice().sort((a, b) => b.revenue - a.revenue).slice(0, 6);
    return {
      available: true,
      reason: "inventory is untracked — quantities need a stock count first",
      recommendations: top.map((p) => ({
        name: p.name, verdict: "count_first", currentStock: null, velocityPerDay: p.units > 0 ? r1(p.units / (s.products.periodDays.value ?? 30)) : null,
        daysCover: null, leadTimeDays: DEFAULT_LEAD_DAYS, leadTimeAssumed: true, targetCoverDays: 0, safetyStockDays: 0,
        recommendedQty: null, estimatedCost: null, confidence: "high",
        reason: "sells steadily but its stock position is unknown", blockers: ["no stock count"],
        combined: "count_first", affordabilityNote: "size and affordability come after the first count",
      })),
      assumptions: [],
    };
  }

  const periodDays = s.products.periodDays.value ?? 30;
  const tol = s.context.stockoutToleranceDays.value ?? 7;
  const leadDays = DEFAULT_LEAD_DAYS;
  assumptions.push(`lead time assumed ${leadDays} days (confirm with the vendor)`);
  const seasonal = false; // calendar overlap handled upstream; run-rate excludes unusual days
  const posBy = new Map((s.products.positions.value ?? []).map((p) => [p.name, p]));

  const recs: PurchaseQtyRec[] = [];
  for (const p of s.products.detail.value ?? []) {
    const pos = posBy.get(p.name);
    if (!pos) continue;
    const velocity = p.units > 0 && periodDays > 0 ? r1(p.units / periodDays) : null;
    const blockers: string[] = [];
    if (p.daysSold < MIN_VELOCITY_DAYS) blockers.push(`only ${p.daysSold} sale days — not enough velocity signal`);
    if (velocity == null || velocity <= 0) blockers.push("no measurable velocity");
    const cover = velocity != null && velocity > 0 ? r1(pos.onHand / velocity) : null;

    let verdict: QtyVerdict;
    let qty: number | null = null;
    if (blockers.length) verdict = "investigate";
    else if (cover != null && cover < tol) {
      verdict = cover < tol / 2 ? "buy_now" : "buy_soon";
      const targetCover = tol + leadDays;   // cover the lead time + tolerance
      qty = r0(Math.max(0, velocity! * targetCover - pos.onHand));
    } else if (cover != null && cover > (s.context.maxStockCoverDays.value ?? 45)) {
      verdict = "do_not_buy";
    } else {
      verdict = "maintain";
    }

    const estCost = qty != null && pos.hasCost ? r0(qty * pos.avgCost) : null;

    // cash-aware overlay — never bypasses safety
    let combined: CombinedVerdict = "affordable_not_justified";
    let affNote = "not operationally due";
    if (verdict === "buy_now" || verdict === "buy_soon") {
      if (estCost == null) { combined = "supplier_data_required"; affNote = "cost unknown — record it to size the spend"; }
      else {
        const aff = assessAffordability(s, cash, { kind: "purchase", upfront: estCost, mandatory: false, label: `restock ${p.name}` });
        if (aff.verdict === "unknowable") { combined = "count_first"; affNote = "affordability unknowable until the drawer is counted"; }
        else if (aff.verdict === "unsafe") { combined = "unsafe"; affNote = `${egp(estCost)} breaks the reserve — needed but can't afford it now`; }
        else if (aff.verdict === "conditional") { combined = "wait_for_cheque"; affNote = `affordable only once the expected cheque lands`; }
        else if (aff.verdict === "tight") { combined = "needed_but_cash_constrained"; affNote = `affordable but tight (${egp(estCost)})`; }
        else { combined = "needed_and_affordable"; affNote = `needed and affordable (${egp(estCost)}, reserve intact)`; }
      }
    } else if (verdict === "do_not_buy") { combined = "affordable_not_justified"; affNote = "overstocked — hold"; }

    recs.push({
      name: p.name, verdict,
      currentStock: r1(pos.onHand), velocityPerDay: velocity, daysCover: cover,
      leadTimeDays: leadDays, leadTimeAssumed: true,
      targetCoverDays: tol + leadDays, safetyStockDays: tol,
      recommendedQty: qty, estimatedCost: estCost,
      confidence: seasonal ? "low" : cov >= 90 ? "medium" : "low",
      reason: verdict === "buy_now" ? `~${cover} days of cover, below the ${tol}-day tolerance`
        : verdict === "buy_soon" ? `~${cover} days of cover, approaching the ${tol}-day tolerance`
        : verdict === "do_not_buy" ? `~${cover} days of cover — well above target`
        : verdict === "investigate" ? blockers.join("; ")
        : `~${cover} days of cover — adequate`,
      blockers,
      combined, affordabilityNote: affNote,
    });
  }

  const order: Record<QtyVerdict, number> = { buy_now: 0, buy_soon: 1, investigate: 2, do_not_buy: 3, count_first: 4, maintain: 5 };
  recs.sort((a, b) => order[a.verdict] - order[b.verdict]);
  return { available: true, recommendations: recs.slice(0, 10), assumptions };
}
