/** Sales import & receipts — accepts CSV, Excel (.xlsx/.xls) and images
 *  (PNG/JPG). CSV/Excel are parsed by columns; images are read with in-browser
 *  OCR (tesseract.js) into a best-guess (date, total). Everything lands in an
 *  EDITABLE preview so you fix anything before approving — nothing saves until
 *  you click Approve, and duplicate sale days are skipped. Heavy libs are loaded
 *  on demand so they never bloat the initial app. */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import { Card, Eyebrow, Button, Tabs, Input, Badge } from "@/components/ui";
import { EmptyState } from "@/components/feedback";
import { parseSalesRows, parseExpenseRows, scanReceiptText, toIso, toNum, type Row } from "@/core/import/csv";
import { getChannels, getLocations } from "@/core/read/common";
import { createSale, addExpense, ensureExpenseCategory } from "@/core/db/mutations";
import { egp } from "@/core/utils/format";
import { todayCairo } from "@/core/time";
import { isEngineConfigured, sb } from "@/core/db/engine";
import { useUI } from "@/store/ui";

type Kind = "sales" | "expenses";
interface SaleEdit { date: string; total: string }
interface ExpenseEdit { date: string; category: string; amount: string }

const en = isEngineConfigured;
const isImage = (f: File) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name) || f.type.startsWith("image/");
const isExcel = (f: File) => /\.(xlsx|xls)$/i.test(f.name);

async function readSpreadsheet(file: File): Promise<Row[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: false });
}

export function ReceiptsScreen() {
  const { reportSuccess, reportError, toast } = useUI();
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>("sales");
  const [sales, setSales] = useState<SaleEdit[] | null>(null);
  const [exps, setExps] = useState<ExpenseEdit[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [ocr, setOcr] = useState<string>(""); // OCR progress / status

  const locations = useQuery({ queryKey: ["locations"], queryFn: getLocations, enabled: en });
  const channels = useQuery({ queryKey: ["channels"], queryFn: getChannels, enabled: en });
  const existingDays = useQuery({
    queryKey: ["sale-days"], enabled: en && kind === "sales",
    queryFn: async () => { const { data, error } = await sb!.from("sales").select("sale_date").is("voided_at", null); if (error) throw error; return new Set((data ?? []).map((r) => r.sale_date)); },
  });

  const reset = () => { setSales(null); setExps(null); setFileName(""); setImgUrl(null); setOcr(""); };

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-pick of same file
    if (!f) return;
    reset();
    setFileName(f.name);
    try {
      if (isImage(f)) {
        setImgUrl(URL.createObjectURL(f));
        setOcr("Reading image…");
        const Tesseract = (await import("tesseract.js")).default;
        const { data } = await Tesseract.recognize(f, "eng", {
          logger: (m: { status: string; progress: number }) => { if (m.status === "recognizing text") setOcr(`Reading image… ${Math.round(m.progress * 100)}%`); },
        });
        setOcr("");
        if (kind === "sales") {
          const g = scanReceiptText(data.text);
          setSales([{ date: g.date ?? todayCairo(), total: g.total != null ? String(g.total) : "" }]);
          toast("Image read — check the values, then Approve", "info");
        } else {
          const g = scanReceiptText(data.text);
          setExps([{ date: g.date ?? todayCairo(), category: "Other", amount: g.total != null ? String(g.total) : "" }]);
          toast("Image read — check the values, then Approve", "info");
        }
      } else if (isExcel(f)) {
        const rows = await readSpreadsheet(f);
        loadRows(rows);
      } else {
        Papa.parse<Row>(f, { header: true, skipEmptyLines: true, complete: (res) => loadRows(res.data), error: () => toast("Could not parse CSV", "error") });
      }
    } catch (err) {
      setOcr("");
      reportError("Import file", err);
    }
  }

  function loadRows(rows: Row[]) {
    if (kind === "sales") {
      setSales(parseSalesRows(rows).map((r) => ({ date: r.date ?? "", total: r.total != null ? String(r.total) : "" })));
    } else {
      setExps(parseExpenseRows(rows).map((r) => ({ date: r.date ?? "", category: r.category, amount: r.amount != null ? String(r.amount) : "" })));
    }
  }

  // validation helpers on the editable rows
  const dupSet = existingDays.data ?? new Set<string>();
  const salesView = (sales ?? []).map((r) => {
    const iso = toIso(r.date); const totalNum = toNum(r.total);
    const issues: string[] = [];
    if (!iso) issues.push("date"); if (totalNum == null) issues.push("total");
    const dup = !!iso && dupSet.has(iso);
    return { ...r, iso, totalNum, issues, dup };
  });
  const expView = (exps ?? []).map((r) => {
    const iso = toIso(r.date); const amountNum = toNum(r.amount);
    const issues: string[] = [];
    if (!iso) issues.push("date"); if (amountNum == null) issues.push("amount"); if (!r.category.trim()) issues.push("category");
    return { ...r, iso, amountNum, issues };
  });
  const salesReady = salesView.filter((r) => !r.issues.length && !r.dup).length;
  const expReady = expView.filter((r) => !r.issues.length).length;
  const readyCount = kind === "sales" ? salesReady : expReady;

  const approve = useMutation({
    mutationFn: async () => {
      let imported = 0, skipped = 0, failed = 0;
      if (kind === "sales") {
        const loc = locations.data?.[0], ch = channels.data?.[0];
        if (!loc || !ch) throw new Error("No active location/channel.");
        const seen = new Set(dupSet);
        for (const r of salesView) {
          if (r.issues.length || !r.iso || r.totalNum == null || seen.has(r.iso)) { skipped++; continue; }
          try { await createSale({ date: r.iso, total: r.totalNum, locationId: loc.id, channelId: ch.id }); seen.add(r.iso); imported++; }
          catch { failed++; }
        }
      } else {
        const loc = locations.data?.[0];
        if (!loc) throw new Error("No active location.");
        const cache = new Map<string, string>();
        for (const r of expView) {
          if (r.issues.length || !r.iso || r.amountNum == null) { skipped++; continue; }
          try {
            const key = r.category.trim().toLowerCase();
            let catId = cache.get(key);
            if (!catId) { catId = await ensureExpenseCategory(r.category.trim(), true); cache.set(key, catId); }
            await addExpense({ date: r.iso, categoryId: catId, amount: r.amountNum, paymentMethod: "cash", notes: null, locationId: loc.id });
            imported++;
          } catch { failed++; }
        }
      }
      return { imported, skipped, failed };
    },
    onSuccess: (res) => { reportSuccess("Import", `Imported ${res.imported} · skipped ${res.skipped}${res.failed ? ` · failed ${res.failed}` : ""}`); qc.invalidateQueries(); reset(); },
    onError: (e) => reportError("Import", e),
  });

  if (!en) return <EmptyState title="Sign in to import" />;
  const hasRows = kind === "sales" ? sales != null : exps != null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Upload CSV · Excel · or a photo/screenshot → review → approve</Eyebrow>
        <div className="flex-1" />
        <Tabs value={kind} onChange={(v) => { setKind(v); reset(); }} options={[{ value: "sales", label: "Daily sales" }, { value: "expenses", label: "Expenses" }]} />
      </div>

      {!hasRows ? (
        <Card className="border-dashed">
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="font-display text-base font-semibold">Add {kind === "sales" ? "daily sales" : "expenses"}</div>
            <div className="max-w-md text-sm text-dim">
              Upload a <b>CSV</b>, <b>Excel</b> file, or a <b>photo / screenshot</b> of your sales sheet or receipt.
              {kind === "sales" ? " Images are read automatically and you confirm the totals." : " Columns: date, category, amount."}
            </div>
            <label className="lift cursor-pointer rounded-xl bg-pink px-4 py-2.5 font-display text-sm font-semibold text-ink shadow-pink">
              Choose file
              <input type="file" accept=".csv,.xlsx,.xls,.png,.jpg,.jpeg,.webp,image/*" className="hidden" onChange={onFile} />
            </label>
            <div className="text-[11px] text-dim">or type rows manually below</div>
            <Button variant="outline" onClick={() => kind === "sales" ? setSales([{ date: todayCairo(), total: "" }]) : setExps([{ date: todayCairo(), category: "Other", amount: "" }])}>Enter manually</Button>
          </div>
        </Card>
      ) : (
        <>
          {imgUrl && (
            <Card className="!p-3">
              <div className="flex items-start gap-3">
                <img src={imgUrl} alt="receipt" className="max-h-48 rounded-lg border border-line2 object-contain" />
                <div className="min-w-0 flex-1 text-[12px] text-dim">
                  <div className="font-display text-sm font-semibold text-text">{fileName}</div>
                  {ocr ? <div className="mt-1 text-pink">{ocr}</div> : <div className="mt-1">Read the photo and confirm the values on the right. Add more rows if the sheet has several days.</div>}
                </div>
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
            <div className="max-h-[55vh] divide-y divide-line2 overflow-y-auto">
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
