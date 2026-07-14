/** Reference domain engines (Cycle 10 boundary work, expanded Cycle 13). The
 *  SHARED Retail Reasoning framework comes first; each engine below is a thin
 *  selector over the shared knowledge library + candidate intake (no
 *  duplicated reasoning) — the contract every future domain engine follows.
 *
 *  Domain ownership is a clean partition: each RetailDomain belongs to exactly
 *  one engine so two engines never surface the same finding. Pricing content
 *  lives inside Margin Intelligence (a below-floor margin and a price review
 *  are the same decision in this system) — Promotion Intelligence, not a
 *  second "Pricing" engine, completes the original candidate list without
 *  creating overlapping ownership. */
import type { RetailBusinessFacts, RetailRecommendation, RetailDomain } from "./contract";
import { buildDeterministicCandidates } from "./reasoning";
import { ingestCandidates, type Candidate, type IngestOptions } from "./candidates";

export interface RetailDomainEngine {
  id: string;
  title: string;
  domains: RetailDomain[];
  /** deterministic — emits validated, ranked recommendations for its domains */
  analyze(f: RetailBusinessFacts, opts: IngestOptions): RetailRecommendation[];
}

function candidatesForDomains(f: RetailBusinessFacts, domains: RetailDomain[]): Candidate[] {
  const set = new Set<RetailDomain>(domains);
  return buildDeterministicCandidates(f).filter((c) => set.has(c.draft.domain));
}

/** MARGIN INTELLIGENCE — owns gross-profit and price-to-margin reasoning. */
export const marginIntelligence: RetailDomainEngine = {
  id: "margin-intelligence",
  title: "Margin Intelligence",
  domains: ["margin", "pricing"],
  analyze: (f, opts) => ingestCandidates(candidatesForDomains(f, ["margin", "pricing"]), f, opts).accepted,
};

/** MERCHANDISING / PACKAGING INTELLIGENCE — owns space, presentation and pack
 *  format reasoning. */
export const merchandisingPackagingIntelligence: RetailDomainEngine = {
  id: "merchandising-packaging-intelligence",
  title: "Merchandising & Packaging Intelligence",
  domains: ["merchandising", "shelf", "packaging"],
  analyze: (f, opts) => ingestCandidates(candidatesForDomains(f, ["merchandising", "shelf", "packaging"]), f, opts).accepted,
};

/** PROMOTION INTELLIGENCE — bundles, thresholds, and when NOT to discount. */
export const promotionIntelligence: RetailDomainEngine = {
  id: "promotion-intelligence",
  title: "Promotion Intelligence",
  domains: ["promotion"],
  analyze: (f, opts) => ingestCandidates(candidatesForDomains(f, ["promotion"]), f, opts).accepted,
};

/** SUPPLIER INTELLIGENCE — concentration risk, negotiation leverage, sourcing.
 *  Quantity-break and lead-time timing currently live under "purchase" (they're
 *  purchase-timing decisions as much as supplier ones); this engine owns the
 *  supplier-relationship-specific reasoning. */
export const supplierIntelligence: RetailDomainEngine = {
  id: "supplier-intelligence",
  title: "Supplier Intelligence",
  domains: ["supplier"],
  analyze: (f, opts) => ingestCandidates(candidatesForDomains(f, ["supplier"]), f, opts).accepted,
};

/** BASKET INTELLIGENCE — cross-sell and adjacency grounded in confirmed
 *  co-purchase behaviour (never a fabricated basket claim). */
export const basketIntelligence: RetailDomainEngine = {
  id: "basket-intelligence",
  title: "Basket Intelligence",
  domains: ["basket"],
  analyze: (f, opts) => ingestCandidates(candidatesForDomains(f, ["basket"]), f, opts).accepted,
};

/** SEASONALITY INTELLIGENCE — Ramadan, Eid, weekend and other confirmed
 *  occasion-driven reasoning. */
export const seasonalityIntelligence: RetailDomainEngine = {
  id: "seasonality-intelligence",
  title: "Seasonality Intelligence",
  domains: ["seasonality"],
  analyze: (f, opts) => ingestCandidates(candidatesForDomains(f, ["seasonality"]), f, opts).accepted,
};

/** The reference domain engines wired so far. New domains append here. */
export const DOMAIN_ENGINES: RetailDomainEngine[] = [
  marginIntelligence,
  merchandisingPackagingIntelligence,
  promotionIntelligence,
  supplierIntelligence,
  basketIntelligence,
  seasonalityIntelligence,
];
