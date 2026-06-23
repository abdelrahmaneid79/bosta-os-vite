/** QA Mode — an in-app checklist of every write flow that the owner can run
 *  locally and mark pass/fail (persisted in localStorage), plus a live
 *  diagnostics feed of recent writes with copy-back support. Read-only itself:
 *  it never writes to Supabase. */
import { useState } from "react";
import { Card, Eyebrow, Button, Badge } from "@/components/ui";
import { useUI } from "@/store/ui";
import { QA_FLOWS, QA_GROUPS, type QAFlow } from "./checklist";

type Status = "" | "pass" | "fail";
const KEY = "bostaos.qa.v1";

function load(): Record<string, Status> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; }
}

export function QAScreen() {
  const [status, setStatus] = useState<Record<string, Status>>(load);
  const { diagnostics, clearDiagnostics } = useUI();

  const set = (id: string, s: Status) => {
    const next = { ...status, [id]: s };
    setStatus(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const reset = () => { setStatus({}); try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

  const total = QA_FLOWS.length;
  const passed = QA_FLOWS.filter((f) => status[f.id] === "pass").length;
  const failed = QA_FLOWS.filter((f) => status[f.id] === "fail").length;

  const copyResults = () => {
    const lines = QA_FLOWS.map((f) => `[${status[f.id] === "pass" ? "PASS" : status[f.id] === "fail" ? "FAIL" : "    "}] ${f.group} · ${f.action} → ${f.expected} (${f.touches})`);
    navigator.clipboard?.writeText(`BostaOS QA results — ${passed}/${total} pass, ${failed} fail\n\n${lines.join("\n")}`);
  };
  const copyDiagnostics = () => {
    const lines = diagnostics.map((d) => `${d.at} [${d.kind}] ${d.context}: ${d.message}${d.raw && d.raw !== d.message ? ` | raw: ${d.raw}` : ""}${d.code ? ` [${d.code}]` : ""}`);
    navigator.clipboard?.writeText(`BostaOS diagnostics (${diagnostics.length})\n\n${lines.join("\n") || "none yet"}`);
  };

  return (
    <div className="space-y-5">
      {/* Summary */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <Eyebrow>Local write QA</Eyebrow>
            <div className="font-display text-2xl font-semibold">{passed}<span className="text-dim">/{total}</span> passed{failed > 0 && <span className="text-bad"> · {failed} failed</span>}</div>
          </div>
          <div className="flex-1" />
          <Button variant="outline" onClick={copyResults}>Copy results</Button>
          <Button variant="ghost" onClick={reset}>Reset</Button>
        </div>
        <p className="mt-2 text-[12px] text-dim">Run each flow against your live Supabase, then mark it. Status is saved in this browser only. If a write fails, copy diagnostics below and send them over.</p>
      </Card>

      {/* Checklist by group */}
      {QA_GROUPS.map((group) => (
        <div key={group} className="space-y-2">
          <Eyebrow>{group}</Eyebrow>
          {QA_FLOWS.filter((f) => f.group === group).map((f) => (
            <Row key={f.id} flow={f} status={status[f.id] ?? ""} onSet={(s) => set(f.id, s)} />
          ))}
        </div>
      ))}

      {/* Diagnostics */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Eyebrow>Recent writes &amp; errors · {diagnostics.length}</Eyebrow>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!diagnostics.length} onClick={copyDiagnostics}>Copy diagnostics</Button>
            <Button variant="ghost" disabled={!diagnostics.length} onClick={clearDiagnostics}>Clear</Button>
          </div>
        </div>
        {diagnostics.length === 0 ? (
          <Card><p className="text-sm text-dim">Nothing yet. Perform a write — successes and errors will appear here with copyable details.</p></Card>
        ) : (
          <Card className="!p-0"><div className="divide-y divide-line">
            {diagnostics.map((d) => (
              <div key={d.id} className="flex items-start gap-3 px-4 py-2.5">
                <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${d.kind === "error" ? "bg-bad" : "bg-good"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="font-display text-sm font-semibold text-text">{d.context}</span><span className="text-[10px] text-dim">{d.at.slice(11, 19)}</span></div>
                  <div className="text-[12.5px] text-muted">{d.message}</div>
                  {d.raw && d.raw !== d.message && <div className="mt-0.5 font-mono text-[11px] text-dim">{d.raw}{d.code ? ` [${d.code}]` : ""}</div>}
                </div>
              </div>
            ))}
          </div></Card>
        )}
      </div>
    </div>
  );
}

function Row({ flow, status, onSet }: { flow: QAFlow; status: Status; onSet: (s: Status) => void }) {
  return (
    <Card className="!p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm font-semibold text-text">{flow.action}</span>
            {status === "pass" && <Badge tone="good">passed</Badge>}
            {status === "fail" && <Badge tone="bad">failed</Badge>}
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted">Expect: {flow.expected}</div>
          <div className="mt-0.5 font-mono text-[11px] text-dim">{flow.screen} · {flow.touches}</div>
        </div>
        <div className="flex flex-shrink-0 gap-1">
          <button onClick={() => onSet(status === "pass" ? "" : "pass")} className={`rounded-lg border px-2.5 py-1 text-xs ${status === "pass" ? "border-good bg-good/15 text-good" : "border-line text-dim hover:text-text"}`}>Pass</button>
          <button onClick={() => onSet(status === "fail" ? "" : "fail")} className={`rounded-lg border px-2.5 py-1 text-xs ${status === "fail" ? "border-bad bg-bad/15 text-bad" : "border-line text-dim hover:text-text"}`}>Fail</button>
        </div>
      </div>
    </Card>
  );
}
