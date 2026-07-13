/** Idempotency + concurrency safety for writes (Cycle 9, Phase 13).
 *
 *  A double-click, browser retry, offline reconnect or second tab can fire the
 *  same logical write twice. Each at-risk mutation carries a client-generated
 *  idempotency key stored in a UNIQUE partial index (migration 0036). The
 *  SECOND insert then fails with a 23505 on the *_idem index — which we treat
 *  as success (the record already saved), never surfacing a scary duplicate
 *  error. A 23505 on any OTHER constraint (e.g. the one-active-sale-day index)
 *  is a real conflict and still throws. */

/** A stable key for one logical submission. Reuse the SAME key across retries
 *  of the same action; generate a fresh one for a genuinely new action. */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface PgErrLike { code?: unknown; message?: unknown; details?: unknown; constraint?: unknown }

/** True when an insert failed because our idempotency key already exists —
 *  i.e. the identical write already succeeded. Matches only the *_idem indexes
 *  so other unique violations still propagate. */
export function isIdempotentDuplicate(err: unknown): boolean {
  const e = (err ?? {}) as PgErrLike;
  if (e.code !== "23505") return false;
  const hay = `${String(e.constraint ?? "")} ${String(e.message ?? "")} ${String(e.details ?? "")}`.toLowerCase();
  return hay.includes("_idem");
}
