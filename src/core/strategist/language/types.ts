/** Layer 3 contracts — provider-neutral. Core code (Layers 1 & 2), the UI and
 *  persistence import ONLY these types. No provider SDK types may appear here
 *  or in anything that imports this file. */
import type { StrategistSnapshot } from "../contract";
import type { Finding } from "../analysis/types";
import type { StrategyReport } from "../analysis/report";
import type { DecisionContext } from "../analysis/decision";
import type { CalendarContext } from "../calendar";
import type { StrategistResponse } from "../response";

export type LanguageMode =
  | "daily_brief" | "weekly_review" | "question" | "decision_support"
  | "product_strategy" | "cash_review" | "cheque_review" | "data_quality_review";

export interface LanguageRequest {
  mode: LanguageMode;
  snapshot: StrategistSnapshot;
  report: StrategyReport;
  /** ranked findings (== report.findings; kept explicit for provider payloads) */
  findings: Finding[];
  calendar?: CalendarContext;
  question?: string;
  decision?: string;
  decisionContext?: DecisionContext;
  /** short provider-neutral conversation turns (text only) */
  history?: { role: "user" | "assistant"; content: string }[];
  /** compact owner-memory facts (behavioral, never business numbers) */
  memory?: string[];
}

export interface ProviderHealth {
  id: string;
  available: boolean;
  detail: string;          // owner-readable, e.g. "no API key configured"
  lastLatencyMs?: number;
  lastError?: string;
}

/** A language provider turns structured intelligence into owner language.
 *  It must never calculate, invent or re-rank — validate.ts enforces this. */
export interface LanguageProvider {
  readonly id: string;
  /** cheap check — config/key presence, never a billed call */
  isAvailable(): Promise<boolean>;
  generate(req: LanguageRequest): Promise<StrategistResponse>;
  health(): Promise<ProviderHealth>;
}

export interface ValidationReport {
  ok: boolean;
  /** repairs applied (confidence downgrades, appended disclosures) */
  repaired: string[];
  /** hard-reject reasons (schema break, ungrounded numbers) */
  rejected: string[];
}

export interface LanguageResult {
  response: StrategistResponse;
  /** which provider produced the final response */
  provider: string;
  /** true when the configured provider failed and templates answered instead */
  fallback: boolean;
  fallbackReason?: string;
  validation: ValidationReport;
  latencyMs: number;
}

/** Owner-facing language settings (app_settings.strategist_settings). */
export interface LanguageSettings {
  provider: "anthropic" | "deterministic";
  allowEnhanced: boolean;       // master switch for external calls
  maxCallsPerDay: number;
}
export const DEFAULT_LANGUAGE_SETTINGS: LanguageSettings = {
  provider: "anthropic",
  allowEnhanced: true,
  maxCallsPerDay: 25,
};
