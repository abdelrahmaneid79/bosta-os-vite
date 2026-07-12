/** Client seam for the v2 strategist edge function.
 *  Same proven auth pattern as v1: live session token attached explicitly,
 *  401 → StrategistAuthError. The payload now carries the trusted snapshot,
 *  the deterministic findings, and a mode — never a bare chat message. */
import { requireEngine } from "@/core/db/engine";
import { getSession } from "@/core/db/session";
import type { StrategistSnapshot } from "./contract";
import type { Finding } from "./analysis/types";
import type { DecisionContext } from "./analysis/decision";
import type { CalendarContext } from "./calendar";
import { parseStrategistResponse, type StrategistResponse } from "./response";

export type StrategistMode =
  | "daily_brief" | "weekly_review" | "question" | "decision_support"
  | "product_strategy" | "cash_review" | "cheque_review" | "data_quality_review";

export class StrategistAuthError extends Error {
  constructor() { super("Sign in to use the strategist."); }
}
/** Model unavailable/timeout — deterministic findings remain valid; UI falls back. */
export class StrategistUnavailableError extends Error {}

export interface AskV2Args {
  mode: StrategistMode;
  snapshot: StrategistSnapshot;
  findings: Finding[];
  calendar?: CalendarContext;
  question?: string;
  decision?: string;
  decisionContext?: DecisionContext;
  history?: { role: "user" | "assistant"; content: string }[];
}

export async function askStrategistV2(args: AskV2Args): Promise<StrategistResponse> {
  const sb = requireEngine();
  const session = await getSession();
  if (!session) throw new StrategistAuthError();

  const { data, error } = await sb.functions.invoke("business-strategist", {
    body: args,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 401) throw new StrategistAuthError();
    if (status === 502 || status === 504) throw new StrategistUnavailableError(String(error.message ?? "model unavailable"));
    throw new Error(`Strategist call failed: ${error.message ?? String(error)}`);
  }
  if (data?.error) {
    if (String(data.error).includes("timeout")) throw new StrategistUnavailableError(String(data.error));
    throw new Error(String(data.error));
  }
  return parseStrategistResponse(data);
}
