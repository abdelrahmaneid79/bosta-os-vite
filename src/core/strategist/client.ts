/** Client seam to the `business-strategist` Edge Function. Mirrors day-report-ai:
 *  supabase-js does not reliably attach the user token to functions.invoke, so we
 *  send it explicitly from the live session — otherwise the call goes out as the
 *  anon key and 401s. No API key ever touches the browser. */
import { requireEngine } from "@/core/db/engine";
import type { BusinessSnapshot } from "./snapshot";
import type { CalendarContext } from "./calendar";

export interface StrategistMessage { role: "user" | "assistant"; content: string }

/** Thrown when called without a usable auth session — surface it, don't hide it. */
export class StrategistAuthError extends Error {}

export async function askStrategist(params: {
  objective: string;
  context: string;
  snapshot: BusinessSnapshot;
  calendar: CalendarContext;
  messages: StrategistMessage[];
}): Promise<string> {
  const sb = requireEngine();
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.access_token) throw new StrategistAuthError("Sign in to use the strategist.");
  const { data, error } = await sb.functions.invoke("business-strategist", {
    body: params,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    const status = (error as { context?: { status?: number } })?.context?.status;
    if (status === 401) throw new StrategistAuthError("The strategist rejected the session — sign in again.");
    throw error;
  }
  const payload = data as { error?: string; reply?: string };
  if (payload?.error) throw new Error(payload.error);
  return (payload?.reply ?? "").trim();
}
