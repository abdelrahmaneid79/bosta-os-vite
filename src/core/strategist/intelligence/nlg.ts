/** Deterministic Natural-Language Generator — the PRIMARY reporting system.
 *
 *  Transforms canonical DomainFindings into executive-quality prose with NO
 *  external model. It varies wording (deterministically, seeded by finding id
 *  so output is stable), combines related findings, removes repetition, and
 *  writes like an experienced retail consultant. It NEVER invents facts — every
 *  clause is composed from the structured fields it is handed. An external
 *  language adapter may later re-voice this prose, but this is the baseline and
 *  it must stand on its own. */
import type { DomainFinding, FindingConfidence, RetailDomain } from "./contract";

export type NlgStyle = "brief" | "detailed" | "action";

/* ── deterministic variety (no Math.random — seeded by id) ─────────────── */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function pick<T>(arr: readonly T[], seed: string): T {
  return arr[hash(seed) % arr.length];
}

const CONF_PHRASE: Record<FindingConfidence, string> = {
  high: "High confidence",
  medium: "Moderate confidence",
  low: "Low confidence — treat this as directional",
};

const FINDING_OPENERS = ["", "", "Notably, ", "What stands out: ", "In short, "] as const;
const DRIVER_CONNECTORS = ["The driver is", "This traces to", "The cause sits in", "It is driven by"] as const;
const REC_CONNECTORS = ["Recommended:", "The move here:", "What to do:", "Act on this by"] as const;

const DOMAIN_LABEL: Record<RetailDomain, string> = {
  revenue: "Revenue", margin: "Margin", pricing: "Pricing", promotion: "Promotion",
  inventory: "Inventory", purchase: "Purchasing", supplier: "Supplier", category: "Category",
  shelf: "Shelf space", basket: "Basket", seasonality: "Seasonality", merchandising: "Merchandising",
  cash: "Cash", cheque: "Cheque", operational: "Operations", growth: "Growth", risk: "Risk",
  decision: "Decision", recommendation: "Recommendation",
};

const trimDot = (s: string) => s.replace(/\s*$/, "").replace(/\.*$/, "");
const sentence = (s: string) => { const t = s.trim(); return t ? (/[.!?]$/.test(t) ? t : `${t}.`) : ""; };

/** Render ONE finding as prose. */
export function renderFinding(df: DomainFinding, style: NlgStyle = "detailed"): string {
  const opener = pick(FINDING_OPENERS, df.id);
  const findingSentence = sentence(`${opener}${df.finding}`);

  if (style === "brief") {
    const rec = df.recommendation ? ` ${sentence(`${pick(REC_CONNECTORS, df.id + "r")} ${lower(trimDot(df.recommendation))}`)}` : "";
    return `${findingSentence}${rec}`.trim();
  }

  if (style === "action") {
    const parts = [
      sentence(`${pick(REC_CONNECTORS, df.id + "r")} ${lower(trimDot(df.recommendation))}`),
      df.expectedBenefit ? sentence(`Expected benefit: ${lower(trimDot(df.expectedBenefit))}`) : "",
      df.successCriteria ? sentence(`You'll know it worked when ${lower(trimDot(df.successCriteria))}`) : "",
      df.blockingInformation.length ? sentence(`Blocked until: ${df.blockingInformation.join("; ")}`) : "",
    ];
    return parts.filter(Boolean).join(" ");
  }

  // detailed — the full consultant paragraph, only from the 11 fields
  const parts: string[] = [
    findingSentence,
    sentence(`${pick(DRIVER_CONNECTORS, df.id + "d")} ${lower(trimDot(df.driver))}`),
    sentence(df.businessContext),
    df.risk ? sentence(df.risk) : "",
    df.opportunity ? sentence(df.opportunity) : "",
    sentence(`${pick(REC_CONNECTORS, df.id + "r")} ${lower(trimDot(df.recommendation))}`),
    df.expectedBenefit ? sentence(`Expected benefit: ${lower(trimDot(df.expectedBenefit))}`) : "",
    df.successCriteria ? sentence(`Success looks like: ${lower(trimDot(df.successCriteria))}`) : "",
    sentence(`${CONF_PHRASE[df.confidence]}${df.blockingInformation.length ? `, pending ${df.blockingInformation.join("; ")}` : ""}`),
  ];
  return parts.filter(Boolean).join(" ");
}

function lower(s: string): string {
  // lowercase the first letter unless it's an acronym/number/proper noun-ish token
  if (!s) return s;
  const first = s[0];
  const second = s[1] ?? "";
  if (first === first.toUpperCase() && second && second === second.toUpperCase()) return s; // ACRONYM
  return first.toLowerCase() + s.slice(1);
}

export interface ReportOptions {
  style?: NlgStyle;
  title?: string;
  /** cap the body to the most material findings (already ranked by caller) */
  maxFindings?: number;
  /** group the body under domain headers */
  groupByDomain?: boolean;
}

export interface RenderedReport {
  title: string;
  summary: string;
  sections: { domain: RetailDomain | null; label: string; lines: string[] }[];
  body: string;
}

/** Compose an executive report from many findings. Combines related findings,
 *  leads with a one-line synthesis, and never repeats a sentence. */
export function renderReport(findings: DomainFinding[], opts: ReportOptions = {}): RenderedReport {
  const style = opts.style ?? "detailed";
  const capped = opts.maxFindings ? findings.slice(0, opts.maxFindings) : findings;
  const title = opts.title ?? "Retail intelligence brief";

  // one-line synthesis from the most material finding + a count
  const lead = capped[0];
  const risks = capped.filter((f) => f.risk).length;
  const opps = capped.filter((f) => f.opportunity).length;
  const summary = lead
    ? sentence(`${lead.headline}${capped.length > 1 ? ` — plus ${capped.length - 1} more finding${capped.length - 1 === 1 ? "" : "s"} (${risks} risk${risks === 1 ? "" : "s"}, ${opps} opportunit${opps === 1 ? "y" : "ies"})` : ""}`)
    : "No findings above the reporting threshold — the books look clean for this view.";

  const sections: RenderedReport["sections"] = [];
  const seen = new Set<string>();
  const emit = (df: DomainFinding, into: string[]) => {
    const line = renderFinding(df, style);
    if (seen.has(line)) return;      // remove repetition
    seen.add(line);
    into.push(line);
  };

  if (opts.groupByDomain) {
    const byDomain = new Map<RetailDomain, DomainFinding[]>();
    for (const f of capped) byDomain.set(f.domain, [...(byDomain.get(f.domain) ?? []), f]);
    for (const [domain, list] of byDomain) {
      const lines: string[] = [];
      for (const f of list) emit(f, lines);
      sections.push({ domain, label: DOMAIN_LABEL[domain], lines });
    }
  } else {
    const lines: string[] = [];
    for (const f of capped) emit(f, lines);
    sections.push({ domain: null, label: "Findings", lines });
  }

  const body = [summary, "", ...sections.flatMap((s) => opts.groupByDomain ? [`${s.label}`, ...s.lines, ""] : s.lines)].join("\n").trim();
  return { title, summary, sections, body };
}
