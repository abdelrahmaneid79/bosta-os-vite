/** Anthropic adapter — the ONLY strategist file that knows Anthropic exists.
 *  Client side it is transport-only: the model name, prompts, tool schema,
 *  caching and Anthropic error shapes live in the `business-strategist` edge
 *  function (the server half of this adapter). Nothing outside this file may
 *  depend on any of that. */
import { requireEngine } from "@/core/db/engine";
import { getSession } from "@/core/db/session";
import { parseStrategistResponse, type StrategistResponse } from "../response";
import { StrategistAuthError, ProviderUnavailableError, type LanguageProvider, type LanguageRequest, type ProviderHealth } from "./types";

let lastHealth: { latencyMs?: number; error?: string } = {};

export class AnthropicProvider implements LanguageProvider {
  readonly id = "anthropic";

  /** Cheap check only: a session exists (the edge fn requires auth). Never a
   *  billed call — real availability surfaces on the first generate(). */
  async isAvailable(): Promise<boolean> {
    try { return !!(await getSession()); } catch { return false; }
  }

  async health(): Promise<ProviderHealth> {
    const available = await this.isAvailable();
    return {
      id: this.id, available,
      detail: available
        ? (lastHealth.error ? `last call failed: ${lastHealth.error}` : "edge function reachable (cost only on use)")
        : "not signed in",
      lastLatencyMs: lastHealth.latencyMs,
      lastError: lastHealth.error,
    };
  }

  async generate(req: LanguageRequest): Promise<StrategistResponse> {
    const sb = requireEngine();
    const session = await getSession();
    if (!session) throw new StrategistAuthError();

    const t0 = Date.now();
    const { data, error } = await sb.functions.invoke("business-strategist", {
      body: {
        mode: req.mode,
        snapshot: req.snapshot,
        findings: req.findings,
        calendar: req.calendar ?? null,
        question: req.question,
        decision: req.decision,
        decisionContext: req.decisionContext,
        history: [
          ...(req.memory?.length ? [{ role: "user" as const, content: `OWNER MEMORY (behavioral context, never business data): ${req.memory.join(" | ")}` }] : []),
          ...(req.history ?? []),
        ],
      },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    lastHealth.latencyMs = Date.now() - t0;

    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status;
      lastHealth.error = `HTTP ${status ?? "?"}`;
      if (status === 401) throw new StrategistAuthError();
      throw new ProviderUnavailableError(String(error.message ?? "language service failed"));
    }
    if (data?.error) {
      lastHealth.error = String(data.error).slice(0, 120);
      throw new ProviderUnavailableError(String(data.error));
    }
    lastHealth.error = undefined;
    return parseStrategistResponse(data); // throws on malformed → router falls back
  }
}

export const anthropicProvider = new AnthropicProvider();
