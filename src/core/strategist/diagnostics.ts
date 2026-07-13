/** Lightweight strategist diagnostics — measured, not assumed. Module-level
 *  so the Tune panel can show real numbers without a telemetry service. */
export interface StrategistTimings {
  snapshotMs: number | null;
  engineMs: number | null;
  syncMs: number | null;
  lastLanguageMs: number | null;
  fallbacks: number;
  validationRepairs: number;
}
export const timings: StrategistTimings = {
  snapshotMs: null, engineMs: null, syncMs: null, lastLanguageMs: null,
  fallbacks: 0, validationRepairs: 0,
};
export async function timed<T>(key: "snapshotMs" | "engineMs" | "syncMs", fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try { return await fn(); } finally { timings[key] = Math.round(performance.now() - t0); }
}
export function timedSync<T>(key: "engineMs", fn: () => T): T {
  const t0 = performance.now();
  try { return fn(); } finally { timings[key] = Math.round(performance.now() - t0); }
}
