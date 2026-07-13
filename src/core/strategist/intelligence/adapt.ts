/** Adapter: existing engine output → the canonical Retail Intelligence contract.
 *
 *  The Cycle-2..9 engines already emit `Finding` (analysis/types.ts), which
 *  carries almost the entire 11-field contract. This maps it into `DomainFinding`
 *  so every existing engine complies WITHOUT being rewritten — honouring the
 *  constitution's "refactor only where ownership is misplaced". */
import type { Finding, InsightClass } from "../analysis/types";
import type { DomainFinding, RetailDomain } from "./contract";

const egp = (n: number) => `EGP ${Math.round(n).toLocaleString()}`;

/** Best-effort routing of a legacy finding to a retail domain (metadata only —
 *  never affects the numbers). */
export function inferDomain(f: Finding): RetailDomain {
  const id = f.id.toLowerCase();
  const test = (re: RegExp) => re.test(id);
  if (test(/margin/)) return "margin";
  if (test(/pric/)) return "pricing";
  if (test(/promo/)) return "promotion";
  if (test(/cheque|settle/)) return "cheque";
  if (test(/cash|withdraw|reserve|runway|afford/)) return "cash";
  if (test(/stock|inventory|cover|dead/)) return "inventory";
  if (test(/purchase|reorder|buy/)) return "purchase";
  if (test(/supplier|vendor/)) return "supplier";
  if (test(/revenue|sales|trend/)) return "revenue";
  if (test(/product|category|shelf|contribut/)) return "category";
  if (test(/season/)) return "seasonality";
  if (test(/basket/)) return "basket";
  if (f.class === "opportunity") return "growth";
  if (f.class === "warning" || f.class === "contradiction" || f.class === "decision_risk") return "risk";
  if (f.class === "recommendation") return "recommendation";
  return "operational";
}

function riskLine(f: Finding): string | null {
  const risky: InsightClass[] = ["warning", "contradiction", "decision_risk"];
  if (!risky.includes(f.class)) return null;
  if (f.impactEgp != null) return `Left unaddressed, roughly ${egp(f.impactEgp)} is exposed.`;
  return "Left unaddressed, the issue compounds until it's corrected.";
}

function opportunityLine(f: Finding): string | null {
  if (f.class !== "opportunity") return null;
  if (f.action?.expectedImpact) return f.action.expectedImpact;
  if (f.impactEgp != null) return `Up to ${egp(f.impactEgp)} of upside is in reach.`;
  return "There is measurable upside available.";
}

function businessContext(f: Finding): string {
  if (f.assumptions.length) return `This reads against your operating assumptions: ${f.assumptions.join("; ")}.`;
  if (f.drivers.length) return `In context, the movement is concentrated in ${f.drivers.slice(0, 3).join(", ")}.`;
  return "Judged against the current period versus its prior comparison.";
}

/** Map one legacy Finding onto the canonical 11-field contract. */
export function toDomainFinding(f: Finding): DomainFinding {
  const blocking = Array.from(new Set([...(f.missingData ?? []), ...((f.action?.missingData) ?? [])]));
  const recommendation = f.action?.action ?? f.alternativeAction ?? "No action yet — keep monitoring.";
  const expectedBenefit = f.action?.expectedImpact ?? (f.impactEgp != null ? `${egp(f.impactEgp)} at stake` : "Not quantifiable with current data.");
  return {
    id: f.id,
    domain: inferDomain(f),
    headline: f.title,
    urgency: f.urgency,
    impactEgp: f.impactEgp,
    screenLink: f.action?.screenLink ?? f.evidence[0]?.screenLink ?? "/health",

    finding: f.detail || f.title,
    driver: f.drivers.length ? f.drivers.join(", ") : "Driver not yet isolated from the available data.",
    evidence: f.evidence,
    businessContext: businessContext(f),
    risk: riskLine(f),
    opportunity: opportunityLine(f),
    recommendation,
    expectedBenefit,
    successCriteria: f.resolutionCriteria || "Resolved when the underlying signal clears.",
    confidence: f.confidence,
    blockingInformation: blocking,
  };
}

export const toDomainFindings = (findings: Finding[]): DomainFinding[] => findings.map(toDomainFinding);
