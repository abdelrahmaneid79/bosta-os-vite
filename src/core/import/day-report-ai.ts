/**
 * AI day-report reader — uploads a photo of the POS daily product report to the
 * `read-day-report` Supabase Edge Function (which calls Claude vision server-side)
 * and returns structured lines. The importer tries this first for accuracy and
 * falls back to on-device OCR (core/import/ocr-lines) if the function isn't
 * deployed / keyed or errors. No API key ever touches the browser.
 */
import { requireEngine } from "@/core/db/engine";

export interface AiDayLine { name: string; barcode: string; qty: number | null; price: number | null; total: number | null }
export interface AiDayReport { date: string | null; lines: AiDayLine[]; dayTotal: number | null }

async function fileToBase64(file: File): Promise<{ data: string; mediaType: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000; // avoid call-stack limits on large images
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return { data: btoa(binary), mediaType: file.type || "image/jpeg" };
}

const numOrNull = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Signals the reader was called without a usable auth session — the caller
 *  surfaces this (don't silently fall back, or the user never knows why AI failed). */
export class DayReportAuthError extends Error {}

/** Invoke the vision edge function. Throws if unavailable so the caller can fall
 *  back to local OCR. */
export async function readDayReportPhoto(file: File): Promise<AiDayReport> {
  const sb = requireEngine();
  // The function is hardened to reject non-authenticated callers. supabase-js
  // does NOT reliably attach the user token to functions.invoke, so send it
  // EXPLICITLY from the live session — otherwise the call goes out as the anon
  // key and 401s (the real cause of "AI reader never works").
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.access_token) throw new DayReportAuthError("Sign in to use the AI photo reader.");
  const { data: image, mediaType } = await fileToBase64(file);
  const { data, error } = await sb.functions.invoke("read-day-report", {
    body: { image, mediaType },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    const status = (error as { context?: { status?: number } })?.context?.status;
    if (status === 401) throw new DayReportAuthError("The reader rejected the session — sign in again.");
    throw error;
  }
  const payload = data as { error?: string; date?: string | null; lines?: unknown[]; dayTotal?: unknown };
  if (payload?.error) throw new Error(payload.error);
  const lines: AiDayLine[] = (payload?.lines ?? []).map((l) => {
    const o = l as Record<string, unknown>;
    return { name: String(o.name ?? "").trim(), barcode: String(o.barcode ?? "").trim(), qty: numOrNull(o.qty), price: numOrNull(o.price), total: numOrNull(o.total) };
  });
  return { date: payload?.date ?? null, lines, dayTotal: numOrNull(payload?.dayTotal) };
}
