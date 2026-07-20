/** Import & receipts — accepts CSV, Excel (.xlsx/.xls) and images (PNG/JPG).
 *  CSV/Excel parse by columns; images are read with in-browser OCR (tesseract.js)
 *  into one or many {date, total} rows. Everything lands in an EDITABLE table so
 *  you fix anything before approving; nothing saves until Approve and duplicate
 *  sale days are skipped. `fixedKind` locks the screen to sales or expenses so
 *  the Sales area never shows expense controls. Heavy libs load on demand. */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import { Card, Eyebrow, Button, Tabs, Input, Badge, Select } from "@/components/ui";
import { EmptyState } from "@/components/feedback";
import {
  scanReceiptRows, scanReceiptText, toIso, toNum, type Row,
  detectSalesMap, detectExpenseMap, rowsWithSalesMap, rowsWithExpenseMap, type SalesMap, type ExpenseMap,
} from "@/core/import/csv";
import { dedupeDailySales, dedupeExpenses } from "@/core/accounting/brain";
import { getChannels, getLocations } from "@/core/read/common";
import { createSale, addExpense, ensureExpenseCategory } from "@/core/db/mutations";
import { egp } from "@/core/utils/format";
import { todayCairo } from "@/core/time";
import { isEngineConfigured, sb, requireEngine } from "@/core/db/engine";
import { useUI } from "@/store/ui";

type Kind = "sales" | "expenses";
interface SaleEdit { date: string; total: string }
interface ExpenseEdit { date: string; category: string; amount: string }

const en = isEngineConfigured;
const isImage = (f: File) => /\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(f.name) || f.type.startsWith("image/");
const isExcel = (f: File) => /\.(xlsx|xls)$/i.test(f.name);

async function readSpreadsheet(file: File): Promise<Row[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: false });
}

export function ReceiptsScreen({ fixedKind }: { fixedKind?: Kind }) {
  const { reportSuccess, reportError, toast } = useUI();
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>(fixedKind ?? "sales");
  const [sales, setSales] = useState<SaleEdit[] | null>(null);
  const [exps, setExps] = useState<ExpenseEdit[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("");       // OCR progress
  const [rawText, setRawText] = useState("");      // what OCR actually read
  const [headers, setHeaders] = useState<string[]>([]); // file columns (CSV/Excel)
  const [raw, setRaw] = useState<Row[] | null>(null);   // raw parsed rows for re-mapping
  const [sMap, setSMap] = useState<SalesMap>({ date: "", total: "" });
  const [eMap, setEMap] = useState<ExpenseMap>({ date: "", category: "", amount: "" });

  const locations = useQuery({ queryKey: ["locations"], queryFn: getLocations, enabled: en });
  const channels = useQuery({ queryKey: ["channels"], queryFn: getChannels, enabled: en });
  const existingDays = useQuery({
    queryKey: ["sale-days"], enabled: en && kind === "sales",
    queryFn: async () => { const { data, error } = await sb!.from("sales").select("sale_date").is("voided_at", null); if (error) throw error; return new Set((data ?? []).map((r) => r.sale_date)); },
  });

  const reset = () => { setSales(null); setExps(null); setFileName(""); setImgUrl(null); setStatus(""); setRawText(""); setHeaders([]); setRaw(null); };
  const savedMapKey = (k: Kind) => `bostaos.import.map.${k}`;
  const loadSavedMap = <T,>(k: Kind): T | null => { try { return JSON.parse(localStorage.getItem(savedMapKey(k)) ?? "null"); } catch { return null; } };
  const saveMap = (k: Kind, m: unknown) => { try { localStorage.setItem(savedMapKey(k), JSON.stringify(m)); } catch { /* ignore */ } };
  const valid = (m: Record<string, string>, hs: string[]) => Object.values(m).every((c) => !c || hs.includes(c));
  const validMap = (m: SalesMap | ExpenseMap, hs: string[]) => valid(m as unknown as Record<string, string>, hs);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    reset();
    setFileName(f.name);
    try {
      if (isImage(f)) {
        setImgUrl(URL.createObjectURL(f));
        setStatus("Loading reader…");
        const Tesseract = (await import("tesseract.js")).default;
        setStatus("Reading image…");
        const { data } = await Tesseract.recognize(f, "eng", {
          logger: (m: { status?: string; progress?: number }) => {
            if (m.status === "recognizing text" && typeof m.progress === "number") setStatus(`Reading image… ${Math.round(m.progress * 100)}%`);
          },
        } as Parameters<typeof Tesseract.recognize>[2]);
        setStatus("");
        setRawText(data.text || "");
        if (kind === "sales") {
          const rows = scanReceiptRows(data.text);
          setSales(rows.length ? brainSales(rows.map((r) => ({ date: r.date, total: String(r.amount) }))) : [{ date: todayCairo(), total: "" }]);
          toast(rows.length ? `Read ${rows.length} row(s) — check & Approve` : "Couldn't auto-read — type the totals from the image", rows.length ? "info" : "error");
        } else {
          const g = scanReceiptText(data.text);
          setExps([{ date: g.date ?? todayCairo(), category: "Other", amount: g.total != null ? String(g.total) : "" }]);
          toast("Image read — check the values, then Approve", "info");
        }
      } else if (isExcel(f)) {
        loadRows(await readSpreadsheet(f));
      } else {
        Papa.parse<Row>(f, { header: true, skipEmptyLines: true, complete: (res) => loadRows(res.data), error: (err) => reportError("Read CSV", err) });
      }
    } catch (err) {
      setStatus("");
      reportError("Import file", err);
    }
  }

  function loadRows(rows: Row[]) {
    if (!rows.length) { toast("No rows found in that file", "error"); return; }
    const hs = Object.keys(rows[0]);
    setHeaders(hs); setRaw(rows);
    if (kind === "sales") {
      const saved = loadSavedMap<SalesMap>("sales");
      const map = saved && validMap(saved, hs) ? saved : detectSalesMap(hs);
      setSMap(map); setSales(brainSales(rowsWithSalesMap(rows, map)));
    } else {
      const saved = loadSavedMap<ExpenseMap>("expenses");
      const map = saved && validMap(saved, hs) ? saved : detectExpenseMap(hs);
      setEMap(map); setExps(brainExp(rowsWithExpenseMap(rows, map)));
    }
  }
  // Run uploaded rows through the accounting brain: collapse double days /
  // identical expense rows, keep anything unparseable for the owner to fix.
  function brainSales(rows: SaleEdit[]): SaleEdit[] {
    const ok = (r: SaleEdit) => toIso(r.date) && toNum(r.total) != null;
    const bad = rows.filter((r) => !ok(r));
    const { clean, dropped } = dedupeDailySales(rows.filter(ok).map((r) => ({ date: toIso(r.date), total: toNum(r.total) })));
    if (dropped > 0) toast(`Skipped ${dropped} duplicate day${dropped === 1 ? "" : "s"}`, "info");
    return [...clean.map((c) => ({ date: c.date, total: String(c.total) })), ...bad];
  }
  function brainExp(rows: ExpenseEdit[]): ExpenseEdit[] {
    const ok = (r: ExpenseEdit) => toIso(r.date) && toNum(r.amount) != null;
    const bad = rows.filter((r) => !ok(r));
    const { clean, dropped } = dedupeExpenses(rows.filter(ok).map((r) => ({ date: toIso(r.date), category: r.category, amount: toNum(r.amount), vendor: null })));
    if (dropped > 0) toast(`Skipped ${dropped} duplicate expense${dropped === 1 ? "" : "s"}`, "info");
    return [...clean.map((c) => ({ date: c.date, category: c.category, amount: String(c.amount) })), ...bad];
  }
  const remapSales = (m: SalesMap) => { setSMap(m); saveMap("sales", m); if (raw) setSales(brainSales(rowsWithSalesMap(raw, m))); };
  const remapExp = (m: ExpenseMap) => { setEMap(m); saveMap("expenses", m); if (raw) setExps(brainExp(rowsWithExpenseMap(raw, m))); };

  const dupSet = existingDays.data ?? new Set<string>();
  const salesView = (sales ?? []).map((r) => {
    const iso = toIso(r.date); const totalNum = toNum(r.total);
    const issues: string[] = []; if (!iso) issues.push("date"); if (totalNum == null) issues.push("total");
    return { ...r, iso, totalNum, issues, dup: !!iso && dupSet.has(iso) };
  });
  const expView = (exps ?? []).map((r) => {
    const iso = toIso(r.date); const amountNum = toNum(r.amount);
    const issues: string[] = []; if (!iso) issues.push("date"); if (amountNum == null) issues.push("amount"); if (!r.category.trim()) issues.push("category");
    return { ...r, iso, amountNum, issues };
  });
  const readyCount = kind === "sales" ? salesView.filter((r) => !r.issues.length && !r.dup).length : expView.filter((r) => !r.issues.length).length;

  const approve = useMutation({
    mutationFn: async () => {
      let imported = 0, skipped = 0, failed = 0;
      const failures: string[] = [];
      if (kind === "sales") {
        const loc = locations.data?.[0], ch = channels.data?.[0];
        if (!loc || !ch) throw new Error("No active location/channel.");
        const seen = new Set(dupSet);
        for (const r of salesView) {
          if (r.issues.length || !r.iso || r.totalNum == null || seen.has(r.iso)) { skipped++; continue; }
          try { await createSale({ date: r.iso, total: r.totalNum, locationId: loc.id, channelId: ch.id }); seen.add(r.iso); imported++; } catch (e) { failed++; if (failures.length < 5) failures.push(`${r.iso}: ${(e as Error)?.message ?? "failed"}`); }
        }
      } else {
        const loc = locations.data?.[0];
        if (!loc) throw new Error("No active location.");
        // Dedupe against expenses ALREADY in the DB — re-uploading the same
        // file must never double-book operating costs. Fingerprint mirrors
        // the seed importer: date|category(lower)|amount(2dp).
        const isos = expView.map((r) => r.iso).filter(Boolean) as string[];
        const existing = new Set<string>();
        if (isos.length) {
          const span = { from: isos.reduce((a, b) => (a < b ? a : b)), to: isos.reduce((a, b) => (a > b ? a : b)) };
          const { data: rows, error } = await requireEngine()
            .from("expenses").select("expense_date,amount,expense_categories(name)")
            .is("voided_at", null).gte("expense_date", span.from).lte("expense_date", span.to);
          if (error) throw error;
          for (const e of rows ?? []) {
            const cat = ((e.expense_categories as { name: string } | null)?.name ?? "").trim().toLowerCase();
            existing.add(`${e.expense_date}|${cat}|${Number(e.amount).toFixed(2)}`);
          }
        }
        const cache = new Map<string, string>();
        for (const r of expView) {
          if (r.issues.length || !r.iso || r.amountNum == null) { skipped++; continue; }
          const fp = `${r.iso}|${r.category.trim().toLowerCase()}|${r.amountNum.toFixed(2)}`;
          if (existing.has(fp)) { skipped++; continue; }
          try {
            const key = r.category.trim().toLowerCase();
            let catId = cache.get(key);
            if (!catId) { catId = await ensureExpenseCategory(r.category.trim(), true); cache.set(key, catId); }
            await addExpense({ date: r.iso, categoryId: catId, amount: r.amountNum, paymentMethod: "cash", notes: null, locationId: loc.id });
            existing.add(fp);
            imported++;
          } catch (e) { failed++; if (failures.length < 5) failures.push(`${r.iso} ${r.category}: ${(e as Error)?.message ?? "failed"}`); }
        }
      }
      return { imported, skipped, failed, failures };
    },
    onSuccess: (res) => {
      reportSuccess("Import", `Imported ${res.imported} · skipped ${res.skipped}${res.failed ? ` · ${res.failed} FAILED — ${res.failures.join(" · ")}` : ""}`);
      qc.invalidateQueries();
      if (res.failed === 0) reset(); // keep the table on partial failure so failed rows can be retried
    },
    onError: (e) => reportError("Import", e),
  });

  if (!en) return <EmptyState title="Sign in to import" />;
  const hasRows = kind === "sales" ? sales != null : exps != null;
  const noun = kind === "sales" ? "daily sales" : "expenses";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>File or photo → review → approve</Eyebrow>
        <div className="flex-1" />
        {!fixedKind && <Tabs value={kind} onChange={(v) => { setKind(v); reset(); }} options={[{ value: "sales", label: "Daily sales" }, { value: "expenses", label: "Expenses" }]} />}
      </div>

      {!hasRows ? (
        <Card className="border-dashed">
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="font-display text-base font-semibold">Add {noun}</div>
            <div className="max-w-md text-sm text-dim">
              CSV, Excel, or photo — {kind === "sales" ? "each dated row becomes a day" : "columns: date, category, amount"}
            </div>
            <label className="lift cursor-pointer rounded-xl bg-pink px-4 py-2.5 font-display text-sm font-semibold text-ink shadow-pink">
              Choose file
              <input type="file" accept=".csv,.xlsx,.xls,.png,.jpg,.jpeg,.webp,image/*" className="hidden" onChange={onFile} />
            </label>
            <div className="text-[11px] text-dim">or</div>
            <Button variant="outline" onClick={() => kind === "sales" ? setSales([{ date: todayCairo(), total: "" }]) : setExps([{ date: todayCairo(), category: "Other", amount: "" }])}>Enter manually</Button>
          </div>
        </Card>
      ) : (
        <>
          {imgUrl && (
            <Card className="!p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <img src={imgUrl} alt="receipt" className="max-h-56 rounded-lg border border-line object-contain" />
                <div className="min-w-0 flex-1 text-[12px] text-dim">
                  <div className="font-display text-sm font-semibold text-text">{fileName}</div>
                  {status ? <div className="mt-1 text-pink">{status}</div> : <div className="mt-1">Check the values.</div>}
                  {rawText && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-pink">What the reader saw</summary>
                      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-panel p-2 font-mono text-[10px] text-muted">{rawText.slice(0, 1200)}</pre>
                    </details>
                  )}
                </div>
              </div>
            </Card>
          )}

          {headers.length > 0 && (
            <Card className="!py-3">
              <div className="mb-1.5 flex items-center gap-2"><Eyebrow>Map your columns</Eyebrow><span className="text-[11px] text-dim">saved for next time</span></div>
              <div className="flex flex-wrap items-end gap-3">
                {kind === "sales" ? (
                  <>
                    <MapSel label="Date column" value={sMap.date} headers={headers} onChange={(v) => remapSales({ ...sMap, date: v })} />
                    <MapSel label="Total column" value={sMap.total} headers={headers} onChange={(v) => remapSales({ ...sMap, total: v })} />
                  </>
                ) : (
                  <>
                    <MapSel label="Date column" value={eMap.date} headers={headers} onChange={(v) => remapExp({ ...eMap, date: v })} />
                    <MapSel label="Category column" value={eMap.category} headers={headers} onChange={(v) => remapExp({ ...eMap, category: v })} />
                    <MapSel label="Amount column" value={eMap.amount} headers={headers} onChange={(v) => remapExp({ ...eMap, amount: v })} />
                  </>
                )}
              </div>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-dim">{fileName || "manual entry"}</span>
            <Badge tone="good">{readyCount} ready</Badge>
            {kind === "sales" && salesView.some((r) => r.dup) && <Badge tone="neutral">{salesView.filter((r) => r.dup).length} duplicate</Badge>}
            <div className="flex-1" />
            <Button variant="ghost" onClick={reset}>Cancel</Button>
            <Button disabled={approve.isPending || readyCount === 0} onClick={() => approve.mutate()}>{approve.isPending ? "Importing…" : `Approve ${readyCount}`}</Button>
          </div>

          <Card className="!p-0">
            <div className="max-h-[55vh] divide-y divide-line overflow-y-auto">
              {kind === "sales" ? salesView.map((r, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${r.issues.length ? "bg-bad" : r.dup ? "bg-dim" : "bg-good"}`} />
                  <Input type="date" value={r.date} onChange={(e) => setSales((s) => s!.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} className="!w-auto" />
                  <Input inputMode="decimal" placeholder="day total" value={r.total} onChange={(e) => setSales((s) => s!.map((x, j) => j === i ? { ...x, total: e.target.value } : x))} className="flex-1" />
                  {r.dup && <span className="text-[11px] text-dim">already imported</span>}
                  <button onClick={() => setSales((s) => s!.filter((_, j) => j !== i))} className="px-1 text-dim hover:text-bad" title="Remove">✕</button>
                </div>
              )) : expView.map((r, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${r.issues.length ? "bg-bad" : "bg-good"}`} />
                  <Input type="date" value={r.date} onChange={(e) => setExps((s) => s!.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} className="!w-auto" />
                  <Input placeholder="category" value={r.category} onChange={(e) => setExps((s) => s!.map((x, j) => j === i ? { ...x, category: e.target.value } : x))} className="w-28" />
                  <Input inputMode="decimal" placeholder="amount" value={r.amount} onChange={(e) => setExps((s) => s!.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} className="flex-1" />
                  <button onClick={() => setExps((s) => s!.filter((_, j) => j !== i))} className="px-1 text-dim hover:text-bad" title="Remove">✕</button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <Button variant="ghost" onClick={() => kind === "sales" ? setSales((s) => [...(s ?? []), { date: todayCairo(), total: "" }]) : setExps((s) => [...(s ?? []), { date: todayCairo(), category: "Other", amount: "" }])}>+ Add row</Button>
              <span className="font-display text-sm font-semibold text-text">
                {kind === "sales" ? egp(salesView.reduce((a, r) => a + (r.totalNum ?? 0), 0)) : egp(expView.reduce((a, r) => a + (r.amountNum ?? 0), 0))}
              </span>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function MapSel({ label, value, headers, onChange }: { label: string; value: string; headers: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-dim">{label}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)} className="min-w-[140px]">
        <option value="">— none —</option>
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </Select>
    </label>
  );
}
