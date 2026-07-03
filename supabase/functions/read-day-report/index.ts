/**
 * read-day-report — VISION-DIRECT reader for the POS daily product report.
 * Receives a base64 photo, asks Claude (vision) to extract the day's product
 * lines + the branch net total as STRICT JSON keyed on the POS item code
 * (كود الصنف). No OCR stage: the model reads the photo and returns the shape the
 * importer's deterministic pipeline (core/import/day-sales) validates and matches.
 *
 * Key resolution: prefers the ANTHROPIC_API_KEY edge secret; else the
 * private_config table (read with the service role — never exposed to the
 * browser). Set the secret later and remove the row to migrate.
 */
const MODEL = Deno.env.get("OCR_MODEL") ?? "claude-opus-4-8";

async function getKey(): Promise<string | null> {
  const env = Deno.env.get("ANTHROPIC_API_KEY") ?? Deno.env.get("ANTHROPIC_KEY") ?? Deno.env.get("anthropic_api_key");
  if (env) return env;
  const url = Deno.env.get("SUPABASE_URL");
  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !svc) return null;
  try {
    const r = await fetch(`${url}/rest/v1/private_config?key=eq.anthropic_api_key&select=value`, {
      headers: { apikey: svc, authorization: `Bearer ${svc}` },
    });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows?.[0]?.value ?? null;
  } catch { return null; }
}

const SYSTEM = `You read a photo of a point-of-sale DAILY PRODUCT SALES report for a snacks/nuts retail stand (brand "Bosta Bites"). The report is Arabic (right-to-left). One report = ONE trading day. Each product row is that product's sales for the day.

Return ONLY a JSON object (no markdown, no prose, no code fences) of EXACTLY this shape:
{
  "sale_date": "YYYY-MM-DD" | null,
  "branch_total_net": number | null,
  "line_items": [
    {
      "item_code": string,          // كود الصنف, digits exactly as printed (keep leading zeros, e.g. "00021296")
      "name_ar": string,            // اسم الصنف / الصنف, the Arabic product name as printed
      "avg_unit_price": number|null,// متوسط سعر البيع
      "qty_sold": number|null,      // الكمية المباعة (a weight like 1.115 or a count; keep decimals)
      "qty_returned": number|null,  // الكمية المرتجعة / المرتجع (0 when absent/blank)
      "net_qty": number|null,       // صافى الكمية  (= qty_sold − qty_returned)
      "net_value": number|null      // صافى القيمة  (the line's net money value)
    }
  ]
}

FIELD SPEC (columns, right-to-left):
- كود الصنف = item code (8-digit, zero-padded). PUT IT IN item_code EXACTLY as printed.
- الباركود = barcode (13 digits). IGNORE it — never place it in any field.
- اسم الصنف (or الصنف) = Arabic product name.
- متوسط سعر البيع = average unit price → avg_unit_price.
- الكمية المباعة (or كمية المبيعات) = quantity sold → qty_sold.
- المبيعات = gross sales value (informational; do not output).
- الكمية المرتجعة / المرتجع = returned quantity → qty_returned (usually 0).
- صافى الكمية = net quantity → net_qty. صافى القيمة = net value → net_value.
- اجمالى الفرع = the BRANCH NET TOTAL → branch_total_net. This is the reconciliation anchor: the net_value of the product rows must sum to it.

DATE: read sale_date from the header "خلال الفترة من YYYY/MM/DD الى YYYY/MM/DD" — use the "من" (from) date. Do NOT use "تاريخ الطباعة" (the print date, which is a different, later day).

REPORT VARIANTS: some days use a simpler layout with columns (كود · الصنف · متوسط سعر البيع · كمية المبيعات) and NO barcode and NO returns column. There, set qty_returned = 0, net_qty = qty_sold, and net_value = the value column.

RULES:
- Output plain Western digits. Never invent products, codes, or numbers.
- Do NOT output header rows or the totals rows (اجمالى المورد / اجمالى الفرع) as line_items — put اجمالى الفرع only in branch_total_net.
- If a value is genuinely unreadable, use null for THAT field rather than guessing.

WORKED EXAMPLE (a real day — 25/12/2024, branch net 4537.94; 3 of its rows shown):
{
  "sale_date": "2024-12-25",
  "branch_total_net": 4537.94,
  "line_items": [
    { "item_code": "00021043", "name_ar": "جامى طوفى فواكه وزن", "avg_unit_price": 149.99, "qty_sold": 0.615, "qty_returned": 0, "net_qty": 0.615, "net_value": 92.24 },
    { "item_code": "00021045", "name_ar": "جامى جيلى كاندى وزن", "avg_unit_price": 275.00, "qty_sold": 4.605, "qty_returned": 0, "net_qty": 4.605, "net_value": 1266.38 },
    { "item_code": "00021296", "name_ar": "كاجو محمص", "avg_unit_price": 1100.00, "qty_sold": 0.110, "qty_returned": 0, "net_qty": 0.110, "net_value": 121.00 }
  ]
}

RETURNS EXAMPLE (how a row with a non-zero return looks — sold 1.000, returned 0.200 at 100.00):
{ "item_code": "00021289", "name_ar": "بريتزل ملح", "avg_unit_price": 100.00, "qty_sold": 1.000, "qty_returned": 0.200, "net_qty": 0.800, "net_value": 80.00 }`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

/** verify_jwt only checks the signature — the PUBLIC anon key is itself a valid
 *  JWT (role "anon"), so without this guard anyone holding the anon key could
 *  invoke the vision model on the owner's Anthropic account. Require a real
 *  signed-in user (role "authenticated"). */
function callerIsAuthenticated(req: Request): boolean {
  try {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "authenticated";
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!callerIsAuthenticated(req)) return json({ error: "sign in required" }, 401);
  try {
    const KEY = await getKey();
    if (!KEY) return json({ error: "No Anthropic API key available (set ANTHROPIC_API_KEY secret or private_config row)", keyPresent: false }, 500);
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
