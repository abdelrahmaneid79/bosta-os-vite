/** Owner Knowledge Interview — PURE (Cycle 11).
 *
 *  Asks ONLY the high-value questions BostaOS cannot derive from data — the
 *  physical/commercial facts of the real Bosta Bites stand (packaging offered,
 *  facings, adjacency, traffic drivers, do-not-discontinue, supplier terms,
 *  allowed promotions, occasions). Progressive: it surfaces the few questions
 *  that would most improve advice right now, shows WHY each matters and WHAT it
 *  unlocks, allows "unknown", never re-asks a confirmed answer, and never
 *  guesses missing context. */

export type QuestionKind = "packaging_catalog" | "per_product" | "global_list" | "supplier";

export interface RetailContext {
  allowedPromotions: string[];
  allowedDisplayChanges: string[];
  customerOccasions: string[];
  operationalConstraints: string[];
  commonlyBoughtTogether: [string, string][];
  answeredKeys: string[];     // question ids the owner has addressed (incl. deliberate "unknown")
  updatedAt: string | null;
}

export const EMPTY_CONTEXT: RetailContext = {
  allowedPromotions: [], allowedDisplayChanges: [], customerOccasions: [],
  operationalConstraints: [], commonlyBoughtTogether: [], answeredKeys: [], updatedAt: null,
};

/** What the interview can see to decide what's already answered. */
export interface InterviewState {
  context: RetailContext;
  packagingCount: number;                    // packaging_formats rows
  activeProducts: number;
  productsWithFacings: number;
  productsWithZone: number;
  productsWithTier: number;
  productsWithPackaging: number;
  productsWithSupplierTerms: number;         // lead time or MOQ
  trafficDriversFlagged: number;
  doNotDiscontinueFlagged: number;
  adjacencyFlagged: number;
}

export interface InterviewQuestion {
  id: string;
  section: string;
  kind: QuestionKind;
  question: string;
  why: string;                 // why it matters
  unlocks: string[];           // what advice it enables
  priority: number;            // higher = ask sooner
  screenLink: string;
  allowUnknown: boolean;
  /** answered directly from data (owner may also mark it addressed) */
  dataAnswered: (s: InterviewState) => boolean;
}

const some = (n: number) => n > 0;
const most = (have: number, total: number) => total > 0 && have >= Math.ceil(total * 0.5);

export const INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  {
    id: "packaging_formats", section: "Packaging", kind: "packaging_catalog",
    question: "Which packaging formats do you currently offer (weighted, pre-packed, mini-bag, pouch, gift)? For each: pack size, material, and the package + label + sealing + prep cost.",
    why: "Packaging advice is only real if BostaOS knows the formats you actually offer and their true cost. Without this, mini-bag or pouch advice is guesswork.",
    unlocks: ["mini-bag tests with real economics", "premium pouch tests", "grab-and-go", "entry-price strategy", "gross profit per display position"],
    priority: 100, screenLink: "/settings/packaging", allowUnknown: false,
    dataAnswered: (s) => some(s.packagingCount),
  },
  {
    id: "product_packaging", section: "Packaging", kind: "per_product",
    question: "For each product, which packaging format(s) is it available in — loose/weighted, pre-packed, or both?",
    why: "Ties each product to its formats so packaging recommendations name the right products.",
    unlocks: ["per-product packaging recommendations", "loose-vs-prepacked comparisons"],
    priority: 80, screenLink: "/settings/packaging", allowUnknown: true,
    dataAnswered: (s) => most(s.productsWithPackaging, s.activeProducts),
  },
  {
    id: "facings", section: "Merchandising", kind: "per_product",
    question: "How many facings does each key product currently have on the stand?",
    why: "A facing recommendation ('add one facing to cashews') can only be specific if BostaOS knows today's facings.",
    unlocks: ["exact add/reduce facing recommendations", "profit per facing", "space reallocation"],
    priority: 95, screenLink: "/stock", allowUnknown: true,
    dataAnswered: (s) => most(s.productsWithFacings, s.activeProducts),
  },
  {
    id: "display_zones", section: "Merchandising", kind: "per_product",
    question: "Where is each product displayed (entrance, counter, aisle, premium block) and at which shelf level (eye, mid, low)?",
    why: "Relocation and premium-presentation advice needs to know where products sit today.",
    unlocks: ["exact relocation advice", "premium block design", "impulse placement", "eye-level strategy"],
    priority: 85, screenLink: "/stock", allowUnknown: true,
    dataAnswered: (s) => most(s.productsWithZone, s.activeProducts),
  },
  {
    id: "adjacency", section: "Merchandising", kind: "per_product",
    question: "Which products sit next to each other on the stand today?",
    why: "Adjacency advice ('place cashews beside jelly') must respect and build on the current layout.",
    unlocks: ["adjacency tests", "cross-category placement", "attachment strategy"],
    priority: 70, screenLink: "/stock", allowUnknown: true,
    dataAnswered: (s) => some(s.adjacencyFlagged),
  },
  {
    id: "traffic_drivers", section: "Category roles", kind: "per_product",
    question: "Which products are your traffic drivers — the ones customers come specifically to buy?",
    why: "Category roles change the advice: you protect traffic drivers' price and use them to pull profit products.",
    unlocks: ["traffic-vs-profit strategy", "don't-discount-traffic protection", "adjacency anchoring"],
    priority: 90, screenLink: "/stock", allowUnknown: true,
    dataAnswered: (s) => some(s.trafficDriversFlagged),
  },
  {
    id: "strategic_products", section: "Category roles", kind: "per_product",
    question: "Which products are strategically important, and which must NOT be discontinued regardless of numbers?",
    why: "BostaOS will never suggest cutting a product you've protected — it works around it instead.",
    unlocks: ["safe assortment reduction", "protected-product reasoning"],
    priority: 88, screenLink: "/stock", allowUnknown: true,
    dataAnswered: (s) => some(s.doNotDiscontinueFlagged),
  },
  {
    id: "tiers", section: "Category roles", kind: "per_product",
    question: "Which products are premium, standard, or value tier?",
    why: "Premium products get premium presentation and pouch/gift advice; value products get grab-and-go.",
    unlocks: ["premium presentation", "gift/pouch advice", "tier-appropriate merchandising"],
    priority: 75, screenLink: "/stock", allowUnknown: true,
    dataAnswered: (s) => most(s.productsWithTier, s.activeProducts),
  },
  {
    id: "supplier_terms", section: "Supplier", kind: "supplier",
    question: "For each supplier/product: lead time, minimum order quantity, and any quantity-break price tiers.",
    why: "Purchase-timing and quantity-break advice is impossible without lead times and order tiers.",
    unlocks: ["quantity-break advice", "order timing around the cheque cycle", "split-order strategy"],
    priority: 78, screenLink: "/purchases", allowUnknown: true,
    dataAnswered: (s) => most(s.productsWithSupplierTerms, s.activeProducts),
  },
  {
    id: "allowed_promotions", section: "Constraints", kind: "global_list",
    question: "What promotions does the hypermarket allow you to run (bundles, threshold offers, cross-category)?",
    why: "BostaOS will only propose promotions you're actually permitted to run.",
    unlocks: ["compliant bundle/promotion advice"],
    priority: 60, screenLink: "/health", allowUnknown: true,
    dataAnswered: (s) => s.context.allowedPromotions.length > 0,
  },
  {
    id: "allowed_display_changes", section: "Constraints", kind: "global_list",
    question: "What display changes are you allowed to make (facings, relocation, new blocks, counter placement)?",
    why: "Merchandising advice must stay inside what the concession permits.",
    unlocks: ["compliant merchandising advice"],
    priority: 62, screenLink: "/health", allowUnknown: true,
    dataAnswered: (s) => s.context.allowedDisplayChanges.length > 0,
  },
  {
    id: "occasions", section: "Customers", kind: "global_list",
    question: "What customer occasions matter (Ramadan, Eid, gifting, weekend, payday, school, gym)?",
    why: "Occasion context unlocks seasonal and daypart advice grounded in your real demand.",
    unlocks: ["seasonal packaging", "gifting formats", "daypart merchandising"],
    priority: 66, screenLink: "/health", allowUnknown: true,
    dataAnswered: (s) => s.context.customerOccasions.length > 0,
  },
  {
    id: "bought_together", section: "Customers", kind: "global_list",
    question: "Which products are commonly bought together, when you know?",
    why: "Bundle and cross-sell advice needs real pairings — otherwise it stays an explicit hypothesis.",
    unlocks: ["evidence-based bundles", "cross-sell placement"],
    priority: 55, screenLink: "/health", allowUnknown: true,
    dataAnswered: (s) => s.context.commonlyBoughtTogether.length > 0,
  },
  {
    id: "operational_constraints", section: "Operations", kind: "global_list",
    question: "Any operational constraints BostaOS should respect (prep capacity, storage, staffing, refrigeration)?",
    why: "Advice must be operationally possible on your real stand.",
    unlocks: ["operationally-feasible recommendations"],
    priority: 58, screenLink: "/health", allowUnknown: true,
    dataAnswered: (s) => s.context.operationalConstraints.length > 0,
  },
];

export interface PendingQuestion extends Omit<InterviewQuestion, "dataAnswered"> { answered: boolean }

/** The highest-value unanswered questions to ask now (progressive). A question
 *  is answered when its data condition holds OR the owner has addressed it
 *  (answeredKeys) — so confirmed answers and deliberate "unknown"s are never
 *  re-asked. */
export function nextQuestions(s: InterviewState, limit = 3): PendingQuestion[] {
  return INTERVIEW_QUESTIONS
    .filter((q) => !(q.dataAnswered(s) || s.context.answeredKeys.includes(q.id)))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit)
    .map(({ dataAnswered: _d, ...rest }) => ({ ...rest, answered: false }));
}

export interface InterviewProgress { total: number; answered: number; pct: number; nextUp: PendingQuestion | null }
export function interviewProgress(s: InterviewState): InterviewProgress {
  const total = INTERVIEW_QUESTIONS.length;
  const answered = INTERVIEW_QUESTIONS.filter((q) => q.dataAnswered(s) || s.context.answeredKeys.includes(q.id)).length;
  const next = nextQuestions(s, 1);
  return { total, answered, pct: Math.round((answered / total) * 100), nextUp: next[0] ?? null };
}
