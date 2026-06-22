/** Friendly error mapping for writes. Supabase's PostgrestError is a plain
 *  object ({ message, details, hint, code }) and is frequently NOT an instance
 *  of Error — so `e instanceof Error ? e.message : "Save failed"` silently
 *  swallows the real database message. This maps the common Postgres / PostgREST
 *  / auth failures to an owner-friendly sentence while ALWAYS preserving the raw
 *  message so it stays screenshot-able for debugging. Pure + unit-tested. */

export interface FriendlyError {
  title: string;       // owner-friendly explanation
  raw: string;         // the original message, never discarded
  code?: string;       // Postgres SQLSTATE / PostgREST code, when present
}

interface ErrLike { message?: unknown; code?: unknown; details?: unknown; hint?: unknown }

function asErrLike(err: unknown): ErrLike {
  if (err && typeof err === "object") return err as ErrLike;
  return { message: String(err) };
}

/** Extract the best raw message from any thrown value (Error, PostgrestError, string). */
export function rawMessage(err: unknown): string {
  const e = asErrLike(err);
  const parts = [e.message, e.details, e.hint].filter((p): p is string => typeof p === "string" && p.length > 0);
  return parts[0] ?? (parts.length ? parts.join(" · ") : "Unknown error");
}

export function explainError(err: unknown): FriendlyError {
  const e = asErrLike(err);
  const raw = rawMessage(err);
  const code = typeof e.code === "string" ? e.code : undefined;
  const msg = raw.toLowerCase();

  // RLS / permissions
  if (code === "42501" || msg.includes("row-level security") || msg.includes("permission denied")) {
    return { title: "Permission denied — your account can't write here (check RLS policies)", raw, code };
  }
  // Unique violation (e.g. duplicate sale day, duplicate alias)
  if (code === "23505" || msg.includes("duplicate key") || msg.includes("already exists")) {
    return { title: "That record already exists", raw, code };
  }
  // Foreign-key violation (referenced row missing / still referenced)
  if (code === "23503" || msg.includes("foreign key")) {
    return { title: "A linked record is missing or still in use", raw, code };
  }
  // Not-null / check violation (bad/missing field)
  if (code === "23502" || code === "23514" || msg.includes("violates not-null") || msg.includes("violates check")) {
    return { title: "A required field is missing or out of range", raw, code };
  }
  // RPC not found / schema drift
  if (code === "PGRST202" || msg.includes("could not find the function") || msg.includes("does not exist")) {
    return { title: "A backend function is missing or changed (schema drift)", raw, code };
  }
  // Auth / session expired
  if (code === "PGRST301" || msg.includes("jwt") || msg.includes("not authenticated") || msg.includes("invalid token")) {
    return { title: "Your session expired — sign in again", raw, code };
  }
  // Network / offline
  if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("load failed")) {
    return { title: "Couldn't reach the server — check your connection and retry", raw, code };
  }
  // Fallback: surface the real message (never a generic "Save failed")
  return { title: raw, raw, code };
}

/** One-line toast text: friendly title, plus the raw/code appended when the
 *  friendly title differs (so the exact DB error stays visible for screenshots). */
export function errorMessage(err: unknown): string {
  const { title, raw, code } = explainError(err);
  if (title === raw) return code ? `${title} [${code}]` : title;
  return code ? `${title} — ${raw} [${code}]` : `${title} — ${raw}`;
}
