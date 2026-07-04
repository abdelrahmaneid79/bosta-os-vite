/** Product-line import (CSV/Excel) — upload a daily POS product-sales SHEET,
 *  map columns, auto-match products (barcode + Arabic/alias), queue unmapped rows
 *  for assignment, preview, then approve. On approve each ready line is attached
 *  to its day's sale (existing day reused; missing day created) via the verified
 *  create_sale_item RPC (COGS snapshot + stock deduction). Never auto-saves;
 *  in-file + against-existing dedupe. Pure parsing/classification lives in
 *  core/import/product-lines.ts (unit-tested).
 *
 *  The PHOTO path is a separate, code-matched pipeline — see
 *  features/engine/day-sales-import.tsx (the primary daily flow). */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  detectLineMap, parseSheet, parseProductLines, dedupeLines, classifyLines, summarize,
  type ProductLineMap, type ClassifiedLine,
} from "@/core/import/product-lines";
import { detectCostMap, parseCosts, classifyCosts, summarizeCosts, type CostMap } from "@/core/import/product-costs";
import { applyProductCosts } from "@/core/db/mutations";
import type { Row } from "@/core/import/csv";
import { useUI } from "@/store/ui";

const en = isEngineConfigured;
const FIELDS: { key: keyof ProductLineMap; label: string }[] = [
  { key: "barcode", label: "Barcode" }, { key: "product", label: "Product name" }, { key: "qty", label: "Quantity sold" },
  { key: "unitPrice", label: "Unit price" }, { key: "lineTotal", label: "Line total (net value)" }, { key: "date", label: "Date column (optional)" },
];

/** Line confidence, persisted to sale_items.verification. Structured import
 *  (CSV/Excel) or a user-assigned product = verified; photo-derived auto-matches
 *  are unverified until confirmed; lines whose price/total don't reconcile are
 *  estimated. Minimal by design (charter): enum + badge + this default, no rule engine. */
type Conf = "verified" | "unverified" | "estimated";
function confidenceOf(l: { qty: number | null; unitPrice: number | null; lineTotal: number | null }, fromPhoto: boolean, userAssigned: boolean): Conf {
  if (!fromPhoto || userAssigned) return "verified";
  const { qty: q, unitPrice: p, lineTotal: t } = l;
  const reconciles = q != null && p != null && t != null && Math.abs(q * p - t) <= Math.max(1, 0.02 * Math.abs(t));
  return reconciles ? "unverified" : "estimated";
}
const CONF_STYLE: Record<Conf, string> = {
  verified: "bg-good/15 text-good",
  unverified: "bg-white/[0.06] text-muted",
  estimated: "bg-warn/15 text-warn",
};

/** Read any sheet to a raw 2-D array (rows × cells), so the parser can locate the
 *  real header row beneath the POS metadata. */
async function readExcel(file: File): Promise<unknown[][]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false, blankrows: false });
}

export function ProductLineImportScreen() {
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<ProductLineMap | null>(null);
  const [dayDate, setDayDate] = useState("");                       // the single day this file covers
  const [assign, setAssign] = useState<Record<number, string>>({}); // row index → productId override
  const [result, setResult] = useState<{ created: number; skipped: number; failed: number; days: number } | null>(null);

  const prods = useQuery({ queryKey: ["searchable-products"], queryFn: getSearchableProducts, enabled: en });
  const index = useMemo(() => buildIndex(prods.data ?? []), [prods.data]);
  const nameById = useMemo(() => new Map((prods.data ?? []).map((p) => [p.id, p.nameEn])), [prods.data]);

  // The most recent sale day that has NO product lines yet — the one to capture
  // next. Prefills the date and headlines the upload card (daily habit = one tap).
  const missingDay = useQuery({
    queryKey: ["recent-day-missing-lines"], enabled: en,
    queryFn: async (): Promise<string | null> => {
      const sb = requireEngine();
      const days = await sb.from("sales").select("id,sale_date").is("voided_at", null).order("sale_date", { ascending: false }).limit(90);
      if (days.error) throw days.error;
      const ids = (days.data ?? []).map((d) => d.id);
      if (!ids.length) return null;
      const items = await sb.from("sale_items").select("sale_id").is("voided_at", null).in("sale_id", ids);
      if (items.error) throw items.error;
      const withLines = new Set((items.data ?? []).map((i) => i.sale_id));
      return (days.data ?? []).find((d) => !withLines.has(d.id))?.sale_date ?? null;
    },
  });

  const classified = useMemo(() => {
    if (!rows || !map) return [];
    const parsed = dedupeLines(parseProductLines(rows, map, dayDate || undefined)).kept;
    // resolve by barcode first (exact, reliable), then by Arabic/English name
    return classifyLines(parsed, (raw, barcode) => {
      const m = (barcode && autoMatch(barcode, index)) || (raw && autoMatch(raw, index)) || null;
      return m ? { id: m.id, name: m.nameEn } : null;
    }).map((l, i) => {
      const userAssigned = !!assign[i];
      const base = userAssigned ? { ...l, productId: assign[i], matchedName: nameById.get(assign[i]) ?? "", status: "ready" as const } : l;
      return { ...base, confidence: confidenceOf(base, false, userAssigned) };
    });
  }, [rows, map, dayDate, index, assign, nameById]);
  const sum = summarize(classified);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    e.target.value = "";
    setFileName(f.name); setResult(null); setAssign({});
    const done = (grid: unknown[][]) => {
      const sheet = parseSheet(grid);
      setRows(sheet.rows); setHeaders(sheet.headers); setMap(detectLineMap(sheet.headers));
      setDayDate(sheet.date ?? "");
    };
    if (/\.(xlsx|xls)$/i.test(f.name)) readExcel(f).then(done).catch(() => reportError("Import", new Error("Couldn't read the Excel file")));
    else Papa.parse<string[]>(f, { skipEmptyLines: true, complete: (r) => done(r.data as unknown[][]), error: () => reportError("Import", new Error("Couldn't parse the CSV")) });
  }

  const approve = useMutation({
    mutationFn: async () => {
      const sb = requireEngine();
      const ready = classified.filter((l) => l.status === "ready") as (ClassifiedLine & { date: string; productId: string; confidence: Conf })[];
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
          await addSaleItem(
            { saleId, productId: l.productId, qty: l.qty ?? 0, unitPrice: l.unitPrice ?? (l.qty ? (l.lineTotal ?? 0) / l.qty : 0), lineTotal: l.lineTotal ?? 0, notes: null },
            l.confidence, // provenance: verified / unverified / estimated
          );
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
            <CardHead title="Upload a CSV/Excel day export" sub="For the POS daily product-sales export as a spreadsheet. Columns (barcode, name, qty, price, net value) are auto-detected; matched by barcode/name." accent="pink" icon="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            <label className="lift cursor-pointer rounded-2xl bg-pink px-4 py-2.5 font-display text-sm font-bold text-ink shadow-pink">
              Choose file<input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} />
            </label>
            {missingDay.data && <p className="text-[12px] font-semibold text-pink">Next up: {fmtDate(missingDay.data)} has no product lines yet.</p>}
            <p className="max-w-md text-[12px] text-dim">One export = one day. It reads each product line and the day's grand total, then queues anything unmatched for you to map. Nothing saves until you approve.</p>
            <p className="text-[12px] text-faint">Have a photo of the report instead? <Link to="/sales/product-lines" className="text-pink underline">Use the photo importer</Link> — it matches by POS code.</p>
          </div>
        </Card>
      ) : prods.isLoading ? <SkeletonRows rows={4} /> : (
        <>
          {/* Sale date for the whole file (POS report = one day) */}
          <Card>
            <CardHead title="Sale day" sub="This report covers one day — auto-detected from the file, confirm or change it." accent="pink" icon="M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5" />
            <input type="date" value={dayDate} onChange={(e) => setDayDate(e.target.value)}
              className="w-full max-w-xs rounded-2xl border border-line bg-panel2 px-3.5 py-2.5 text-sm text-text outline-none focus:border-pink/60" />
            {!dayDate && <p className="mt-2 text-[12px] text-warn">Couldn’t read the date from the file — pick the day these sales belong to.</p>}
          </Card>

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
            <Badge tone="pink">day total {egp(sum.total)}</Badge>
            <div className="flex-1" />
            <Button variant="ghost" onClick={() => { setRows(null); setMap(null); setDayDate(""); setResult(null); setFileName(""); }}>Cancel</Button>
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
                  {l.status === "ready" && <span className={`flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${CONF_STYLE[l.confidence]}`}>{l.confidence}</span>}
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

/** Read a normal table (headers on row 0) from Excel into header-keyed rows. */
async function readSheetObjects(file: File): Promise<Row[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });
}

const COST_FIELDS: { key: keyof CostMap; label: string }[] = [
  { key: "barcode", label: "Barcode" }, { key: "name", label: "Product name" },
  { key: "cost", label: "Cost price" }, { key: "price", label: "Selling price" },
];

/** Product-cost import — upload a portfolio file (cost + selling price per
 *  product), auto-detect columns, match by barcode/name, preview, then apply:
 *  sets reference_cost + selling_price and refreshes lifetime margins. */
export function ProductCostImportScreen() {
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<CostMap | null>(null);
  const [assign, setAssign] = useState<Record<number, string>>({});
  const [result, setResult] = useState<{ products: number; lifetime: number } | null>(null);

  const prods = useQuery({ queryKey: ["searchable-products"], queryFn: getSearchableProducts, enabled: en });
  const index = useMemo(() => buildIndex(prods.data ?? []), [prods.data]);
  const nameById = useMemo(() => new Map((prods.data ?? []).map((p) => [p.id, p.nameEn])), [prods.data]);

  const classified = useMemo(() => {
    if (!rows || !map) return [];
    return classifyCosts(parseCosts(rows, map), (name, barcode) => {
      const m = (barcode && autoMatch(barcode, index)) || (name && autoMatch(name, index)) || null;
      return m ? { id: m.id, name: m.nameEn } : null;
    }).map((l, i) => assign[i] ? { ...l, productId: assign[i], matchedName: nameById.get(assign[i]) ?? "", status: "ready" as const } : l);
  }, [rows, map, index, assign, nameById]);
  const sum = summarizeCosts(classified);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setFileName(f.name); setResult(null); setAssign({});
    const done = (rs: Row[]) => {
      if (!rs.length) { reportError("Import costs", new Error("No rows found in that file.")); return; }
      const hs = Object.keys(rs[0]); setRows(rs); setHeaders(hs); setMap(detectCostMap(hs));
    };
    if (/\.(xlsx|xls)$/i.test(f.name)) readSheetObjects(f).then(done).catch(() => reportError("Import costs", new Error("Couldn't read the Excel file")));
    else Papa.parse<Row>(f, { header: true, skipEmptyLines: true, complete: (r) => done(r.data), error: () => reportError("Import costs", new Error("Couldn't parse the CSV")) });
  }

  const approve = useMutation({
    mutationFn: () => {
      const ready = classified.filter((l) => l.status === "ready" && l.productId);
      if (!ready.length) throw new Error("Nothing ready to apply.");
      return applyProductCosts(ready.map((l) => ({ productId: l.productId!, barcode: l.barcode, cost: l.cost, price: l.price })));
    },
    onSuccess: (res) => { setResult(res); reportSuccess("Apply product costs", `Updated ${res.products} product(s) · refreshed ${res.lifetime} lifetime margin(s)`); qc.invalidateQueries(); },
    onError: (e) => reportError("Apply product costs", e),
  });

  if (!en) return <EmptyState title="Sign in to import" />;

  return (
    <div className="space-y-4">
      <Eyebrow>Product costs · set cost + selling price for the whole catalogue → real margins</Eyebrow>
      {!rows ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CardHead title="Upload your product portfolio" sub="CSV/Excel with cost price + selling price per product. Columns (barcode, name, cost, price) are auto-detected; matched by barcode first." accent="pink" icon="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            <label className="lift cursor-pointer rounded-2xl bg-pink px-4 py-2.5 font-display text-sm font-bold text-ink shadow-pink">
              Choose file<input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} />
            </label>
            <p className="max-w-md text-[12px] text-dim">The cost you give is taken as the real finished-good unit cost. Applying sets each product's cost (drives profit/COGS) + selling price, and refreshes margins everywhere. Nothing saves until you approve.</p>
          </div>
        </Card>
      ) : prods.isLoading ? <SkeletonRows rows={4} /> : (
        <>
          <Card>
            <CardHead title="Map columns" sub={fileName} accent="blue" icon="M4 6h16M4 12h16M4 18h10" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {COST_FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-muted">{f.label}</span>
                  <Select value={map?.[f.key] ?? ""} onChange={(e) => setMap((m) => ({ ...(m as CostMap), [f.key]: e.target.value }))}>
                    <option value="">— none —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </label>
              ))}
            </div>
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="good">{sum.ready} ready</Badge>
            {sum.unmapped > 0 && <Badge tone="warn">{sum.unmapped} unmapped</Badge>}
            {sum.invalid > 0 && <Badge tone="bad">{sum.invalid} invalid</Badge>}
            <Badge tone="pink">{sum.withCost} costs · {sum.withPrice} prices</Badge>
            <div className="flex-1" />
            <Button variant="ghost" onClick={() => { setRows(null); setMap(null); setResult(null); setFileName(""); }}>Cancel</Button>
            <Button disabled={approve.isPending || sum.ready === 0} onClick={() => approve.mutate()}>{approve.isPending ? "Applying…" : `Apply ${sum.ready}`}</Button>
          </div>

          {result && <Card><div className="text-sm text-text">Updated <b className="text-good">{result.products}</b> product(s) · refreshed <b className="text-good">{result.lifetime}</b> lifetime margin(s).</div></Card>}

          <Card className="!p-0">
            <div className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {classified.slice(0, 400).map((l, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${l.status === "ready" ? "bg-good" : l.status === "unmapped" ? "bg-warn" : "bg-bad"}`} />
                  <span dir="auto" className="min-w-0 flex-1 truncate text-text">{l.name || l.barcode || "—"}{l.matchedName && l.matchedName !== l.name ? <span className="text-dim"> → {l.matchedName}</span> : ""}</span>
                  <span className="tnum w-44 flex-shrink-0 text-right text-dim">cost {l.cost != null ? egp(l.cost) : "—"} · sell {l.price != null ? egp(l.price) : "—"}</span>
                  {l.status === "unmapped" && (
                    <div className="w-full sm:w-64"><ProductPicker value={assign[i] ?? ""} onChange={(id) => setAssign((a) => ({ ...a, [i]: id }))} /></div>
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
