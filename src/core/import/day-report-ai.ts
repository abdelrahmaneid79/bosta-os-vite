/**
 * AI day-report reader — uploads a photo of the POS daily product report to the
 * `read-day-report` Supabase Edge Function (Claude vision, server-side key) and
 * returns the strict `RawDayReport` the day-sales pipeline validates. VISION-
 * DIRECT: the model returns item-code-keyed lines + the branch net total; there
 * is no OCR fallback (the old on-device reader couldn't read the item code, which
 * is the whole matching key). No API key ever touches the browser.
 */
import { requireEngine } from "@/core/db/engine";
import type { RawDayReport, RawDayLine } from "@/core/import/day-sales";

async function fileToBase64(file: File): Promise<{ data: string; mediaType: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000; // avoid call-stack limits on large images
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return { data: btoa(binary), mediaType: file.type || "image/jpeg" };
}

const numOrNull = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Signals the reader was called without a usable auth session — the caller
 *  surfaces this (don't hide it, or the owner never learns why AI failed). */
export class DayReportAuthError extends Error {}

/** Invoke the vision edge function and normalise its JSON into a RawDayReport.
 *  Throws DayReportAuthError when not signed in, or the function's error. */
export async function readDayReportPhoto(file: File): Promise<RawDayReport> {
  const sb = requireEngine();
  // supabase-js does NOT reliably attach the user token to functions.invoke, so
  // send it EXPLICITLY from the live session — otherwise the call goes out as the
  // anon key and 401s (the real cause of "the AI reader never works").
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
  const payload = data as { error?: string; sale_date?: string | null; branch_total_net?: unknown; line_items?: unknown[] };
  if (payload?.error) throw new Error(payload.error);

  const line_items: RawDayLine[] = (payload?.line_items ?? []).map((l) => {
    const o = l as Record<string, unknown>;
    return {
      item_code: String(o.item_code ?? "").trim(),
      barcode: String(o.barcode ?? "").trim(),
      name_ar: String(o.name_ar ?? "").trim(),
      avg_unit_price: numOrNull(o.avg_unit_price),
      qty_sold: numOrNull(o.qty_sold),
      qty_returned: numOrNull(o.qty_returned) ?? 0,
      net_qty: numOrNull(o.net_qty),
      net_value: numOrNull(o.net_value),
    };
  });
  return {
    sale_date: payload?.sale_date ?? null,
    branch_total_net: numOrNull(payload?.branch_total_net),
    line_items,
  };
}
