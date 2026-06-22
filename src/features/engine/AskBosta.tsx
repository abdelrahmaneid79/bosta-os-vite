/** Ask Bosta — type a plain question, get a real answer from your own numbers.
 *  Runs entirely on-device against the read-models (no external AI). */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, Eyebrow } from "@/components/ui";
import { isEngineConfigured } from "@/core/db/engine";
import { getAssistantContext } from "@/core/read/assistant";
import { askBosta, SUGGESTIONS, type BostaAnswer } from "@/core/assistant/askBosta";

export function AskBostaPanel() {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<BostaAnswer | null>(null);
  const ctx = useQuery({ queryKey: ["assistant-ctx"], queryFn: getAssistantContext, enabled: isEngineConfigured });

  const ask = (question: string) => {
    setQ(question);
    if (ctx.data) setAnswer(askBosta(question, ctx.data));
  };

  return (
    <Card glow className="relative overflow-hidden">
      <div className="flex items-center gap-2">
        <img src="/mascot-96.png" alt="" className="h-7 w-7 object-contain" />
        <Eyebrow>Ask Bosta</Eyebrow>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(q); }} className="mt-2 flex gap-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Ask about revenue, profit, cash, products…"
          className="min-w-0 flex-1 rounded-xl border border-line bg-panel2 px-3.5 py-2.5 text-sm text-text placeholder:text-faint focus:border-pink/60 focus:outline-none"
        />
        <button type="submit" disabled={!ctx.data} className="lift rounded-xl bg-pink px-4 py-2.5 font-display text-sm font-semibold text-ink shadow-pink disabled:opacity-50">Ask</button>
      </form>

      {answer ? (
        <div className="mt-3 rounded-xl border border-line2 bg-panel p-3.5">
          <p className="text-[15px] leading-relaxed text-text">{answer.text}</p>
          {answer.route && <Link to={answer.route} className="mt-1.5 inline-block text-[12px] font-semibold text-pink">Open →</Link>}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={!ctx.data}
              className="rounded-full border border-line bg-panel2 px-3 py-1.5 text-[12px] text-muted hover:border-pink/40 hover:text-text disabled:opacity-50">{s}</button>
          ))}
        </div>
      )}
    </Card>
  );
}
