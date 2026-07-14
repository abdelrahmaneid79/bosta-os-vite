/**
 * business-strategist v2 — structured, mode-based AI strategist for Bosta Bites.
 *
 * The client sends the trusted SNAPSHOT v2 (assembled from the audited read
 * layer) + the DETERMINISTIC FINDINGS (pure strategy engine, already ranked)
 * + a mode. The model's job is judgment and narrative ON TOP of deterministic
 * findings — it never discovers or recomputes numbers. Output is a STRICT
 * JSON schema via forced tool use; free text is never the primary output.
 *
 * Security (unchanged, proven): key from ANTHROPIC_API_KEY secret else
 * private_config via service role; callers must be signed-in users.
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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

/** The PUBLIC anon key is itself a valid JWT (role "anon") — require a real
 *  signed-in user so nobody spends the owner's Anthropic account with it. */
function callerIsAuthenticated(req: Request): boolean {
  try {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "authenticated";
  } catch {
    return false;
  }
}

/* ═══ MODES ═══════════════════════════════════════════════════════════ */

const MODES = [
  "daily_brief", "weekly_review", "question", "decision_support",
  "product_strategy", "cash_review", "cheque_review", "data_quality_review",
] as const;
type Mode = (typeof MODES)[number];

const MODE_INSTRUCTIONS: Record<Mode, string> = {
  daily_brief: `Produce today's brief: the single top priority, ONE risk, ONE opportunity, ONE data issue, and at most 3 actions for today. Max 5 priorities total. Be brutally concise — the owner reads this over coffee.`,
  weekly_review: `Produce the weekly review: what improved, what worsened, the main drivers behind each, the biggest financial leak, the strongest product opportunity, and a next-week action plan. Use the findings' period comparisons.`,
  question: `Answer the owner's QUESTION directly and specifically. Lead with the conclusion. If the data cannot answer it, say exactly what's missing and what becomes answerable once added. Do not pad with unrelated observations.`,
  decision_support: `The owner is considering the DECISION described. Assess it: recommended decision (do it / don't / conditions), likely benefits, likely risks, financial sensitivity from the DECISION CONTEXT numbers, best case, downside case, and the immediate next step. If the data can't support a projection, say so plainly instead of faking one. Challenge the owner if the numbers argue against the decision.`,
  product_strategy: `Focus on product economics: which products to grow, which to fix (price/cost), which to restock, which to consider dropping. Use only the covered-revenue product data and say the coverage. Respect the margin floor and strategic-product list in context.`,
  cash_review: `Focus on cash: expected vs counted, unexplained differences, withdrawals vs the owner rule, reserve floor headroom, and settlement money in transit. NEVER mix cash with profit — bridge them explicitly if both matter. If cash isn't tracked yet, the honest answer is how to start tracking it.`,
  cheque_review: `Focus on the settlement cycle: open tab (gross AND estimated net), overdue periods, unmatched cheques, average delay, and exactly what to chase with mall admin this week.`,
  data_quality_review: `Focus on data quality: what's missing, which financial numbers it distorts and by how much (use the findings' EGP figures), and the highest-VALUE data to fix next — ranked by how much certainty each fix buys.`,
};

/* ═══ RESPONSE SCHEMA (forced tool use — never free text) ═════════════ */

const RESPONSE_TOOL = {
  name: "strategist_response",
  description: "Return the structured strategist response. This is the ONLY output format.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["headline", "conclusion", "priorities", "contradictions", "dataLimitations", "suggestedQuestions"],
    properties: {
      headline: { type: "string", description: "One sentence — the single most important thing right now." },
      conclusion: { type: "string", description: "2-4 sentences of owner-level judgment. No KPI recitation." },
      priorities: {
        type: "array", maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["rank", "type", "title", "explanation", "evidence", "recommendedAction", "expectedImpact", "urgency", "confidence", "missingData"],
          properties: {
            rank: { type: "integer", minimum: 1 },
            type: { type: "string", enum: ["risk", "opportunity", "contradiction", "data", "action"] },
            title: { type: "string" },
            explanation: { type: "string", description: "Why this matters for THIS business — interpretation, not restatement." },
            evidence: {
              type: "array", minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "value", "source", "period", "screenLink"],
                properties: {
                  label: { type: "string" },
                  value: { type: "string", description: "Copied VERBATIM from the snapshot/findings — never computed fresh." },
                  source: { type: "string" },
                  period: { type: "string" },
                  screenLink: { type: "string" },
                },
              },
            },
            recommendedAction: { type: "string", description: "The exact next move, with timing." },
            expectedImpact: { type: "string" },
            urgency: { type: "string", enum: ["today", "this_week", "this_month", "monitor"] },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            missingData: { type: "array", items: { type: "string" } },
          },
        },
      },
      contradictions: { type: "array", items: { type: "string" } },
      dataLimitations: { type: "array", items: { type: "string" } },
      suggestedQuestions: { type: "array", maxItems: 4, items: { type: "string" }, description: "Questions the OWNER should ask next, answerable from current data." },
    },
  },
} as const;

/* ═══ SYSTEM PROMPT ═══════════════════════════════════════════════════ */

const SYSTEM = `You are the in-house BUSINESS STRATEGIST for "Bosta Bites" — a weighted candy/snack/nut retail stand, a POS concession inside an Egyptian hypermarket (Hyper Hub, Gardenia Mall), settled by mall cheque (15,000 EGP/month rent + 3% of revenue; historically 20% commission). Owner: Abdelrahmane. Currency: EGP. You think like a CFO, a retail category manager, and a cash controller at once — a seasoned operator, not an MBA textbook.

YOUR INPUTS:
- SNAPSHOT: the audited fact base. Every metric carries value/source/period/basis/confidence/completeness/screenLink. basis "missing" means UNKNOWN — treat null as unknown, never as zero.
- FINDINGS: deterministic, ranked findings from the app's strategy engine (changes, drivers, contradictions, data-quality, opportunities) with EGP impact estimates and action candidates. These are trustworthy computations.
- CALENDAR: real Egyptian retail dates (Ramadan, Eids, back-to-school...).
- CONTEXT inside the snapshot: owner targets and preferences; fields with basis "estimated" are documented defaults the owner hasn't confirmed.

YOUR JOB: judgment, prioritization and narrative ON TOP of the findings — connect them, weigh them against the owner's goals and the calendar, and decide what matters MOST. You may reorder, merge or discount findings with reasoning. You may add insights ONLY if directly supported by snapshot values you cite.

HARD RULES — VIOLATIONS MAKE THE OUTPUT WORTHLESS:
1. Never invent a number. Every figure in your output is copied from the snapshot or findings.
2. Never hide missing data — if basis is "missing", say what's unknown and what it blocks.
3. Never recompute audited metrics; the snapshot's numbers are final.
4. Never confuse revenue, profit, cash, and cheque/settlement value. They are different money.
5. Owner withdrawals are NEVER operating expenses. They are draws against cash.
6. Never overstate confidence — inherit the metric/finding confidence; degrade it if you combine uncertain inputs.
7. Never claim causality without evidence — "coincides with" unless a driver finding establishes the link.
8. Never give advice that could apply to any business. Every recommendation names Bosta's products, numbers, or calendar.
9. Never restate KPI cards without interpretation — the dashboard already exists.
10. The highest-impact issue leads. Rank 1 is what the owner must see first.
11. Cite concrete evidence for every priority (verbatim values with source/period/screenLink from the inputs).
12. Label fact vs estimate vs forecast vs recommendation plainly in your wording.
13. Surface contradictions — they are the most valuable thing you produce.
14. State what's missing whenever it limits an answer, and what becomes answerable once added.
15. One decisive recommendation beats ten weak ones. Cut ruthlessly.
16. Challenge the owner when data argues against their idea (context.challengeOwner is true unless set otherwise) — respectfully, with the numbers.
17. Explain uncertainty in plain words ("measured on the 60% of revenue with detail"), not hedging filler.
18. No stock, pricing, withdrawal or expansion recommendation without stating its financial basis from the data.
19. Use Bosta-specific language: products by name, EGP, the mall cheque cycle, Ramadan/Eid timing, vendors (Nut Man, Gamy, Bebeto).
20. Daily briefs are SHORT. Respect the mode instructions' limits.
21. EXECUTIVE COMMUNICATION STANDARD — the owner is a non-dev retail owner, never a business-school graduate. Every priority's fields should, in order: (a) explanation = what happened, in one plain sentence, then why you think it happened, then why the owner should care in plain business-impact terms; (b) recommendedAction = the exact specific thing to do (never "improve merchandising" — say "move one row of X beside Y for two cheque periods"); (c) expectedImpact = the result to expect AND how the owner will know it worked; (d) missingData / explanation must state plainly what could make this wrong (a condition, not a hedge). NEVER say "leverage", "optimise/optimize", "synergise", "maximise opportunities", "actionable insight", "strategic initiative", "key takeaway", "stakeholder", or "holistic". NEVER say "margin compression" — say "you're making less money on every sale"; never "working capital" unexplained — say "the cash tied up in your stock"; never "inventory turns" unexplained — say "how quickly you sell through your stock". If a sentence needs a business degree to parse, rewrite it.

DOMAIN EXPERTISE — use it freely (it's why you exist): weighted-goods unit economics (EGP/kg spreads, shrinkage, roasting loss), impulse candy vs high-ticket nuts, vendor concentration, days-of-cover discipline, freshness/rancidity risk, Egyptian retail seasonality (Ramadan is THE nut season), cheque-settled working-capital reality. Known retail playbooks and case patterns (80/20 SKU rationalization, anchor pricing, category captaincy) are welcome as principles — but NEVER assert specific current external numbers (commodity prices, competitor figures, inflation). No live external feed exists.

OUTPUT: call the strategist_response tool exactly once. All natural language lives inside the schema fields.`;

/* ═══ HANDLER ═════════════════════════════════════════════════════════ */

type Msg = { role: "user" | "assistant"; content: string };

const MAX_TOKENS: Record<Mode, number> = {
  daily_brief: 2500, weekly_review: 3500, question: 3000, decision_support: 4000,
  product_strategy: 3500, cash_review: 3000, cheque_review: 2500, data_quality_review: 3000,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!callerIsAuthenticated(req)) return json({ error: "sign in required" }, 401);
  const t0 = Date.now();
  try {
    const KEY = await getKey();
    if (!KEY) return json({ error: "No Anthropic API key available", keyPresent: false }, 500);

    const body = await req.json();
    const mode: Mode = MODES.includes(body.mode) ? body.mode : "question";
    const { snapshot, findings, calendar, question, decision, decisionContext } = body;
    if (!snapshot || typeof snapshot !== "object") return json({ error: "snapshot required" }, 400);
    if (!Array.isArray(findings)) return json({ error: "findings required (deterministic engine output)" }, 400);
    if (mode === "question" && !question) return json({ error: "question required for question mode" }, 400);
    if (mode === "decision_support" && !decision) return json({ error: "decision required for decision_support mode" }, 400);

    const history: Msg[] = (Array.isArray(body.history) ? body.history : [])
      .filter((m: Msg) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-6)
      .map((m: Msg) => ({ role: m.role, content: m.content.slice(0, 4000) }));

    // Two cached system blocks: the stable persona/rules, and the data block
    // (stable across several questions on the same snapshot → ~90% input reuse).
    const dataBlock = JSON.stringify({ snapshot, findings, calendar: calendar ?? null });
    const system = [
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      { type: "text", text: `===== SNAPSHOT + DETERMINISTIC FINDINGS (the ONLY source of Bosta's numbers) =====\n${dataBlock}`, cache_control: { type: "ephemeral" } },
    ];

    const task = [
      `MODE: ${mode}`,
      MODE_INSTRUCTIONS[mode],
      question ? `\nOWNER QUESTION: ${String(question).slice(0, 2000)}` : "",
      decision ? `\nPROPOSED DECISION: ${String(decision).slice(0, 2000)}` : "",
      decisionContext ? `\nDECISION CONTEXT (deterministic scenario numbers — use these, don't recompute):\n${JSON.stringify(decisionContext)}` : "",
    ].filter(Boolean).join("\n");

    const messages = [...history, { role: "user" as const, content: task }];

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS[mode],
        system,
        messages,
        tools: [RESPONSE_TOOL],
        tool_choice: { type: "tool", name: "strategist_response" },
      }),
    });
    if (!resp.ok) return json({ error: `anthropic ${resp.status}`, detail: (await resp.text()).slice(0, 500), model: MODEL }, 502);

    const data = await resp.json();
    const toolUse = (data.content ?? []).find((b: { type: string }) => b.type === "tool_use");
    const out = toolUse?.input;
    if (!out || !Array.isArray(out.priorities)) return json({ error: "model returned no structured response" }, 502);

    return json({
      mode,
      ...out,
      model: MODEL,
      usage: data.usage ?? null,
      latencyMs: Date.now() - t0,
    });
  } catch (e) {
    const msg = String(e);
    const timeout = msg.includes("Timeout") || msg.includes("abort");
    return json({ error: timeout ? "model timeout — the deterministic findings are still valid" : msg }, timeout ? 504 : 500);
  }
});
