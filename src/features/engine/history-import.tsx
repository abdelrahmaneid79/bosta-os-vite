/** "Load my Bosta Bites history" — a one-click screen that turns the bundled,
 *  already-cleaned real ledgers into ordinary editable entries. It previews a
 *  reconciliation (so the owner sees the totals before committing), lets them
 *  pick which sections to load, then imports with live progress. Idempotent:
 *  anything already present is skipped, so it is safe to run again. */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, Eyebrow, Button, Badge } from "@/components/ui";
import { EmptyState } from "@/components/feedback";
import { egp, num } from "@/core/utils/format";
import { isEngineConfigured } from "@/core/db/engine";
import { useUI } from "@/store/ui";
import {
  fetchSeedBundle, previewBundle, runSeedImport,
  type SeedOptions, type SeedReport, type Progress, type SeedKind,
} from "@/core/import/seed";

const KINDS: { key: SeedKind; label: string; help: string }[] = [
  { key: "sales", label: "Daily sales", help: "One revenue entry per trading day" },
  { key: "expenses", label: "Expenses + Stock", help: "Operating costs and stock buys, one Stock bucket" },
  { key: "cheques", label: "Settlement cheques", help: "Cash received from the mall — a separate ledger, never changes profit" },
  { key: "products", label: "Product catalogue", help: "Names + barcodes for faster future imports (no stock/cost)" },
];

export function HistoryImportScreen() {
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const [opts, setOpts] = useState<SeedOptions>({ sales: true, expenses: true, cheques: true, products: true });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [report, setReport] = useState<SeedReport | null>(null);

  const bundle = useQuery({ queryKey: ["seed-bundle"], queryFn: fetchSeedBundle, enabled: isEngineConfigured, staleTime: Infinity });
  const pv = bundle.data ? previewBundle(bundle.data) : null;

  const run = useMutation({
    mutationFn: async () => {
      setReport(null);
      return runSeedImport(bundle.data!, opts, (p) => setProgress(p));
    },
    onSuccess: (res) => {
      setProgress(null); setReport(res);
      const created = Object.values(res).reduce((a, r) => a + r.created, 0);
      reportSuccess("History loaded", `Created ${created} new entries — open any section to view or edit them.`);
      qc.invalidateQueries();
    },
    onError: (e) => { setProgress(null); reportError("Load history", e); },
  });

  if (!isEngineConfigured) return <EmptyState title="Sign in to load history" />;

  const anySelected = Object.values(opts).some(Boolean);
  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;

  return (
    <div className="space-y-4">
      <Card accent="#F868C8">
        <Eyebrow accent="#F868C8">Load my Bosta Bites history</Eyebrow>
        <p className="mt-2 max-w-2xl text-sm text-dim">
          This brings in your real numbers — cleaned and de-duplicated by the accounting brain — as
          ordinary entries you can view, edit or void anywhere in the app. Nothing is hardcoded.
          Running it again only adds what's missing.
        </p>
        <p className="mt-2 max-w-2xl text-[12px] text-faint">
          Accurate cost accounting starts on your bookkeeping date; everything before it is shown as
          revenue-only history, so the profit figures stay honest.
        </p>
      </Card>

      {bundle.isLoading ? (
        <Card><div className="py-6 text-center text-sm text-dim">Reading your ledgers…</div></Card>
      ) : bundle.isError ? (
        <Card><div className="py-6 text-center text-sm text-bad">Couldn't read the history files. {(bundle.error as Error)?.message}</div></Card>
      ) : pv && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <PickCard kind="sales" on={opts.sales} onToggle={() => setOpts((o) => ({ ...o, sales: !o.sales }))}
              stat={`${num(pv.sales.rows)} days · ${egp(pv.sales.total)}`} sub={`${pv.sales.from} → ${pv.sales.to}`} />
            <PickCard kind="expenses" on={opts.expenses} onToggle={() => setOpts((o) => ({ ...o, expenses: !o.expenses }))}
              stat={`${num(pv.expenses.rows)} rows · ${egp(pv.expenses.total)}`} sub={`Stock ${egp(pv.expenses.stock)} · operating ${egp(pv.expenses.operating)}`} />
            <PickCard kind="cheques" on={opts.cheques} onToggle={() => setOpts((o) => ({ ...o, cheques: !o.cheques }))}
              stat={`${num(pv.cheques.rows)} cheques · ${egp(pv.cheques.total)}`} sub="Cash inflow ledger" />
            <PickCard kind="products" on={opts.products} onToggle={() => setOpts((o) => ({ ...o, products: !o.products }))}
              stat={`${num(pv.products.rows)} products`} sub={`${num(pv.products.withBarcode)} with barcodes`} />
          </div>

          {progress ? (
            <Card>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-display font-semibold capitalize">Importing {progress.phase}…</span>
                <span className="text-dim">{progress.done} / {progress.total}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-line2"><div className="h-full rounded-full bg-pink transition-all" style={{ width: `${pct}%` }} /></div>
            </Card>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-dim">Idempotent — already-loaded entries are skipped automatically.</span>
              <div className="flex-1" />
              <Button disabled={!anySelected || run.isPending} onClick={() => run.mutate()}>
                {run.isPending ? "Importing…" : "Load selected history"}
              </Button>
            </div>
          )}

          {report && (
            <Card>
              <Eyebrow>Import summary</Eyebrow>
              <div className="mt-2 divide-y divide-line2">
                {KINDS.filter((k) => opts[k.key]).map((k) => {
                  const r = report[k.key];
                  return (
                    <div key={k.key} className="flex items-center gap-2 py-2 text-sm">
                      <span className="flex-1 font-display font-semibold">{k.label}</span>
                      <Badge tone="good">{r.created} new</Badge>
                      {r.skipped > 0 && <Badge tone="neutral">{r.skipped} already there</Badge>}
                      {r.failed > 0 && <Badge tone="bad">{r.failed} failed</Badge>}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function PickCard({ kind, on, onToggle, stat, sub }: { kind: SeedKind; on: boolean; onToggle: () => void; stat: string; sub: string }) {
  const meta = KINDS.find((k) => k.key === kind)!;
  return (
    <button onClick={onToggle} className={`lift rounded-2xl border p-4 text-left transition ${on ? "border-pink/50 bg-pink/[0.06]" : "border-line bg-panel2 opacity-70"}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${on ? "border-pink bg-pink text-ink" : "border-line2 text-transparent"}`}>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-semibold text-text">{meta.label}</div>
          <div className="mt-0.5 font-display text-base font-semibold text-text">{stat}</div>
          <div className="text-[11px] text-dim">{sub}</div>
          <div className="mt-1 text-[11px] text-faint">{meta.help}</div>
        </div>
      </div>
    </button>
  );
}
