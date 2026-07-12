/** Suggested questions — generated from the CURRENT snapshot + findings, so
 *  every suggestion is answerable from data that actually exists. PURE. */
import type { StrategistSnapshot } from "./contract";
import type { Finding } from "./analysis/types";

export interface SuggestedQuestion { text: string; mode: "question" | "decision_support" | "cash_review" | "cheque_review" | "product_strategy" | "data_quality_review" }

export function suggestQuestions(s: StrategistSnapshot, findings: Finding[], max = 6): SuggestedQuestion[] {
  const out: SuggestedQuestion[] = [];
  const has = (id: string) => findings.some((f) => f.id === id);

  if (has("margin-drop") || has("growth-weaker-economics")) out.push({ text: "Why did margin fall, and which products caused it?", mode: "question" });
  if (has("withdrawals-high")) out.push({ text: "How much can I safely withdraw this month?", mode: "decision_support" });
  if (has("revenue-down") || has("behind-target")) out.push({ text: "What is behind the revenue drop — days, products, or mix?", mode: "question" });
  if (has("overdue-cheques") || has("settlement-lag")) out.push({ text: "Which settlement period should I chase with the mall first?", mode: "cheque_review" });
  if (has("uncovered-revenue") || has("missing-costs")) out.push({ text: "Which missing data is distorting my numbers the most?", mode: "data_quality_review" });
  if (has("stock-risk")) out.push({ text: "What should I restock first, and how much?", mode: "product_strategy" });
  if ((s.products.highVolumeLowMargin.value ?? []).length > 0) out.push({ text: "Which products sell well but earn too little?", mode: "product_strategy" });
  if ((s.products.lowVolumeHighMargin.value ?? []).length > 0) out.push({ text: "Which high-margin products deserve better placement?", mode: "product_strategy" });
  if (s.cash.hasLiveData) out.push({ text: "Is my cash position consistent with my profit?", mode: "cash_review" });
  if (s.meta.isStale) out.push({ text: "What do my numbers really say, given the books are behind?", mode: "question" });

  // evergreen fallbacks so the panel is never empty
  out.push({ text: "What should I fix this week?", mode: "question" });
  out.push({ text: "Is the business improving or just selling more?", mode: "question" });

  const seen = new Set<string>();
  return out.filter((q) => !seen.has(q.text) && seen.add(q.text)).slice(0, max);
}
