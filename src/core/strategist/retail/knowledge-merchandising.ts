/** ═══════════════════════════════════════════════════════════════════════
 *  MERCHANDISING & SHOPPER-BEHAVIOUR PLAYBOOKS.
 *
 *  Everything above this file reasons about the BOOKS. This file reasons
 *  about the SHOP — the fixtures, the lighting, the signage, the order things
 *  sit in, the size of the pack in the shopper's hand. For a concession stand
 *  those are usually the largest available levers, because they cost little
 *  and they change what a passing shopper does in the three seconds they look.
 *
 *  Every principle here is long-settled retail practice:
 *
 *    · Shoppers buy what they can see at eye height, in the flow of traffic.
 *    · Unbranded product in a host store reads as the host's own cheap line —
 *      the brand mark is what allows a premium price to be believed.
 *    · Empty or half-faced space reads as "this business is failing" and
 *      suppresses the whole fixture, not just the gap.
 *    · Price is judged against the pack beside it, not in isolation: a
 *      premium item in a visibly smaller pack reads as poor value.
 *    · Round, memorable prices sell better than weight-derived ones, and a
 *      bigger pack dilutes a flat per-pack packaging cost.
 *    · A second item in the basket is easier to win than a bigger first item.
 *
 *  Impact numbers are computed from the owner's OWN revenue per facing, and
 *  every one states its arithmetic. Where a genuine effect has no local
 *  number, it is marked `directional` and ranked below priced moves rather
 *  than being given an invented figure.
 *  PURE. */
import type { KnowledgePlaybook, RecommendationDraft, RetailBusinessFacts, ZoneFact } from "./contract";
import { draft, ev, egp, gain, save } from "./helpers";

/* ── shared arithmetic over the physical stand ─────────────────────────── */

/** Zones that are actually selling right now. */
const sellingZones = (f: RetailBusinessFacts) =>
  f.zones.filter((z) => z.active && z.facings > 0 && z.tier !== "removed" && z.tier !== "opportunity");

/** The owner's own revenue per facing per month — the unit that prices every
 *  space decision. Null when there is nothing to divide by. */
function revenuePerFacing(f: RetailBusinessFacts): number | null {
  const facings = sellingZones(f).reduce((s, z) => s + z.facings, 0);
  if (facings <= 0 || f.totalRevenue <= 0) return null;
  return f.totalRevenue / facings;
}

/** Space that exists, is reachable, and is earning nothing today. */
const idleZones = (f: RetailBusinessFacts) =>
  f.zones.filter((z) => z.active && z.tier === "opportunity");

const hasPremiumStage = (f: RetailBusinessFacts) =>
  f.zones.some((z) => z.active && z.lit && z.branded && z.facings > 0);

const zoneEv = (z: ZoneFact, f: RetailBusinessFacts) =>
  ev("Zone", `${z.name} — ${z.facings} facings, ${z.traffic} traffic`, "location/zones", f.period, "/health");

/** Only a fraction of a new tier's theoretical value lands in month one:
 *  some sales move across from existing space rather than being new. Half is
 *  the deliberately conservative assumption, and it is always disclosed. */
const CANNIBALISATION_HAIRCUT = 0.5;

/* ── 1. dead prime space ───────────────────────────────────────────────── */

const deadPrimeSpace: KnowledgePlaybook = {
  id: "dead-prime-space",
  domain: "merchandising",
  title: "Fill space you already pay for",
  principle: "Space in a high-traffic aisle earns or it costs — there is no neutral. Empty fixtures also signal decline, which suppresses the fixtures beside them.",
  conditions: "An active zone the owner controls, in real traffic, carrying nothing.",
  requiredEvidence: ["zone traffic", "revenue per facing"],
  contraindications: ["stock cannot cover more facings without thinning existing ones"],
  mechanism: "Converts unproductive floor space into selling space at zero extra rent.",
  actionTypes: ["review_display_space", "premium_display_block"],
  expectedBenefitType: "incremental revenue from space already paid for",
  risks: ["spreading existing stock thinner instead of adding depth"],
  testDesign: "Fill the space, then compare total takings over two full weeks against the two before.",
  minTestDurationDays: 14,
  successMetrics: ["total revenue up", "no gaps appearing on existing fixtures"],
  failureMetrics: ["existing fixtures now look thin", "total revenue flat"],
  confidenceCeiling: "high",
  basis: "retail_math",
  version: 1,
  global: (f) => {
    const rpf = revenuePerFacing(f);
    const out: RecommendationDraft[] = [];
    for (const z of idleZones(f)) {
      if (z.facings <= 0) continue;
      const upside = rpf != null ? z.facings * rpf * CANNIBALISATION_HAIRCUT : null;
      out.push(draft({
        title: `Fill ${z.name}`,
        domain: "merchandising", type: "review_display_space",
        affectedLocation: z.name,
        observedFacts: [
          `${z.name} is ${z.traffic} traffic, holds about ${z.facings} facings, and is earning nothing today.`,
          rpf != null ? `Your selling facings average ${egp(rpf)} per facing per month.` : "No revenue-per-facing baseline yet.",
        ],
        principles: [
          "Space in the traffic flow either earns or costs you — empty space does not stay neutral, it reads as decline.",
        ],
        reasoning: [
          z.notes ? z.notes.replace(/\[[^\]]*\]\s*/g, "").trim() : `${z.name} is already yours to use.`,
          rpf != null
            ? `At your own average this is worth about ${egp(z.facings * rpf)} a month at full performance; halved for sales that simply move across from existing shelves, about ${egp(upside ?? 0)}.`
            : "Sizing this needs a revenue-per-facing baseline.",
        ],
        truthLevel: "strong_inference",
        proposedAction: `Put your highest-margin lines into ${z.name} in larger, round-priced packs.`,
        implementationSteps: [
          "Pick the three highest true-margin lines you can keep in stock.",
          "Face them full — a half-filled new tier is worse than no new tier.",
          "Give the tier one clear price message.",
        ],
        timing: "this week", durationDays: 14, effort: "low",
        mechanism: "Adds selling space at no extra rent.",
        expectedBenefitType: "incremental revenue from space already paid for",
        impact: upside != null
          ? gain(upside, `${z.facings} idle facings x ${egp(rpf!)} per facing per month, halved for sales moving across from existing shelves`)
          : null,
        brandEffect: "builds",
        assumptions: ["New space performs like your existing average, discounted by half."],
        sharpenWith: rpf == null ? "Record which products sit in which zone, so space can be priced properly." : null,
        confidence: rpf != null ? "high" : "medium",
        evidence: [zoneEv(z, f), ev("Period revenue", egp(f.totalRevenue), "read/revenue", f.period, "/sales")],
        screenLink: "/health",
        testDesign: "Fill it, then compare two weeks against the previous two.",
        successCriteria: ["total revenue up over the next two weeks"],
        failureCriteria: ["existing fixtures now look thin", "total revenue flat"],
        stopCondition: "Stop if filling it leaves your main table looking picked-over.",
      }));
    }
    return out;
  },
};

/* ── 2. no premium stage ───────────────────────────────────────────────── */

const noPremiumStage: KnowledgePlaybook = {
  id: "no-premium-stage",
  domain: "merchandising",
  title: "Build somewhere a premium price is believable",
  principle: "A shopper prices what they see. Identical presentation across cheap and expensive lines forces the expensive line to be judged on weight alone, which is the one comparison it loses.",
  conditions: "No lit, branded fixture anywhere, while premium lines are being sold.",
  requiredEvidence: ["zone lighting/branding", "premium line margins"],
  contraindications: ["no premium lines in the range"],
  mechanism: "Presentation creates the permission to charge more; without it, price is judged purely per kilo.",
  actionTypes: ["premium_display_block", "separate_premium"],
  expectedBenefitType: "margin points recovered on premium lines",
  risks: ["cost of the fixture before any uplift arrives"],
  testDesign: "Build the stage, hold prices for two weeks to establish a baseline, then move one line up and watch units.",
  minTestDurationDays: 30,
  successMetrics: ["premium units hold after a price rise"],
  failureMetrics: ["premium units fall more than the margin gained"],
  confidenceCeiling: "medium",
  basis: "retail_heuristic",
  version: 1,
  global: (f) => {
    if (!f.zones.length || hasPremiumStage(f)) return [];
    const floor = f.marginFloorPct ?? 30;
    // premium lines currently earning BELOW the floor are the ones a premium
    // stage would let you reprice — that is the size of this prize
    const weak = f.products.filter((p) => p.marginPct != null && p.marginPct < floor && p.revenue > 0
      && (p.tier === "premium" || (p.sellingPrice ?? 0) >= 100));
    if (!weak.length) return [];
    const weakRevenue = weak.reduce((s, p) => s + p.revenue, 0);
    const avgMargin = weak.reduce((s, p) => s + (p.marginPct ?? 0), 0) / weak.length;
    const gapPts = Math.max(0, floor - avgMargin);
    // one third of the gap is the realistic first step, not the whole gap
    const upside = weakRevenue * (gapPts / 100) / 3;
    const names = weak.slice(0, 3).map((p) => p.name).join(", ");
    return [draft({
      title: "Build a premium zone so nuts can carry a premium price",
      domain: "merchandising", type: "premium_display_block",
      affectedProducts: weak.slice(0, 3).map((p) => p.name),
      observedFacts: [
        "Nothing on the stand is lit and branded, so every line is presented the same way.",
        `${weak.length} premium line${weak.length === 1 ? "" : "s"} (${names}) average ${Math.round(avgMargin)}% margin against your ${Math.round(floor)}% floor, on ${egp(weakRevenue)} of sales.`,
      ],
      principles: [
        "Presentation is what makes a higher price believable. Identical packaging across cheap and expensive lines forces a per-kilo comparison the expensive line always loses.",
      ],
      reasoning: [
        "Your expensive nuts sit in the same box, on the same table, under the same light as seed packs at a third of the price.",
        `Closing even a third of the ${Math.round(gapPts)}-point margin gap on those lines is about ${egp(upside)} a month.`,
        "You control price in the Hyper Hub system, so any uplift is yours to take.",
      ],
      truthLevel: "strong_inference",
      proposedAction: "Rebuild the empty wall bay as a lit, branded premium nut and gift zone, then reprice the lines that move there.",
      implementationSteps: [
        "Light it and put the brand name on it — those two do most of the work.",
        "Move only lines above roughly 700 EGP/kg into it; a premium zone with cheap lines in it is not a premium zone.",
        "Hold prices two weeks to get a clean baseline, then raise one line and watch units.",
      ],
      timing: "next fixture build", durationDays: 30, effort: "high",
      mechanism: "Presentation creates the permission to charge more.",
      expectedBenefitType: "margin points recovered on premium lines",
      impact: gain(upside, `${egp(weakRevenue)} of premium sales x one third of the ${Math.round(gapPts)}-point gap to your ${Math.round(floor)}% floor`, "arithmetic"),
      brandEffect: "builds",
      assumptions: ["A premium setting supports a first price step of about a third of the gap."],
      risks: ["The fixture costs money before any uplift arrives."],
      sharpenWith: "What the nearby العطاري charges per kilo for the same nuts — it sets your ceiling.",
      confidence: "medium",
      evidence: [
        ev("Premium lines below floor", `${weak.length}`, "read/products", f.period, "/sales"),
        ev("Sales on those lines", egp(weakRevenue), "read/products", f.period, "/sales"),
      ],
      screenLink: "/health",
      testDesign: "Build it, baseline two weeks, then raise one line and watch units.",
      successCriteria: ["premium units hold within 10% after a price rise"],
      failureCriteria: ["premium units fall more than the margin gained"],
      stopCondition: "Stop the price rise if units drop more than 15%.",
    })];
  },
};

/* ── 3. unbranded selling zone ─────────────────────────────────────────── */

const unbrandedZone: KnowledgePlaybook = {
  id: "unbranded-selling-zone",
  domain: "merchandising",
  title: "Put your name on the fixtures that sell",
  principle: "Unbranded product inside a host store is read as the host's own unbranded line — the cheapest thing on the fixture. A header card is the lowest-cost way to buy back a premium.",
  conditions: "An active selling zone with no brand mark or category sign.",
  requiredEvidence: ["zone branding/signage"],
  contraindications: ["the host store forbids own-brand signage"],
  mechanism: "Brand attribution lets a shopper attach quality — and a price — to a name.",
  actionTypes: ["premium_display_block"],
  expectedBenefitType: "brand attribution and price credibility",
  risks: ["host store may object to signage"],
  testDesign: "Add a header card to one tower and compare its takings with the other for two weeks.",
  minTestDurationDays: 14,
  successMetrics: ["the signed tower outsells the unsigned one"],
  failureMetrics: ["no difference after two weeks"],
  confidenceCeiling: "medium",
  basis: "retail_heuristic",
  version: 1,
  global: (f) => {
    const bare = sellingZones(f).filter((z) => !z.branded);
    if (!bare.length) return [];
    const names = bare.map((z) => z.name).join("; ");
    return [draft({
      title: "Add brand headers to the unbranded fixtures",
      domain: "merchandising", type: "premium_display_block",
      affectedLocation: bare[0].name,
      observedFacts: [
        `${bare.length} of your selling zones carry no brand mark: ${names}.`,
        "Two of them sit beside haircare and oral-care gondolas, so nothing identifies the food as yours.",
      ],
      principles: [
        "Unbranded product in someone else's store is read as that store's cheapest own-label line.",
      ],
      reasoning: [
        "A shopper who cannot name what they are buying will not pay a premium for it, and will not come back asking for it.",
        "A printed header card is the cheapest fix available to you and it is the one that makes every other premium move possible.",
      ],
      truthLevel: "strong_inference",
      proposedAction: "Print a branded header card and category sign for each unbranded fixture.",
      implementationSteps: [
        "One header per fixture with the Bosta Bites name and the category beneath it.",
        "Start with the two checkout towers — highest passing traffic, zero identification today.",
      ],
      timing: "this week", durationDays: 14, effort: "low",
      mechanism: "Brand attribution lets a shopper attach quality, and a price, to a name.",
      expectedBenefitType: "brand attribution and price credibility",
      impact: null,
      brandEffect: "builds",
      assumptions: ["The host store permits own-brand header cards."],
      sharpenWith: "Sign one tower and not the other for two weeks — that gives you the real number.",
      confidence: "medium",
      evidence: bare.slice(0, 2).map((z) => zoneEv(z, f)),
      screenLink: "/health",
      testDesign: "Sign one tower, leave the other, compare two weeks.",
      successCriteria: ["the signed fixture outsells the unsigned one"],
      failureCriteria: ["no measurable difference after two weeks"],
      stopCondition: "Stop if the host store objects.",
    })];
  },
};

/* ── 4. premium pack smaller than the cheap pack ───────────────────────── */

const premiumLooksSmaller: KnowledgePlaybook = {
  id: "premium-looks-smaller",
  domain: "packaging",
  title: "Never let the expensive pack look smaller than the cheap one",
  principle: "Shoppers judge value by the pack beside it. A dearer item in a visibly smaller box reads as poor value however good the contents are.",
  conditions: "A premium line packed smaller than a cheaper line on the same fixture.",
  requiredEvidence: ["pack sizes", "selling prices"],
  contraindications: ["the box genuinely cannot hold more"],
  mechanism: "Removes an unfavourable side-by-side comparison at the point of decision.",
  actionTypes: ["larger_value_size", "premium_pouch"],
  expectedBenefitType: "better value perception on premium lines",
  risks: ["a bigger pack raises the shelf price, which can deter trial"],
  testDesign: "Repack one premium line to match the cheap tier's visual volume and track its units for two weeks.",
  minTestDurationDays: 14,
  successMetrics: ["premium units up"],
  failureMetrics: ["units flat and stock ages"],
  confidenceCeiling: "medium",
  basis: "retail_heuristic",
  version: 1,
  global: (f) => {
    const sized = f.products.filter((p) => p.packSizeG != null && p.sellingPrice != null && p.revenue > 0);
    if (sized.length < 2) return [];
    const dear = sized.filter((p) => p.tier === "premium" || (p.sellingPrice ?? 0) >= 100);
    const cheap = sized.filter((p) => (p.sellingPrice ?? 0) < 60);
    if (!dear.length || !cheap.length) return [];
    const biggestCheap = cheap.reduce((a, b) => ((a.packSizeG ?? 0) >= (b.packSizeG ?? 0) ? a : b));
    const offenders = dear.filter((p) => (p.packSizeG ?? 0) < (biggestCheap.packSizeG ?? 0));
    if (!offenders.length) return [];
    const worst = offenders.reduce((a, b) => ((a.revenue) >= (b.revenue) ? a : b));
    return [draft({
      title: `${worst.name} looks smaller than a pack a third of the price`,
      domain: "packaging", type: "larger_value_size",
      product: worst,
      observedFacts: [
        `${worst.name} is packed at ${worst.packSizeG}g for ${egp(worst.sellingPrice ?? 0)}.`,
        `${biggestCheap.name} sits near it at ${biggestCheap.packSizeG}g for ${egp(biggestCheap.sellingPrice ?? 0)}.`,
      ],
      principles: ["Value is judged against the pack beside it, not in isolation."],
      reasoning: [
        "A shopper sees two boxes: the dearer one is visibly smaller. That comparison is made in about a second and it is not made in your favour.",
        "Either the premium pack grows to match the visual volume, or it moves somewhere the cheap pack is not standing next to it.",
      ],
      truthLevel: "measured_conclusion",
      proposedAction: `Repack ${worst.name} into a taller or deeper box so it reads at least as generous as ${biggestCheap.name}, or separate the two on the fixture.`,
      implementationSteps: [
        "Compare the two boxes side by side on the table before deciding.",
        "If the box cannot grow, move the premium line to its own shelf away from the cheap tier.",
      ],
      timing: "next repack", durationDays: 14, effort: "medium",
      mechanism: "Removes an unfavourable comparison at the moment of decision.",
      expectedBenefitType: "better value perception on premium lines",
      impact: null,
      brandEffect: "builds",
      risks: ["A bigger pack raises the shelf price, which can deter first-time trial."],
      sharpenWith: `Two weeks of ${worst.name} units before and after the repack.`,
      confidence: "medium",
      evidence: [
        ev(`${worst.name} pack`, `${worst.packSizeG}g at ${egp(worst.sellingPrice ?? 0)}`, "read/products", f.period, "/inventory"),
        ev(`${biggestCheap.name} pack`, `${biggestCheap.packSizeG}g at ${egp(biggestCheap.sellingPrice ?? 0)}`, "read/products", f.period, "/inventory"),
      ],
      screenLink: "/inventory",
      testDesign: "Repack, then compare two weeks of units.",
      successCriteria: [`${worst.name} units up over two weeks`],
      failureCriteria: ["units flat and stock ages past a week"],
      stopCondition: "Revert if units fall.",
    })];
  },
};

/* ── 5. round price points ─────────────────────────────────────────────── */

const roundPricePoints: KnowledgePlaybook = {
  id: "round-price-points",
  domain: "pricing",
  title: "Pack to a round price, not a round weight",
  principle: "Shoppers remember and reach for round prices. Packing to weight produces awkward tickets and wastes the flat per-pack cost on small packs.",
  conditions: "Weight-derived prices, and the owner controls the shelf price.",
  requiredEvidence: ["selling price", "pack size", "packaging cost"],
  contraindications: ["the host store sets prices"],
  mechanism: "A memorable price speeds the decision; a larger pack spreads the flat box cost over more grams.",
  actionTypes: ["test_price_increase", "larger_value_size"],
  expectedBenefitType: "higher ticket and a smaller packaging share",
  risks: ["a higher shelf price can slow first trial"],
  testDesign: "Convert two lines to round-price packs for two weeks and compare units and takings.",
  minTestDurationDays: 14,
  successMetrics: ["takings per line up", "packaging share of ticket down"],
  failureMetrics: ["units down more than the ticket gained"],
  confidenceCeiling: "medium",
  basis: "retail_math",
  version: 1,
  global: (f) => {
    const odd = f.products.filter((p) =>
      p.sellingPrice != null && p.sellingPrice > 0 && p.packagingCost != null && p.packagingCost > 0
      && p.revenue > 0 && p.sellingPrice % 5 !== 0);
    if (!odd.length) return [];
    const worst = odd.reduce((a, b) => {
      const sa = (a.packagingCost ?? 0) / (a.sellingPrice ?? 1);
      const sb = (b.packagingCost ?? 0) / (b.sellingPrice ?? 1);
      return sa >= sb ? a : b;
    });
    const share = ((worst.packagingCost ?? 0) / (worst.sellingPrice ?? 1)) * 100;
    const target = Math.ceil((worst.sellingPrice ?? 0) / 25) * 25;
    const newShare = ((worst.packagingCost ?? 0) / target) * 100;
    // the box cost is flat, so every EGP of extra ticket dilutes it
    const monthlyUnits = worst.units;
    const saving = monthlyUnits * (worst.packagingCost ?? 0) * (1 - newShare / share > 0 ? (share - newShare) / share : 0);
    return [draft({
      title: `Move ${worst.name} to a round ${egp(target)} pack`,
      domain: "pricing", type: "larger_value_size",
      product: worst,
      observedFacts: [
        `${worst.name} sells at ${egp(worst.sellingPrice ?? 0)}, and the box alone is ${egp(worst.packagingCost ?? 0)} — ${Math.round(share)}% of the ticket.`,
        `${monthlyUnits} units sold in ${f.period}.`,
      ],
      principles: [
        "Round prices are remembered and reached for. A flat box cost is a smaller share of a bigger pack, so the same box earns more.",
      ],
      reasoning: [
        `Packing this line to land on ${egp(target)} instead of an odd weight-derived price cuts the packaging share from ${Math.round(share)}% to about ${Math.round(newShare)}% of the ticket.`,
        "You set prices in the Hyper Hub system yourself, so this needs no permission from the mall.",
      ],
      truthLevel: "measured_conclusion",
      proposedAction: `Fix the fill weight so ${worst.name} lands exactly on ${egp(target)}.`,
      implementationSteps: [
        `Work the fill weight back from ${egp(target)} at your current price per kilo.`,
        "Weigh one pack against the new target before committing a batch.",
        "Update the printed price so the shelf and the system agree.",
      ],
      timing: "next repack", durationDays: 14, effort: "low",
      mechanism: "A memorable price speeds the decision and a bigger pack dilutes the flat box cost.",
      expectedBenefitType: "higher ticket and a smaller packaging share",
      impact: saving > 0
        ? save(saving, `${monthlyUnits} units x ${egp(worst.packagingCost ?? 0)} box, with the packaging share falling from ${Math.round(share)}% to ${Math.round(newShare)}% of the ticket`)
        : null,
      brandEffect: "neutral",
      risks: ["A higher shelf price can slow first-time trial."],
      sharpenWith: "Two weeks of units at the new price to confirm demand held.",
      confidence: "medium",
      evidence: [
        ev(`${worst.name} price`, egp(worst.sellingPrice ?? 0), "read/products", f.period, "/inventory"),
        ev("Box cost", egp(worst.packagingCost ?? 0), "packaging_formats", f.period, "/inventory"),
      ],
      screenLink: "/inventory",
      testDesign: "Convert, then compare two weeks of units and takings.",
      successCriteria: ["takings on this line up over two weeks"],
      failureCriteria: ["units down more than the extra ticket earns"],
      stopCondition: "Revert if units fall more than 15%.",
    })];
  },
};

/* ── 6. the owner's own audit findings ─────────────────────────────────── */

const openBranchFindings: KnowledgePlaybook = {
  id: "open-branch-findings",
  domain: "operational",
  title: "Close the open findings from your own stand audit",
  principle: "A recorded problem that never reaches a task list is not intelligence, it is a note. Presentation and hygiene faults compound because every shopper sees them.",
  conditions: "Open major or critical observations recorded against the branch.",
  requiredEvidence: ["branch observations"],
  contraindications: [],
  mechanism: "Converts standing observations into work with an owner and a date.",
  actionTypes: ["review_display_space"],
  expectedBenefitType: "presentation faults removed from the shopper's view",
  risks: [],
  testDesign: "Re-walk the stand in two weeks and confirm the finding is gone.",
  minTestDurationDays: 14,
  successMetrics: ["finding closed on the next walk"],
  failureMetrics: ["still open in two weeks"],
  confidenceCeiling: "high",
  basis: "owner_confirmed",
  version: 1,
  global: (f) => {
    const serious = f.observations.filter((o) => o.severity === "critical" || o.severity === "major");
    if (!serious.length) return [];
    // group into one plan rather than nagging one card per finding
    const top = serious.slice(0, 5);
    return [draft({
      title: `Close ${serious.length} open faults on the stand`,
      domain: "operational", type: "review_display_space",
      observedFacts: top.map((o) => `${o.category}: ${o.finding}.`),
      principles: ["Every shopper sees a presentation fault. They compound, and they are the cheapest thing on this list to fix."],
      reasoning: [
        "These came from your own walk of the stand and are still open.",
        "None of them need money — they need a checklist and one pass.",
      ],
      truthLevel: "measured_conclusion",
      proposedAction: "Work through the open presentation and hygiene faults this week.",
      implementationSteps: top.map((o) => o.recommendation ?? o.finding),
      timing: "this week", durationDays: 14, effort: "low",
      mechanism: "Turns standing observations into work with a date.",
      expectedBenefitType: "presentation faults removed from the shopper's view",
      impact: null,
      brandEffect: "builds",
      confidence: "high",
      evidence: [ev("Open findings", `${serious.length}`, "location/observations", f.period, "/health")],
      screenLink: "/health",
      testDesign: "Re-walk the stand in two weeks.",
      successCriteria: ["every listed fault closed within two weeks"],
      failureCriteria: ["still open in two weeks"],
      stopCondition: null,
    })];
  },
};

/* ── 7. season preparation ─────────────────────────────────────────────── */

const seasonPrep: KnowledgePlaybook = {
  id: "season-prep",
  domain: "seasonality",
  title: "Prepare the next season while there is still time",
  principle: "Seasonal demand is won before it arrives. Buying, packing and display decisions all need lead time, so a peak reacted to is a peak half-missed.",
  conditions: "A known season inside its lead-time window.",
  requiredEvidence: ["retail calendar"],
  contraindications: ["cash cannot support pre-buying"],
  mechanism: "Puts the range and the stock in place before demand arrives instead of during it.",
  actionTypes: ["buy_now", "gift_format", "premium_display_block"],
  expectedBenefitType: "capturing the peak instead of chasing it",
  risks: ["over-buying if the peak disappoints"],
  testDesign: "Compare this season's takings against the same window last year.",
  minTestDurationDays: 30,
  successMetrics: ["season revenue above the prior year"],
  failureMetrics: ["stock left over after the season"],
  confidenceCeiling: "high",
  basis: "retail_heuristic",
  version: 1,
  global: (f) => {
    const out: RecommendationDraft[] = [];
    const n = f.nextSeason;
    if (n && n.weeksAway <= 8) {
      out.push(draft({
        title: `${n.name} is ${n.weeksAway} weeks away — start now`,
        domain: "seasonality", type: "premium_display_block",
        observedFacts: [`${n.name} begins around ${n.startsOn}, ${n.weeksAway} weeks from now.`],
        principles: ["Seasonal demand is won before it arrives, not during it."],
        reasoning: [
          "Stock, packing and display all need lead time. By the time the season is visible in the till it is too late to buy for it.",
        ],
        truthLevel: "strong_inference",
        proposedAction: `Plan the range, stock and display for ${n.name} now.`,
        implementationSteps: [
          "Decide which lines carry the season and how they will be packed.",
          "Order early enough to arrive before the first week, not during it.",
          "Set the display a week ahead of the date.",
        ],
        timing: `before ${n.startsOn}`, durationDays: 30, effort: "medium",
        mechanism: "Range and stock in place before demand arrives.",
        expectedBenefitType: "capturing the peak instead of chasing it",
        impact: null, brandEffect: "builds",
        risks: ["Over-buying if the peak disappoints."],
        assumptions: ["Islamic dates are astronomical approximations and can shift a day on the moon sighting."],
        confidence: "high",
        evidence: [ev("Next season", `${n.name} — ${n.startsOn}`, "retail calendar", f.period, "/health")],
        screenLink: "/health",
        testDesign: "Compare the season against the same window last year.",
        successCriteria: ["season revenue above the equivalent window last year"],
        failureCriteria: ["stock left over once the season ends"],
        stopCondition: "Stop buying deeper if the first week undershoots.",
      }));
    }
    // A seasonal trough needs the OPPOSITE advice to a structural decline —
    // without this the engine reads a normal summer as a business failing.
    if (f.season === "summer_slow") {
      out.push(draft({
        title: "Your summer dip is the season, not the business",
        domain: "seasonality", type: "maintain",
        observedFacts: ["June to August is the annual low for nuts in Egypt: heat suppresses demand and mall traffic thins."],
        principles: ["Seasonal troughs are traded through, not cut through. Cutting range in a trough removes the capacity to earn in the peak."],
        reasoning: [
          "Nut demand falls with heat and recovers with the cold months; chocolate-coated lines are also at melt risk right now.",
          "The mistake in a trough is to read it as decline and cut the range — which then leaves nothing to sell when winter arrives.",
        ],
        truthLevel: "strong_inference",
        proposedAction: "Trade the trough: keep stock tight, lean on heat-stable lines, and use the quiet weeks to build what you will sell hard in winter.",
        implementationSteps: [
          "Buy shallower to avoid waste while demand is soft.",
          "Shift the mix toward seeds and heat-stable snacks.",
          "Build the fixtures and formats now so winter opens with them ready.",
        ],
        timing: "through August", durationDays: 45, effort: "low",
        mechanism: "Protects cash and capacity through the low weeks.",
        expectedBenefitType: "cash protected and the peak arrived at ready",
        impact: null, brandEffect: "neutral",
        confidence: "high",
        evidence: [ev("Season", "summer trough (Jun–Aug)", "retail calendar", f.period, "/health")],
        screenLink: "/health",
        testDesign: "Compare September against last September once the season turns.",
        successCriteria: ["no waste write-offs through the trough", "winter opens with the new fixtures live"],
        failureCriteria: ["stock ageing past a week", "cash falling below the reserve"],
        stopCondition: null,
      }));
    }
    return out;
  },
};

export const MERCHANDISING_KNOWLEDGE: KnowledgePlaybook[] = [
  deadPrimeSpace,
  noPremiumStage,
  unbrandedZone,
  premiumLooksSmaller,
  roundPricePoints,
  openBranchFindings,
  seasonPrep,
];
