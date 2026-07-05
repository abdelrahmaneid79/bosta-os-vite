/** The ONLY writable strategist state (rule 9): the owner's objective + situational
 *  context, stored as owner text in app_settings. No business data is ever written. */
import { requireEngine } from "@/core/db/engine";
import { setAppSetting } from "@/core/db/mutations";

export interface StrategistConfig { objective: string; context: string }

const asStr = (v: unknown): string => (typeof v === "string" ? v : "");

export async function getStrategistConfig(): Promise<StrategistConfig> {
  const { data, error } = await requireEngine()
    .from("app_settings").select("key,value").in("key", ["strategist_objective", "strategist_context"]);
  if (error) throw error;
  const map = new Map((data ?? []).map((r) => [r.key as string, r.value]));
  return { objective: asStr(map.get("strategist_objective")), context: asStr(map.get("strategist_context")) };
}

export const saveObjective = (v: string): Promise<void> => setAppSetting("strategist_objective", v);
export const saveContext = (v: string): Promise<void> => setAppSetting("strategist_context", v);
