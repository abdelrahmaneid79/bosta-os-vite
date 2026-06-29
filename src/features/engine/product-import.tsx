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
  detectLineMap, parseSheet, parseProductLines, dedupeLines, classifyLines, summarize,
  type ProductLineMap, type ClassifiedLine,
} from "@/core/import/product-lines";
import { parseOcrProductLines } from "@/core/import/ocr-lines";
import type { Row } from "@/core/import/csv";
import { useUI } from "@/store/ui";

const en = isEngineConfigured;
const FIELDS: { key: keyof ProductLineMap; label: string }[] = [
  { key: "barcode", label: "Barcode" }, { key: "product", label: "Product name" }, { key: "qty", label: "Quantity sold" },
  { key: "unitPrice", label: "Unit price" }, { key: "lineTotal", label: "Line total (net value)" }, { key: "date", label: "Date column (optional)" },
];

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
  const [imgUrl, setImgUrl] = useState<string | null>(null); // photo preview
  const [ocrStatus, setOcrStatus] = useState("");            // OCR progress text
  const [ocrText, setOcrText] = useState("");                // what the reader saw
  const [photoTotal, setPhotoTotal] = useState<number | null>(null); // day total printed on the photo

  const prods = useQuery({ queryKey: ["searchable-products"], queryFn: getSearchableProducts, enabled: en });
  const index = useMemo(() => buildIndex(prods.data ?? []), [prods.data]);
  const nameById = useMemo(() => new Map((prods.data ?? []).map((p) => [p.id, p.nameEn])), [prods.data]);

  const classified = useMemo(() => {
    if (!rows || !map) return [];
    const parsed = dedupeLines(parseProductLines(rows, map, dayDate || undefined)).kept;
    // resolve by barcode first (exact, reliable), then by Arabic/English name
    return classifyLines(parsed, (raw, barcode) => {
      const m = (barcode && autoMatch(barcode, index)) || (raw && autoMatch(raw, index)) || null;
      return m ? { id: m.id, name: m.nameEn } : null;
    }).map((l, i) => assign[i] ? { ...l, productId: assign[i], matchedName: nameById.get(assign[i]) ?? "", status: "ready" as const } : l);
  }, [rows, map, dayDate, index, assign, nameById]);
  const sum = summarize(classified);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    e.target.value = "";
    setFileName(f.name); setResult(null); setAssign({}); setImgUrl(null); setOcrText(""); setPhotoTotal(null);
    const done = (grid: unknown[][]) => {
      const sheet = parseSheet(grid);
      setRows(sheet.rows); setHeaders(sheet.headers); setMap(detectLineMap(sheet.headers));
      setDayDate(sheet.date ?? "");
    };
    // Photo of the POS daily report → OCR (Arabic + English) → editable rows.
    if (/\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(f.name) || f.type.startsWith("image/")) {
      setImgUrl(URL.createObjectURL(f));
      try {
        setOcrStatus("Loading reader…");
        const Tesseract = (await import("tesseract.js")).default;
        setOcrStatus("Reading photo…");
        const { data } = await Tesseract.recognize(f, "ara+eng", {
          logger: (m: { status?: string; progress?: number }) => {
            if (m.status === "recognizing text" && typeof m.progress === "number") setOcrStatus(`Reading photo… ${Math.round(m.progress * 100)}%`);
          },
        } as Parameters<typeof Tesseract.recognize>[2]);
        setOcrStatus("");
        setOcrText(data.text || "");
        const parsed = parseOcrProductLines(data.text || "");
        const built: Row[] = parsed.lines.map((l) => ({
          product: l.rawName, barcode: l.barcode,
          qty: l.qty != null ? String(l.qty) : "", price: l.unitPrice != null ? String(l.unitPrice) : "", total: l.lineTotal != null ? String(l.lineTotal) : "",
        }));
        setRows(built);
        setHeaders(["product", "barcode", "qty", "price", "total"]);
        setMap({ date: "", barcode: "barcode", product: "product", qty: "qty", unitPrice: "price", lineTotal: "total" });
        setDayDate(parsed.date ?? "");
        setPhotoTotal(parsed.dayTotal);
        if (!built.length) reportError("Read photo", new Error("Couldn't find product rows — try a sharper, straight-on photo, or upload the Excel export."));
      } catch (err) { setOcrStatus(""); reportError("Read photo", err); }
      return;
    }
    if (/\.(xlsx|xls)$/i.test(f.name)) readExcel(f).then(done).catch(() => reportError("Import", new Error("Couldn't read the Excel file")));
    else Papa.parse<string[]>(f, { skipEmptyLines: true, complete: (r) => done(r.data as unknown[][]), error: () => reportError("Import", new Error("Couldn't parse the CSV")) });
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
            <CardHead title="Add a daily product-sales report" sub="Snap a photo of the POS day report, or upload the CSV/Excel export. Arabic names, barcodes and totals are read automatically." accent="pink" icon="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            <label className="lift cursor-pointer rounded-2xl bg-pink px-4 py-2.5 font-display text-sm font-bold text-ink shadow-pink">
              Choose photo or file<input type="file" accept=".csv,.xlsx,.xls,.png,.jpg,.jpeg,.webp,image/*" className="hidden" onChange={onFile} />
            </label>
            {ocrStatus && <p className="text-[12px] font-medium text-pink">{ocrStatus}</p>}
            <p className="max-w-md text-[12px] text-dim">One report = one day. It reads each product line (name/barcode → product, quantity, price, line total) and the day's grand total, then queues anything unmatched for you to map. Photos are read on-device; nothing saves until you approve.</p>
          </div>
        </Card>
      ) : prods.isLoading ? <SkeletonRows rows={4} /> : (
        <>
          {/* Photo preview + what the reader saw (only for image uploads) */}
          {imgUrl && (
            <Card className="!p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <img src={imgUrl} alt="day report" className="max-h-56 rounded-lg border border-line object-contain" />
                <div className="min-w-0 flex-1 text-[12px] text-dim">
                  <div className="font-display text-sm font-semibold text-text">{fileName}</div>
                  {ocrStatus ? <div className="mt-1 text-pink">{ocrStatus}</div> : <div className="mt-1">Read {rows?.length ?? 0} line(s). Check each below — fix any the reader misread, then approve.</div>}
                  {photoTotal != null && (
                    <div className={`mt-1 ${Math.abs(photoTotal - sum.total) <= 1 ? "text-good" : "text-warn"}`}>
                      Photo day total {egp(photoTotal)} · lines add to {egp(sum.total)}{Math.abs(photoTotal - sum.total) <= 1 ? " ✓ matches" : " — review the difference"}
                    </div>
                  )}
                  {ocrText && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-pink">What the reader saw</summary>
                      <pre dir="auto" className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-panel p-2 font-mono text-[10px] text-muted">{ocrText.slice(0, 1500)}</pre>
                    </details>
                  )}
                </div>
              </div>
            </Card>
          )}

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
            <Button variant="ghost" onClick={() => { setRows(null); setMap(null); setDayDate(""); setResult(null); setImgUrl(null); setOcrText(""); setPhotoTotal(null); setFileName(""); }}>Cancel</Button>
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
