/** Lightweight strategist diagnostics — measured, not assumed. Module-level
 *  so the Tune panel can show real numbers without a telemetry service. */
export interface StrategistTimings {
  snapshotMs: number | null;
  engineMs: number | null;
  syncMs: number | null;
  exceptionMs: number | null;
  lastLanguageMs: number | null;
  fallbacks: number;
  validationRepairs: number;
  failedMutations: number;
}
export const timings: StrategistTimings = {
  snapshotMs: null, engineMs: null, syncMs: null, exceptionMs: null, lastLanguageMs: null,
  fallbacks: 0, validationRepairs: 0, failedMutations: 0,
};
export async function timed<T>(key: "snapshotMs" | "engineMs" | "syncMs" | "exceptionMs", fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try { return await fn(); } finally { timings[key] = Math.round(performance.now() - t0); }
}
export function timedSync<T>(key: "engineMs", fn: () => T): T {
  const t0 = performance.now();
  try { return fn(); } finally { timings[key] = Math.round(performance.now() - t0); }
}
export function recordFailedMutation(): void { timings.failedMutations += 1; }

/* ── production diagnostics surface (Phase 18) ─────────────────────────── */

export interface DiagnosticsInput {
  buildVersion: string;
  migrationVersion: string;
  edgeFunctionVersion: string | null;
  activationState: string;
  lastDataDate: string | null;
  staleDays: number | null;
  previewedImports: number;
  visibleExceptions: number;
}

/** Assemble a restrained, copyable diagnostic summary — troubleshooting only,
 *  never secrets, tokens, or raw financial records. Pure. */
export function buildDiagnostics(i: DiagnosticsInput): { lines: [string, string][]; text: string } {
  const lines: [string, string][] = [
    ["Build", i.buildVersion],
    ["DB migration", i.migrationVersion],
    ["Edge function", i.edgeFunctionVersion ?? "n/a"],
    ["Activation", i.activationState],
    ["Last data date", i.lastDataDate ?? "none"],
    ["Books stale (days)", i.staleDays == null ? "n/a" : String(i.staleDays)],
    ["Snapshot ms", fmt(timings.snapshotMs)],
    ["Engine ms", fmt(timings.engineMs)],
    ["Exception engine ms", fmt(timings.exceptionMs)],
    ["Language ms", fmt(timings.lastLanguageMs)],
    ["Provider fallbacks", String(timings.fallbacks)],
    ["Validation repairs", String(timings.validationRepairs)],
    ["Failed mutations", String(timings.failedMutations)],
    ["Imports awaiting approval", String(i.previewedImports)],
    ["Open exceptions", String(i.visibleExceptions)],
  ];
  const text = lines.map(([k, v]) => `${k}: ${v}`).join("\n");
  return { lines, text };
}
const fmt = (n: number | null) => (n == null ? "n/a" : `${n}`);
