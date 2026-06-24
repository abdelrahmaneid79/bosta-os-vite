/** Product-line import — upload a daily POS product-sales sheet (CSV/Excel),
 *  map columns, auto-match products (Arabic + alias), queue unmapped rows for
 *  assignment, preview, then approve. On approve each ready line is attached to
 *  its day's sale (existing day reused; missing day created) via the verified
 *  create_sale_item RPC (COGS snapshot + stock deduction). Never auto-saves;
 *  in-file + against-existing dedupe. Pure parsing/classification lives in
 *  core/import/product-lines.ts (unit-tested). */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import { Card, CardHead, Eyebrow, Button, Badge, Select } from "@/components/ui";
import { EmptyState, SkeletonRows } from "@/components/feedback";
import { ProductPicker } from "@/components/ProductPicker";
import { egp } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured, requireEngine } from "@/core/db/engine";
import { getSearchableProducts } from "@/core/read/products";
import { getLocations, getChannels } from "@/core/read/common";
import { createSale, addSaleItem } from "@/core/db/mutations";
import { buildIndex, autoMatch } from "@/core/products/match";
import {
  detectLineMap, parseProductLines, dedupeLines, classifyLines, summarize,
  type ProductLineMap, type ClassifiedLine,
} from "@/core/import/product-lines";
import type { Row } from "@/core/import/csv";
import { useUI } from "@/store/ui";

const en = isEngineConfigured;
const FIELDS: { key: keyof ProductLineMap; label: string }[] = [
  { key: "date", label: "Date" }, { key: "product", label: "Product" }, { key: "qty", label: "Quantity" },
  { key: "unitPrice", label: "Unit price" }, { key: "lineTotal", label: "Line total" },
];

async function readExcel(file: File): Promise<Row[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: false });
}

export function ProductLineImportScreen() {
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<ProductLineMap | null>(null);
  const [assign, setAssign] = useState<Record<number, string>>({}); // row index → productId override
  const [result, setResult] = useState<{ created: number; skipped: number; failed: number; days: number } | null>(null);

  const prods = useQuery({ queryKey: ["searchable-products"], queryFn: getSearchableProducts, enabled: en });
  const index = useMemo(() => buildIndex(prods.data ?? []), [prods.data]);
  const nameById = useMemo(() => new Map((prods.data ?? []).map((p) => [p.id, p.nameEn])), [prods.data]);

  const classified = useMemo(() => {
    if (!rows || !map) return [];
    const parsed = dedupeLines(parseProductLines(rows, map)).kept;
    const base = classifyLines(parsed, (raw) => { const m = autoMatch(raw, index); return m ? { id: m.id, name: m.nameEn } : null; });
    // apply manual assignments (by row position)
    return base.map((l, i) => assign[i] ? { ...l, productId: assign[i], matchedName: nameById.get(assign[i]) ?? "", status: "ready" as const } : l);
  }, [rows, map, index, assign, nameById]);
  const sum = summarize(classified);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setFileName(f.name); setResult(null); setAssign({});
    const done = (data: Row[]) => {
      const h = data.length ? Object.keys(data[0]) : [];
      setRows(data); setHeaders(h); setMap(detectLineMap(h));
    };
    if (/\.(xlsx|xls)$/i.test(f.name)) readExcel(f).then(done).catch(() => reportError("Import", new Error("Couldn't read the Excel file")));
    else Papa.parse<Row>(f, { header: true, skipEmptyLines: true, complete: (r) => done(r.data), error: () => reportError("Import", new Error("Couldn't parse the CSV")) });
  }

  const approve = useMutation({
    mutationFn: async () => {
      const sb = requireEngine();
      const ready = classified.filter((l) => l.status === "ready") as (ClassifiedLine & { date: string; productId: string })[];
      if (!ready.length) throw new Error("Nothing ready to import.");
      const dates = [...new Set(ready.map((l) => l.date))];
      const [locs, chans, existing] = await Promise.all([
        getLocations(), getChannels(),
        sb.from("sales").select("id,sale_date").is("voided_at", null).in("sale_date", dates),
      ]);
      if (existing.error) throw existing.error;
      const loc = locs[0], ch = chans[0];
      if (!loc || !ch) throw new Error("No active location/channel.");
      const saleByDate = new Map((existing.data ?? []).map((s) => [s.sale_date, s.id as string]));
      // create a sale day where none exists (total = sum of its line totals)
      for (const date of dates) {
        if (saleByDate.has(date)) continue;
        const dayTotal = ready.filter((l) => l.date === date).reduce((s, l) => s + (l.lineTotal ?? 0), 0);
        const id = await createSale({ date, total: Math.round(dayTotal * 100) / 100, locationId: loc.id, channelId: ch.id });
        saleByDate.set(date, id);
      }
      // dedupe against lines already on those days
      const saleIds = [...saleByDate.values()];
      const itemsRes = await sb.from("sale_items").select("sale_id,product_id,quantity,line_total").is("voided_at", null).in("sale_id", saleIds);
      if (itemsRes.error) throw itemsRes.error;
      const seen = new Set((itemsRes.data ?? []).map((i) => `${i.sale_id}|${i.product_id}|${Number(i.quantity)}|${Number(i.line_total)}`));
      let created = 0, skipped = 0, failed = 0;
      for (const l of ready) {
        const saleId = saleByDate.get(l.date)!;
        const key = `${saleId}|${l.productId}|${l.qty}|${l.lineTotal}`;
        if (seen.has(key)) { skipped++; continue; }
        try {
          await addSaleItem({ saleId, productId: l.productId, qty: l.qty ?? 0, unitPrice: l.unitPrice ?? (l.qty ? (l.lineTotal ?? 0) / l.qty : 0), lineTotal: l.lineTotal ?? 0, notes: null });
          seen.add(key); created++;
        } catch { failed++; }
      }
      return { created, skipped, failed, days: dates.length };
    },
    onSuccess: (res) => { setResult(res); reportSuccess("Import product lines", `${res.created} lines added across ${res.days} day(s) · ${res.skipped} duplicates skipped${res.failed ? ` · ${res.failed} failed` : ""}`); qc.invalidateQueries(); },
    onError: (e) => reportError("Import product lines", e),
  });

  if (!en) return <EmptyState title="Sign in to import" />;

  return (
    <div className="space-y-4">
      <Eyebrow>Import product-line sales · preview → approve (never auto-saves)</Eyebrow>

      {!rows ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CardHead title="Upload a product-sales sheet" sub="CSV or Excel — columns like date, product, quantity, unit price, line total" accent="pink" icon="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            <label className="lift cursor-pointer rounded-2xl bg-pink px-4 py-2.5 font-display text-sm font-bold text-ink shadow-pink">
              Choose file<input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} />
            </label>
            <p className="max-w-md text-[12px] text-dim">Each row becomes a sale line on its day. Products are matched by name (Arabic too) or barcode; unmatched rows are queued for you to assign. Stock is deducted and COGS captured automatically.</p>
          </div>
        </Card>
      ) : prods.isLoading ? <SkeletonRows rows={4} /> : (
        <>
          {/* Column mapping */}
          <Card>
            <CardHead title="Map columns" sub={fileName} accent="blue" icon="M4 6h16M4 12h16M4 18h10" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-muted">{f.label}</span>
                  <Select value={map?.[f.key] ?? ""} onChange={(e) => setMap((m) => ({ ...(m as ProductLineMap), [f.key]: e.target.value }))}>
                    <option value="">— none —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </label>
              ))}
            </div>
          </Card>

          {/* Summary + approve */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="good">{sum.ready} ready</Badge>
            {sum.unmapped > 0 && <Badge tone="warn">{sum.unmapped} unmapped</Badge>}
            {sum.invalid > 0 && <Badge tone="bad">{sum.invalid} invalid</Badge>}
            <Badge tone="neutral">{sum.days} day(s)</Badge>
            <div className="flex-1" />
            <Button variant="ghost" onClick={() => { setRows(null); setMap(null); setResult(null); }}>Cancel</Button>
            <Button disabled={approve.isPending || sum.ready === 0} onClick={() => approve.mutate()}>{approve.isPending ? "Importing…" : `Approve ${sum.ready}`}</Button>
          </div>

          {result && (
            <Card><div className="text-sm text-text">Imported <b className="text-good">{result.created}</b> lines across {result.days} day(s){result.skipped ? ` · ${result.skipped} duplicates skipped` : ""}{result.failed ? ` · ${result.failed} failed` : ""}.</div></Card>
          )}

          {/* Preview */}
          <Card className="!p-0">
            <div className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {classified.slice(0, 200).map((l, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${l.status === "ready" ? "bg-good" : l.status === "unmapped" ? "bg-warn" : "bg-bad"}`} />
                  <span className="w-24 flex-shrink-0 text-[12px] text-dim">{l.date ? fmtDate(l.date) : "—"}</span>
                  <span dir="auto" className="min-w-0 flex-1 truncate text-text">{l.rawName || "—"}{l.matchedName && l.matchedName !== l.rawName ? <span className="text-dim"> → {l.matchedName}</span> : ""}</span>
                  <span className="tnum w-24 flex-shrink-0 text-right text-dim">{l.qty ?? "—"} × {l.unitPrice != null ? egp(l.unitPrice) : "—"}</span>
                  <span className="tnum w-20 flex-shrink-0 text-right font-display font-bold text-text">{l.lineTotal != null ? egp(l.lineTotal) : "—"}</span>
                  {l.status === "unmapped" && (
                    <div className="w-full sm:w-64">
                      <ProductPicker value={assign[i] ?? ""} onChange={(id) => setAssign((a) => ({ ...a, [i]: id }))} />
                    </div>
                  )}
                  {l.status === "invalid" && <span className="text-[11px] text-bad">{l.issues.join(", ")}</span>}
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
