/** Reference domain engines (Cycle 10 boundary work). Per the directive, the
 *  SHARED Retail Reasoning framework comes first; these are the first two
 *  reference implementations on top of it — Margin Intelligence and
 *  Merchandising/Packaging Intelligence. Each is a thin selector over the shared
 *  knowledge library + candidate intake (no duplicated reasoning), proving the
 *  contract that every future domain engine (Pricing, Inventory, Supplier, …)
 *  will follow. */
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

/** The reference domain engines wired so far. New domains append here. */
export const DOMAIN_ENGINES: RetailDomainEngine[] = [
  marginIntelligence,
  merchandisingPackagingIntelligence,
];
