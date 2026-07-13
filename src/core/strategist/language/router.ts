/** Provider router — the single entry point the UI uses for language.
 *
 *  Routing contract:
 *  1. The deterministic provider ALWAYS works (no key, no cost, no network).
 *  2. An external provider runs only when the owner allows it AND asked for
 *     enhancement — never automatically, never retried on failure.
 *  3. Every external response is validated (schema, numeric grounding,
 *     confidence ceiling, disclosure). Rejections fall back to templates
 *     with the reason attached. Valid Strategy Engine output is never lost. */
import { requireEngine } from "@/core/db/engine";
import { setAppSetting } from "@/core/db/mutations";
import type { StrategistResponse } from "../response";
import { deterministicProvider } from "./deterministic";
import { anthropicProvider, StrategistAuthError } from "./anthropic";
import { validateResponse } from "./validate";
import {
  DEFAULT_LANGUAGE_SETTINGS,
  type LanguageProvider, type LanguageRequest, type LanguageResult, type LanguageSettings, type ProviderHealth,
} from "./types";

/* ── settings (app_settings.strategist_settings) ──────────────────────── */

export async function loadLanguageSettings(): Promise<LanguageSettings> {
  try {
    const { data } = await requireEngine().from("app_settings").select("value").eq("key", "strategist_settings").maybeSingle();
    const v = data?.value as Partial<LanguageSettings> | null;
    return { ...DEFAULT_LANGUAGE_SETTINGS, ...(v ?? {}) };
  } catch {
    return DEFAULT_LANGUAGE_SETTINGS;
  }
}
export const saveLanguageSettings = (s: LanguageSettings): Promise<void> => setAppSetting("strategist_settings", s);

/* ── daily call budget (session-scoped counter; resets per day) ────────── */

const CALLS_KEY = "strategist-calls";
function callsToday(): number {
  try {
    const raw = sessionStorage.getItem(CALLS_KEY);
    const v = raw ? (JSON.parse(raw) as { date: string; n: number }) : null;
    const today = new Date().toISOString().slice(0, 10);
    return v && v.date === today ? v.n : 0;
  } catch { return 0; }
}
function bumpCalls(): void {
  try {
    const today = new Date().toISOString().slice(0, 10);
    sessionStorage.setItem(CALLS_KEY, JSON.stringify({ date: today, n: callsToday() + 1 }));
  } catch { /* sessionStorage unavailable (tests) — budget not enforced */ }
}

/* ── registry (a new provider = one entry here; core layers untouched) ── */

const REGISTRY: Record<string, LanguageProvider> = {
  deterministic: deterministicProvider,
  anthropic: anthropicProvider,
};
/** test seam: lets the suite prove a new provider needs no core changes */
export function registerProvider(p: LanguageProvider): void { REGISTRY[p.id] = p; }

export async function providerHealth(): Promise<ProviderHealth[]> {
  return Promise.all(Object.values(REGISTRY).map((p) => p.health()));
}

/* ── the router ───────────────────────────────────────────────────────── */

export interface GenerateOptions {
  /** owner explicitly asked for the external provider ("Enhance") */
  enhanced?: boolean;
  settings?: LanguageSettings; // injectable for tests
}

async function deterministic(req: LanguageRequest, fallback: boolean, reason: string | undefined, t0: number): Promise<LanguageResult> {
  const response = await deterministicProvider.generate(req);
  return {
    response, provider: "deterministic", fallback,
    ...(reason ? { fallbackReason: reason } : {}),
    validation: { ok: true, repaired: [], rejected: [] }, // templates only render engine output
    latencyMs: Date.now() - t0,
  };
}

export async function generateLanguage(req: LanguageRequest, opts: GenerateOptions = {}): Promise<LanguageResult> {
  const t0 = Date.now();
  const settings = opts.settings ?? await loadLanguageSettings();

  const wantExternal = opts.enhanced === true
    && settings.allowEnhanced
    && settings.provider !== "deterministic";

  if (!wantExternal) return deterministic(req, false, undefined, t0);

  if (callsToday() >= settings.maxCallsPerDay) {
    return deterministic(req, true, `daily language-call limit reached (${settings.maxCallsPerDay})`, t0);
  }

  const provider = REGISTRY[settings.provider] ?? deterministicProvider;
  if (provider.id === "deterministic") return deterministic(req, false, undefined, t0);

  if (!(await provider.isAvailable())) {
    return deterministic(req, true, `${provider.id} is not available`, t0);
  }

  let raw: StrategistResponse;
  try {
    bumpCalls();
    raw = await provider.generate(req); // adapter validates schema; throws on malformed
  } catch (e) {
    if (e instanceof StrategistAuthError) throw e; // auth is the owner's problem, not a fallback
    return deterministic(req, true, `${provider.id} failed: ${String((e as Error).message).slice(0, 140)}`, t0);
  }

  const { response, report } = validateResponse(req, raw);
  if (!report.ok) {
    // ungrounded numbers or schema-level violations → the templates answer,
    // and the reason is surfaced so trust is never silent
    return deterministic(req, true, `response rejected: ${report.rejected.join("; ")}`, t0);
  }
  return { response, provider: provider.id, fallback: false, validation: report, latencyMs: Date.now() - t0 };
}
