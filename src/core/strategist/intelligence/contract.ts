/** ═══════════════════════════════════════════════════════════════════════
 *  THE RETAIL INTELLIGENCE CONTRACT — the constitution of BostaOS in code.
 *
 *  BostaOS is a Retail Operating System with a DETERMINISTIC Retail
 *  Intelligence Engine. Intelligence exists with zero API keys, zero internet,
 *  zero external model. An external language adapter is optional FOREVER and
 *  may improve wording only — never thinking.
 *
 *  Ownership chain:
 *    Business Engine → Retail Intelligence Engine → Decision Engine →
 *    Recommendation Engine → deterministic NLG → (optional external adapter)
 *
 *  EVERY specialist domain engine (Revenue, Margin, Pricing, Promotion,
 *  Inventory, Purchase, Supplier, Category, Shelf, Basket, Seasonality,
 *  Merchandising, Cash, Cheque, Operational, Growth, Risk, Decision,
 *  Recommendation …) MUST emit the SAME 11-field contract below — no
 *  exceptions. The deterministic NLG (intelligence/nlg.ts) is the PRIMARY
 *  reporting system and consumes ONLY these structured findings.
 *  ═══════════════════════════════════════════════════════════════════════ */
import type { Evidence, FindingConfidence, Urgency } from "../analysis/types";

export type { Evidence, FindingConfidence, Urgency } from "../analysis/types";

/** The specialist domains. One engine owns exactly one domain. */
export type RetailDomain =
  | "revenue" | "margin" | "pricing" | "promotion" | "inventory" | "purchase" | "packaging"
  | "supplier" | "category" | "shelf" | "basket" | "seasonality" | "merchandising"
  | "cash" | "cheque" | "operational" | "growth" | "risk" | "decision" | "recommendation";

/** THE contract. Every domain engine emits this shape — no exceptions.
 *  The eleven mandated fields are marked; the rest is routing metadata. */
export interface DomainFinding {
  /* ── routing metadata ── */
  id: string;                         // stable slug
  domain: RetailDomain;
  headline: string;                   // short title for lists
  urgency: Urgency;
  impactEgp: number | null;           // EGP at stake; null when unquantifiable
  screenLink: string;

  /* ── the eleven mandated fields ── */
  finding: string;                    // 1. WHAT happened
  driver: string;                     // 2. WHY / what caused it
  evidence: Evidence[];               // 3. audited numbers, copied verbatim
  businessContext: string;            // 4. the retail context that makes it matter
  risk: string | null;                // 5. what could happen if ignored
  opportunity: string | null;         // 6. the upside
  recommendation: string;             // 7. what to ACTUALLY do
  expectedBenefit: string;            // 8. quantified where the data allows
  successCriteria: string;            // 9. how we know it worked
  confidence: FindingConfidence;      // 10. the confidence CEILING
  blockingInformation: string[];      // 11. what's missing before acting
}

/** A domain engine's output for a period. */
export interface IntelligenceReport {
  engine: string;                     // engine id, e.g. "margin-intelligence"
  domain: RetailDomain;
  period: string;                     // the period label the findings cover
  findings: DomainFinding[];
}

/** The interface every specialist engine implements. Deterministic by
 *  contract: `analyze` NEVER calls a model — it produces the canonical
 *  findings purely from trusted inputs. */
export interface DomainEngine<TInput = unknown> {
  id: string;
  domain: RetailDomain;
  analyze(input: TInput): DomainFinding[];
}

/** Runtime completeness guard — asserts a value satisfies the 11-field
 *  contract. Used by tests and engine authors to prove compliance. Returns the
 *  list of missing/empty mandated fields (empty array = compliant). */
export function contractViolations(f: Partial<DomainFinding>): string[] {
  const out: string[] = [];
  const need = (k: keyof DomainFinding) => { if (f[k] === undefined || f[k] === null || f[k] === "") out.push(String(k)); };
  need("finding"); need("driver"); need("businessContext");
  need("recommendation"); need("expectedBenefit"); need("successCriteria"); need("confidence");
  if (!Array.isArray(f.evidence)) out.push("evidence");
  if (!Array.isArray(f.blockingInformation)) out.push("blockingInformation");
  // risk and opportunity are allowed to be null (a fact may carry neither), but
  // a finding with BOTH null and no recommendation would be inert — guard that.
  if (f.risk == null && f.opportunity == null && (!f.recommendation || f.recommendation === "")) out.push("risk|opportunity|recommendation");
  return out;
}

export const RETAIL_DOMAINS: RetailDomain[] = [
  "revenue", "margin", "pricing", "promotion", "inventory", "purchase", "packaging", "supplier",
  "category", "shelf", "basket", "seasonality", "merchandising", "cash", "cheque",
  "operational", "growth", "risk", "decision", "recommendation",
];
