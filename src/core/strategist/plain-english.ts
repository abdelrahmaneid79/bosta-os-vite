/** Plain-English enforcement layer — the BostaOS Executive Communication
 *  Standard (given verbatim by the owner, 2026-07-13, permanent). The owner
 *  should never need business training to read a recommendation. This module
 *  is the shared, zero-dependency text pass applied as the LAST step before
 *  any recommendation reaches the owner — in the deterministic NLG renderers
 *  (`intelligence/nlg.ts`, `retail/nlg.ts`) AND on whatever the optional LLM
 *  polish layer returns (`response.ts`). No internal imports, so every layer
 *  of the strategist can use it without creating an import cycle. */

export type PlainConfidence = "high" | "medium" | "low";

/** jargon phrase -> plain-English meaning. Multi-word phrases are listed before
 *  their shorter substrings so the specific case wins (e.g. "margin
 *  compression" is replaced whole, not as "margin" + leftover "compression"). */
// Every replacement is a NOUN PHRASE, never a full clause — these substitute
// mid-sentence (e.g. "roughly EGP 1,200 of weekly {phrase} is exposed"), so a
// full sentence like "you're making less money..." would read as broken
// grammar once dropped into that slot.
const GLOSSARY: [RegExp, string][] = [
  [/\bmargin compression\b/gi, "shrinking profit on every sale"],
  [/\bmargin deterioration\b/gi, "shrinking profit per sale"],
  [/\bworking capital pressure\b/gi, "cash getting tied up in stock"],
  [/\bworking capital\b/gi, "the cash tied up in running the business"],
  [/\bgross margin\b/gi, "the amount you keep after paying for the product itself"],
  [/\binventory turns?\b/gi, "how quickly you sell through your stock"],
  [/\binventory investment\b/gi, "cash sitting on the shelf as stock"],
  [/\bpremium (nut )?attachment\b/gi, "premium nuts sold alongside other products"],
  [/\bproduct attachment\b/gi, "people buying one product also buying another"],
  [/\baverage basket value\b/gi, "the average amount each customer spends"],
];

/** banned consultant words -> plain substitutes. */
const BANNED_WORDS: [RegExp, string][] = [
  [/\bleverage\b/gi, "use"],
  [/\boptimi[sz]e\b/gi, "improve"],
  [/\bsynergi[sz]e\b/gi, "work together"],
  [/\bmaximi[sz]e opportunities\b/gi, "make the most of this"],
  [/\bactionable insight\b/gi, "useful finding"],
  [/\bstrategic initiative\b/gi, "plan"],
  [/\bkey takeaway\b/gi, "the main point"],
  [/\bstakeholder\b/gi, "the people involved"],
  [/\bholistic\b/gi, "complete"],
];

/** Phrases BostaOS must never emit — shared by both NLG renderers' tests and
 *  the LLM system prompt (banned outright, never auto-substituted there). */
export const BANNED_PHRASES = [
  "leverage", "optimise", "optimize", "synergise", "synergize", "maximise opportunities",
  "maximize opportunities", "actionable insight", "strategic initiative", "key takeaway",
  "stakeholder", "holistic", "consider monitoring", "keep an eye on", "maintain momentum",
];

function capFirst(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Lowercase the first letter unless it looks like an acronym/proper noun
 *  (first two characters both uppercase). Shared so every renderer composes
 *  connector sentences the same way. */
export function lowerFirst(s: string): string {
  if (!s) return s;
  const first = s[0], second = s[1] ?? "";
  if (first === first.toUpperCase() && second && second === second.toUpperCase()) return s;
  return first.toLowerCase() + s.slice(1);
}

/** Translate jargon and strip banned consultant words. Deterministic and safe
 *  to run on any composed sentence — only touches the listed phrases, never
 *  numbers, product names, or EGP figures. */
export function toPlainEnglish(text: string): string {
  let out = text;
  for (const [re, plain] of [...GLOSSARY, ...BANNED_WORDS]) {
    out = out.replace(re, (_match, offset: number) => {
      const atSentenceStart = offset === 0 || /[.!?]\s*$/.test(out.slice(0, offset));
      return atSentenceStart ? capFirst(plain) : plain;
    });
  }
  return out;
}

/** Step 8 of the standard — "what could make me wrong?" Always returns
 *  something in plain words; never a bare confidence label. `cautions` are the
 *  specific conditions that would break the recommendation (contraindications,
 *  missing information, or assumptions — pass whichever is most relevant, in
 *  that priority); when none are recorded, falls back to an honest
 *  confidence-scaled caveat. */
export function uncertaintyLine(confidence: PlainConfidence, cautions: string[]): string {
  if (cautions.length) {
    const clauses = cautions.map((c) => lowerFirst(c.replace(/\.$/, "")));
    return `This could be wrong if ${clauses.join(", or if ")}.`;
  }
  if (confidence === "low") return "Treat this as directional, not certain — verify on the ground before acting.";
  if (confidence === "medium") return "This holds as long as nothing outside these numbers has changed.";
  return "This is well-supported by the data, but double-check it still matches what you're seeing day to day.";
}
