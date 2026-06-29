/**
 * read-day-report — vision reader for the POS daily product report.
 * Receives a base64 photo, asks Claude (vision) to extract the day's product
 * lines + grand total as strict JSON. The Anthropic key lives ONLY here (Supabase
 * secret ANTHROPIC_API_KEY) — never in the browser.
 *
 * Set the secret (deterministic):
 *   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref <ref>
 *   npx supabase secrets list --project-ref <ref>   # confirm it appears
 */
const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? Deno.env.get("ANTHROPIC_KEY") ?? Deno.env.get("anthropic_api_key");
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

Column meanings (right-to-left in the report): كود الصنف = item code, الباركود = barcode (13 digits), اسم الصنف = product name, متوسط سعر البيع = unit price, صافى الكمية = net quantity (often a weight like 1.115 or 0.820 — keep the decimal), صافى القيمة = net value (the line total).

Rules:
- One report = one day. Read the trading day from the header (e.g. "الفترة من YYYY/MM/DD").
- "name" = the Arabic product name as printed. "barcode" = the 13-digit barcode. "qty" = صافى الكمية (net qty, keep decimals). "price" = متوسط سعر البيع. "total" = صافى القيمة.
- Do NOT treat the barcode or item-code as qty/price/total. Do NOT output header, subtotal (اجمالى المورد / اجمالى الفرع) rows as products.
- Output numbers in plain Western digits. Each line's total must ≈ qty × price, and the line totals should sum to dayTotal (the printed اجمالى). Never invent products.`;

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
    if (!KEY) return json({ error: "ANTHROPIC_API_KEY is not set on the server", keyPresent: false }, 500);
    const { image, mediaType } = await req.json();
    if (!image || typeof image !== "string") return json({ error: "missing base64 image" }, 400);

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
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
    if (!resp.ok) return json({ error: `anthropic ${resp.status}`, detail: (await resp.text()).slice(0, 800), model: MODEL }, 502);

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
