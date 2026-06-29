/**
 * read-day-report — vision reader for the POS daily product report.
 * Receives a base64 photo, asks Claude (vision) to extract the day's product
 * lines + grand total as strict JSON, and returns it. The Anthropic API key
 * lives ONLY here (Supabase secret ANTHROPIC_API_KEY) — never in the browser.
 *
 * Deploy:  supabase functions deploy read-day-report
 * Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *          (optional) supabase secrets set OCR_MODEL=claude-opus-4-8
 */
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("OCR_MODEL") ?? "claude-opus-4-8";

const SYSTEM = `You read a photo of a point-of-sale DAILY PRODUCT SALES report for a snacks/nuts retail stand. The report is Arabic (right-to-left); each row is one product's sales for a single day.

Return ONLY a JSON object (no markdown, no prose) of exactly this shape:
{
  "date": "YYYY-MM-DD" | null,
  "lines": [
    { "name": string, "barcode": string, "qty": number, "price": number, "total": number }
  ],
  "dayTotal": number | null
}

Rules:
- One report = one day. Read the trading day from the header (e.g. "الفترة من YYYY/MM/DD").
- "name" = the product name exactly as printed (keep the Arabic). "barcode" = the digits if a barcode/code column exists, else "".
- "qty" = quantity/amount sold (may be a weight like 1.115). "price" = unit price it sold at. "total" = the printed line total.
- Do NOT output header, subtotal, supplier-total or grand-total rows as products.
- Output numbers in Western digits even when printed in Arabic-Indic.
- Each line's total should ≈ qty × price, and the line totals should sum to dayTotal. Never invent products that are not in the photo.`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    if (!ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY is not set on the server" }, 500);
    const { image, mediaType } = await req.json();
    if (!image || typeof image !== "string") return json({ error: "missing base64 image" }, 400);

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        system: SYSTEM,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: image } },
            { type: "text", text: "Extract this day's product sales as the specified JSON object only." },
          ],
        }],
      }),
    });
    if (!resp.ok) return json({ error: `anthropic ${resp.status}: ${await resp.text()}` }, 502);

    const data = await resp.json();
    const text = (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("").trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    try {
      return json(JSON.parse(cleaned));
    } catch {
      return json({ error: "model did not return valid JSON", raw: text.slice(0, 2000) }, 502);
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
