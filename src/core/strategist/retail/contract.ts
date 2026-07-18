/** ═══════════════════════════════════════════════════════════════════════
 *  RETAIL REASONING — contracts (Cycle 10).
 *
 *  Combines trusted business facts + structured FMCG knowledge + grounded
 *  reasoning into SPECIFIC, commercially useful recommendations, with ZERO API
 *  keys. Builds on the constitution in `intelligence/contract.ts`.
 *
 *  Three levels of truth are always visible:
 *    measured_conclusion  — directly supported by BostaOS data
 *    strong_inference     — several facts support it; causation not proven
 *    experiment_hypothesis— a grounded retail strategy worth TESTING
 *  ═══════════════════════════════════════════════════════════════════════ */
import type { Evidence, FindingConfidence, RetailDomain } from "../intelligence/contract";

export type { Evidence, FindingConfidence, RetailDomain } from "../intelligence/contract";

export type TruthLevel = "measured_conclusion" | "strong_inference" | "experiment_hypothesis";

/** The trading seasons that actually move a nut & snack stand in Egypt. */
export type RetailSeason = "ramadan" | "eid" | "gifting" | "back_to_school" | "winter_nuts" | "summer_slow";

/** Where a recommendation came from — always shown to the owner. A model may
 *  author a candidate, but it enters through the SAME deterministic validation
 *  gate and can never be labelled a measured conclusion. */
export type RecommendationSource = "deterministic_knowledge" | "bosta_experiment" | "model_reasoning";

/** The specific commercial moves the engine can propose. */
export type RecommendationType =
  // merchandising
  | "increase_facings" | "reduce_facings" | "relocate" | "change_shelf_level"
  | "improve_adjacency" | "separate_premium" | "premium_display_block" | "impulse_display" | "review_display_space"
  // packaging
  | "mini_bag_test" | "grab_and_go" | "premium_pouch" | "gift_format"
  | "smaller_entry_size" | "larger_value_size" | "prepacked_vs_weighted"
  // portfolio
  | "expand" | "maintain" | "reduce_exposure" | "pause_purchasing" | "discontinue_review"
  | "bundle" | "cross_sell" | "reposition" | "collect_evidence"
  // pricing
  | "review_price" | "test_price_increase" | "test_smaller_pack" | "restore_margin"
  | "protect_traffic" | "avoid_price_change_mix"
  // purchasing
  | "buy_now" | "buy_after_cheque" | "reduce_next_order" | "count_first"
  | "negotiate_tier" | "split_orders" | "avoid_exceed_cover" | "meet_qty_break"
  // promotions
  | "bundle_test" | "threshold_offer" | "cross_category_offer" | "limited_time_test"
  | "avoid_discount_strong" | "weak_as_addon";

/* ── business facts ─────────────────────────────────────────────────────── */

/** Everything the reasoning engine knows about one product. Optional fields are
 *  null when not recorded — the engine states "needs this observation" and
 *  never fabricates a physical layout it can't see. */
export interface ProductFact {
  id: string | null;
  name: string;
  category: string | null;
  revenue: number;
  grossProfit: number | null;
  marginPct: number | null;
  units: number;
  cogs: number;
  daysSold: number;                 // active selling days in period
  velocityPerDay: number | null;    // units / active day
  revenueSharePct: number;          // % of period revenue
  profitSharePct: number | null;    // % of period gross profit
  growthPct: number | null;         // vs comparison period (revenue)
  /** margin percentage-POINT change vs the comparison period (cost-rise signal) */
  marginDeltaPts: number | null;
  // live position
  onHand: number | null;
  inventoryValue: number | null;
  inventorySharePct: number | null;
  daysCover: number | null;
  sellingPrice: number | null;
  avgCost: number;                  // 0 = unknown
  hasCost: boolean;
  isLow: boolean;
  vendor: string | null;
  // optional structured merchandising / packaging (null when unrecorded)
  packagingFormat: string | null;
  packSizeG: number | null;
  packagingCost: number | null;
  displayZone: string | null;
  shelfLevel: string | null;
  facings: number | null;
  tier: "premium" | "standard" | "value" | null;
  impulseType: "impulse" | "destination" | null;
  minOrderQty: number | null;
  supplierLeadDays: number | null;
  quantityBreaks: { minQty: number; unitCost: number }[] | null;
  // owner-confirmed category facts (from the interview) — distinct from derived
  doNotDiscontinue: boolean;
  ownerTrafficDriver: boolean;
}

/* ── the objective ──────────────────────────────────────────────────────────
 *  BostaOS has ONE goal: grow revenue and cut cost without cheapening the
 *  brand. Every recommendation is ranked by what it is WORTH, never by how
 *  complete the books are. Thin data lowers certainty and is disclosed — it
 *  never silences the advice.                                                */

/** What a move is worth per month, and WHY that number exists.
 *
 *  `basis` is mandatory and must state the actual arithmetic in the owner's
 *  own terms ("40 dead facings × your 71 EGP/facing/month main-table
 *  average"). A number without traceable arithmetic is a fabrication and is
 *  rejected by the gate — the owner's standing rule is no invented data. */
export interface ImpactEstimate {
  /** monthly EGP the move is expected to add (revenue) or save (cost) */
  monthlyEgp: number;
  /** the arithmetic, in plain words — always shown next to the number */
  basis: string;
  /** measured  = computed purely from recorded BostaOS numbers
   *  arithmetic= his own numbers extrapolated to an unused asset/format
   *  directional = a real effect with no local number yet; magnitude unproven */
  kind: "measured" | "arithmetic" | "directional";
  /** revenue growth vs cost reduction — the two halves of the objective */
  lever: "revenue" | "cost";
}

/** Effect on how the brand reads on the shelf. Premium permission is an asset:
 *  a move that earns money by cheapening presentation is penalised, and one
 *  that would visibly damage the brand is blocked outright. */
export type BrandEffect = "builds" | "neutral" | "risks";

/* ── the physical branch (Gardenia) ─────────────────────────────────────── */

/** One selling zone of the actual stand — the fixtures, not the books. */
export interface ZoneFact {
  key: string;
  name: string;
  /** premium_impulse | impulse | value_volume | opportunity | adjacent | removed */
  tier: string;
  /** high | aisle_end | passing | destination */
  traffic: string;
  facings: number;
  lit: boolean;
  branded: boolean;
  signage: string | null;
  notes: string | null;
  active: boolean;
}

/** A standing observation about the branch, from the owner's own photo audit. */
export interface LocationObservationFact {
  category: string;
  severity: string;              // critical | major | minor | strength
  finding: string;
  recommendation: string | null;
}

/** The branch's operating reality — what the owner may and may not change. */
export interface LocationProfileFact {
  operatingModel: string | null;
  pricingControl: string | null;
  brandAssets: string | null;
  equipment: string | null;
  constraints: string | null;
}

/** A packaging format the owner has confirmed they offer + its economics. */
export interface OfferedPackaging {
  type: string;                 // 'mini_bag' | 'pouch' | 'gift' | 'grab_and_go' | ...
  name: string;
  hasCost: boolean;             // package + prep + label/seal cost recorded
  totalUnitCost: number | null;
  giftingSuitable: boolean;
  impulseSuitable: boolean;
  premiumScore: number | null;
}

/** The provider-neutral facts aggregate. Assembled from the audited snapshot +
 *  read models; never invents fields. */
export interface RetailBusinessFacts {
  period: string;
  comparePeriod: string;
  products: ProductFact[];
  totalRevenue: number;
  totalGrossProfit: number | null;
  coveragePct: number | null;        // product-line coverage
  inventoryTracked: boolean;
  stockCountAgeDays: number | null;
  cashCountFresh: boolean;
  // owner targets / constraints
  marginFloorPct: number | null;
  maxCoverDays: number | null;
  deadStockDays: number | null;
  strategicProducts: string[];
  // cash / timing
  cashForPurchases: number | null;   // verified affordable spend; null = unknown
  nextChequeEta: string | null;
  /** the retail season LIVE today (null = ordinary trading) */
  season: RetailSeason | null;
  /** the next season worth preparing for, and how long there is to prepare —
   *  buying and packing decisions need lead time, so the strategist plans
   *  forward instead of only reacting when the peak has already arrived */
  nextSeason: { season: RetailSeason; name: string; startsOn: string; weeksAway: number } | null;
  // the physical branch
  zones: ZoneFact[];
  observations: LocationObservationFact[];
  locationProfile: LocationProfileFact | null;
  // owner interview context
  offeredPackaging: OfferedPackaging[];
  allowedPromotions: string[];
  allowedDisplayChanges: string[];
  customerOccasions: string[];
  operationalConstraints: string[];
  commonlyBoughtTogether: [string, string][];
  // freshness
  isStale: boolean;
  staleDays: number | null;
  basisNote: string;
}

/* ── knowledge library ──────────────────────────────────────────────────── */

export type KnowledgeBasis = "retail_math" | "owner_confirmed" | "retail_heuristic" | "bosta_experiment";

/** A typed retail playbook. Metadata describes the principle; `match`/`build`
 *  are its deterministic implementation. NEVER a prompt. */
export interface KnowledgePlaybook {
  id: string;
  domain: RetailDomain;
  title: string;
  principle: string;
  conditions: string;
  requiredEvidence: string[];
  contraindications: string[];
  mechanism: string;
  actionTypes: RecommendationType[];
  expectedBenefitType: string;
  risks: string[];
  testDesign: string;
  minTestDurationDays: number;
  successMetrics: string[];
  failureMetrics: string[];
  confidenceCeiling: FindingConfidence;
  basis: KnowledgeBasis;
  version: number;
  /** Executive-knowledge metadata (Executive Retail Knowledge Directive). Optional
   *  so earlier playbooks stay valid; new board-level playbooks populate them. */
  rationale?: string;                    // why this principle holds, commercially
  whenApplicable?: string;               // the situations it fits
  whenNotApplicable?: string;            // where it must NOT be applied
  assumptions?: string[];
  kpis?: string[];                       // measurable KPIs it moves
  reviewCadenceDays?: number;            // how often to re-check
  relatedPrinciples?: string[];          // playbook ids of related principles
  /** per-product: fires for a product when its conditions hold (pure) */
  match?: (p: ProductFact, f: RetailBusinessFacts) => boolean;
  /** per-product: builds a recommendation draft from a matched product (pure) */
  build?: (p: ProductFact, f: RetailBusinessFacts) => RecommendationDraft | null;
  /** portfolio-level: cross-product reasoning, run once over all facts (pure) */
  global?: (f: RetailBusinessFacts) => RecommendationDraft[];
}

/* ── recommendations ────────────────────────────────────────────────────── */

export interface RetailRecommendation {
  id: string;
  dedupeKey: string;
  playbookId: string;
  title: string;
  domain: RetailDomain;
  type: RecommendationType;
  affectedProducts: string[];
  affectedProductIds: string[];
  affectedCategory: string | null;
  affectedLocation: string | null;
  observedFacts: string[];
  principles: string[];
  reasoning: string[];
  truthLevel: TruthLevel;
  proposedAction: string;
  implementationSteps: string[];
  timing: string;
  durationDays: number | null;
  effort: "low" | "medium" | "high";
  mechanism: string;
  expectedBenefitType: string;
  financialImpactEgp: number | null;    // only when deterministically calculable
  /** what this move is worth per month + the arithmetic behind it. This — not
   *  data completeness — is what ranks the owner's list. */
  impact: ImpactEstimate | null;
  /** does the move build, preserve, or cheapen the brand on the shelf */
  brandEffect: BrandEffect;
  risks: string[];
  contraindications: string[];
  assumptions: string[];
  missingInformation: string[];
  /** ONE thing the owner could record to make this number sharper. Advisory
   *  only — it is never a reason to withhold the recommendation. */
  sharpenWith: string | null;
  confidence: FindingConfidence;
  confidenceCeiling: FindingConfidence;
  evidence: Evidence[];
  screenLink: string;
  testDesign: string | null;
  baselineMetrics: string[];
  successCriteria: string[];
  failureCriteria: string[];
  stopCondition: string | null;
  reviewDate: string | null;
  persistEligible: boolean;
  priorityScore: number;
  /** provenance — deterministic knowledge, a prior Bosta experiment, or model reasoning */
  source: RecommendationSource;
}

/** What a playbook's `build` returns; the engine finalises id/dedupe/review/
 *  confidence-ceiling/priority. */
export type RecommendationDraft = Omit<RetailRecommendation,
  "id" | "dedupeKey" | "reviewDate" | "persistEligible" | "confidenceCeiling" | "priorityScore" | "playbookId" | "source">;

/* ── experiments ────────────────────────────────────────────────────────── */

export interface Experiment {
  id?: string;
  playbookId: string | null;
  title: string;
  domain: string;
  recType: string;
  productIds: string[];
  location: string | null;
  changeDescription: string;
  startDate: string | null;
  endDate: string | null;
  baseline: Record<string, number> | null;
  primaryMetric: string;
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  minSample: string | null;
  successThreshold: string | null;
  failureThreshold: string | null;
  stopCondition: string | null;
  status: "proposed" | "running" | "complete" | "abandoned";
  result: Record<string, number> | null;
  conclusion: string | null;
  attributionConfidence: "strong" | "moderate" | "weak" | "inconclusive" | null;
  decision: "keep" | "modify" | "reverse" | null;
  ownerNotes: string | null;
}
