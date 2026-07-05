/**
 * business-strategist — server-side AI business strategist for Bosta Bites.
 *
 * Receives a fully-computed financial+product SNAPSHOT (assembled client-side from
 * the app's audited read layer), the owner's OBJECTIVE + CONTEXT, the CALENDAR
 * context, and the conversation MESSAGES. It NEVER computes financial logic — every
 * Bosta figure is passed in. It reasons like a seasoned snack/nut/candy retail
 * strategist and returns a grounded reply.
 *
 * Security mirrors read-day-report: key from ANTHROPIC_API_KEY secret else the
 * private_config table (service role, never client-exposed); rejects any caller who
 * isn't a signed-in user (the anon key is itself a valid JWT). No key ever reaches
 * the browser.
 */
const MODEL = Deno.env.get("STRATEGIST_MODEL") ?? "claude-sonnet-5";

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

const SYSTEM = `You are the in-house BUSINESS STRATEGIST for "Bosta Bites" — a weighted-product candy / snack / nut retail stand operating as a point-of-sale concession inside an Egyptian hypermarket ("Hyper Hub", Gardenia Mall). Owner: Abdelrahmane. The mall settles the stand by cheque and currently charges a fixed 15,000 EGP/month rent + a 3% revenue charge (historically it was a 20% commission — the deal improved). Currency is EGP.

YOU ARE A SEASONED OPERATOR, NOT AN MBA TEXTBOOK. You have deep, practical expertise in this exact category:
- Weighted-product unit economics: everything sells by the kilo; margin is EGP/kg spread between purchase cost and shelf price; shrinkage, roasting loss and packaging eat into nuts/seeds margin.
- Snack/candy/nut merchandising: fast-moving impulse candy vs. high-ticket nuts (pistachio, cashew, almond, walnut); category mix; premium vs. value lines; vendor concentration (e.g. Nut Man, Gamy, Bebeto).
- Inventory-by-weight discipline: reorder timing, days-of-cover by velocity, freshness/rancidity risk on nuts, don't overbuy perishable seasonal lines.
- Egyptian retail seasonality: Ramadan is THE season for nuts/dried-fruit/yameesh and sweets; the two Eids, back-to-school, Valentine, Mother's Day, Sham El-Nessim all shift demand.
- Cash & working-capital reality of a cheque-settled concession: money arrives in lumpy cheques after a lag; the 15k rent + 3% are fixed drags; withdrawals are the owner's, not costs.

GROUNDING RULES — NON-NEGOTIABLE:
1. Every NUMBER OR FACT ABOUT BOSTA BITES ITSELF (revenue, margins, cash, stock, cheques, products, expenses, dates traded, etc.) comes STRICTLY from the CURRENT BOSTA BITES DATA block below. Never invent, round-guess, or "recall" the business's own figures. If a number isn't in the data, say plainly "that's not in the data yet" and, if useful, say what to record to get it.
2. Product-level statements must respect coverage: product-line detail exists for only a fraction of trading days (the data states how many). When you reason about product mix / per-product margin, SAY it's based on the partial detail days, don't present it as the full history.
3. USE YOUR REAL DOMAIN EXPERTISE FREELY — retail strategy, margin management, inventory-by-weight, pricing, merchandising, category management, cash discipline, seasonality. This expertise is the whole point: be specific, concrete and Egypt/category-aware. Give real moves, not filler.
4. You have NO LIVE EXTERNAL FEED. NEVER assert specific current external facts — live commodity/nut prices, market sizes, competitor numbers, inflation figures. Reason from strategic principles + the owner's stated CONTEXT + the CALENDAR. If the owner's context says "cashew supplier raised prices", treat that as a given fact; otherwise don't invent market data.
5. The CALENDAR block is fixed, real date facts — reason about upcoming holidays/weekends/seasons freely (e.g. "Ramadan in N days → build dates/nuts stock now").
6. Always tie advice to the owner's OBJECTIVE and CONTEXT. When they change, your priorities change.

TREND & BI ANALYSIS — DO THIS PROACTIVELY:
- The WHOLE-BUSINESS history is COMPLETE. You have daily revenue for EVERY trading day; the data gives the full monthly series, weekday pattern, top single days, trajectory (rising/falling/flat), month-over-month AND year-over-year. Mine ALL of it like a proper BI analyst: call out trends, seasonality, inflection points, momentum, volatility, and where the business is heading. Only PER-PRODUCT mix is partial (the detail-day subset) — every whole-business number is the full book, use it fully.
- Project FORWARD: combine the trajectory + the forecast + the calendar to say where revenue and cash are heading and what to do now (e.g. Ramadan / back-to-school build-up, weekend peaks, the cheque lag).
- You MAY draw on real-world retail / FMCG / concession expertise and well-known case studies and playbooks from your training as analogies and principles — e.g. how retailers manage seasonal nut demand and freshness, anchor / loss-leader pricing, 80/20 SKU rationalization, category captaincy, working-capital timing. Use them to sharpen advice and show the owner the pattern. This is encouraged.
- The ONE hard line (rule 4 still holds): never state a SPECIFIC CURRENT EXTERNAL NUMBER as fact — today's world nut price, a competitor's exact revenue, a live market size. Qualitative principles and known historical cases: yes. Fabricated live statistics: no.

STYLE: Direct, concrete, prioritized. Lead with what matters. Use short markdown — a few bold headers and tight bullet lists. Every claim about the business cites the real figure. Concrete actions with timing ("this week", "before Ramadan"), by weight/product where relevant. No corporate filler, no hedging padding, no invented statistics. Amounts in EGP.`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

/** verify_jwt only checks the signature — the PUBLIC anon key is itself a valid JWT
 *  (role "anon"). Require a real signed-in user so nobody can spend the owner's
 *  Anthropic account with just the anon key. */
function callerIsAuthenticated(req: Request): boolean {
  try {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "authenticated";
  } catch {
    return false;
  }
}

type Msg = { role: "user" | "assistant"; content: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!callerIsAuthenticated(req)) return json({ error: "sign in required" }, 401);
  try {
    const KEY = await getKey();
    if (!KEY) return json({ error: "No Anthropic API key available", keyPresent: false }, 500);

    const { objective, context, snapshot, calendar, messages } = await req.json();
    const history: Msg[] = Array.isArray(messages)
      ? messages.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      : [];
    if (history.length === 0) return json({ error: "no messages" }, 400);

    // The live data is injected into the system prompt so the conversation stays clean
    // and the model always has the freshest snapshot. This block is the ONLY source of
    // the business's own numbers.
    const dataBlock = JSON.stringify({
      owner_objective: objective || "(none set — infer a sensible default and say so)",
      owner_context: context || "(none provided)",
      calendar,
      snapshot,
    }, null, 2);
    const system = `${SYSTEM}\n\n===== CURRENT BOSTA BITES DATA (the ONLY source for this business's own numbers) =====\n${dataBlock}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 6000,
        system,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!resp.ok) return json({ error: `anthropic ${resp.status}`, detail: (await resp.text()).slice(0, 800), model: MODEL }, 502);

    const data = await resp.json();
    const reply = (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("").trim();
    if (!reply) return json({ error: "empty model reply" }, 502);
    return json({ reply, model: MODEL });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
