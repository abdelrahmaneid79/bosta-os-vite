/** DAILY SALES PHOTO IMPORT.
 *  Snap/upload the POS daily product report → it's read ACCURATELY by the vision
 *  reader (read-day-report edge function) when online, or ON-DEVICE (Tesseract in
 *  a web worker, self-hosted assets) as a fallback when offline / not signed in →
 *  the same pure pipeline (core/import/day-sales) validates arithmetic + the
 *  branch total, matches each line to a product by code/barcode, and decides
 *  attach/create/duplicate. Every uncertain line is flagged and the totals must
 *  reconcile before Approve unlocks. Nothing saves until you approve; writes go
 *  through the existing create_sale_item RPC (money math untouched). */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardHead, Eyebrow, Button, Badge } from "@/components/ui";
import { EmptyState, SkeletonRows } from "@/components/feedback";
import { ProductPicker } from "@/components/ProductPicker";
import { egp } from "@/core/utils/format";
import { isEngineConfigured, requireEngine } from "@/core/db/engine";
import { getCodedProducts, getProductReferencePrices } from "@/core/read/products";
import { getLocations, getChannels } from "@/core/read/common";
import { createSale, addSaleItem, setProductCodes } from "@/core/db/mutations";
import {
  buildCodeIndex, analyzeDayReport, decideDayAction, actionCanSave,
  marketCodeFromBarcode,
  type RawDayLine, type RawDayReport, type ExistingDay, type Verification,
} from "@/core/import/day-sales";
import { readDayReportPhoto, DayReportAuthError } from "@/core/import/day-report-ai";
import { runLocalDayReportOCR } from "@/features/local-ocr/engine/run-local-ocr";
import { signalRows, lineProvenance } from "@/features/local-ocr/adapter/to-raw-day-report";
import { checkAgainstCatalog } from "@/features/local-ocr/validation/catalog-check";
import { checkOcrReadiness, warmOcr, type OcrReadiness } from "@/features/local-ocr/engine/offline-readiness";
import { saveDraft, loadDraft, clearDraft, hashImage, findImportedImage, markImageImported, type DayImportDraft, type ImportedMark } from "@/features/local-ocr/draft-store";
import { useUI } from "@/store/ui";

const en = isEngineConfigured;

const CONF_STYLE: Record<Verification, string> = {
  verified: "bg-good/15 text-good",
  partially_verified: "bg-warn/15 text-warn",
  estimated: "bg-warn/15 text-warn",
  unverified: "bg-bad/15 text-bad",
};
/** Plain-English confidence labels shown to the owner (no jargon). */
const CONF_LABEL: Record<Verification, string> = {
  verified: "good",
  partially_verified: "check",
  estimated: "estimate",
  unverified: "needs you",
};
const READY_LABEL: Record<OcrReadiness, { text: string; tone: "good" | "warn" | "bad" | "pink" }> = {
  checking: { text: "Getting ready…", tone: "warn" },
  ready: { text: "Reads accurately online · on-device backup when offline", tone: "good" },
  downloading: { text: "Setting up the offline backup reader…", tone: "pink" },
  unavailable: { text: "Online reading only right now — offline backup not installed yet", tone: "warn" },
};

/** The sale row that already exists for a date (or null): its total + line count. */
async function fetchExistingDay(date: string, locationId: string): Promise<ExistingDay | null> {
  const sb = requireEngine();
  const day = await sb.from("sales").select("id,total_amount").is("voided_at", null)
    .eq("location_id", locationId).eq("sale_date", date).limit(1).maybeSingle();
  if (day.error) throw day.error;
  if (!day.data) return null;
  const items = await sb.from("sale_items").select("id", { count: "exact", head: true })
    .is("voided_at", null).eq("sale_id", day.data.id);
  if (items.error) throw items.error;
  return { id: day.data.id, total: Number(day.data.total_amount), lineCount: items.count ?? 0 };
}

interface LineMeta { conf: number; warnings: string[] }

export function DaySalesPhotoImport() {
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [stage, setStage] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<OcrReadiness>("checking");

  // editable read model — the owner reconciles the money here before approving
  const [lines, setLines] = useState<RawDayLine[] | null>(null);
  const [meta, setMeta] = useState<LineMeta[]>([]);
  const [branchTotal, setBranchTotal] = useState<number | null>(null);
  const [dayDate, setDayDate] = useState("");
  const [assign, setAssign] = useState<Record<number, string>>({}); // line index → product override
  const [result, setResult] = useState<{ created: number; failed: number; coded: number; action: string } | null>(null);
  // persistence: current photo (for the draft), a saved draft awaiting restore,
  // and a warning if this exact photo was already imported before
  const imageBlobRef = useRef<Blob | null>(null);
  const imageHashRef = useRef<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<DayImportDraft | null>(null);
  const [dupMark, setDupMark] = useState<ImportedMark | null>(null);

  // probe readiness + warm the worker up front so first read is fast/offline
  useEffect(() => { let live = true; checkOcrReadiness().then((r) => { if (live) setReady(r); if (r !== "unavailable") warmOcr(); }); return () => { live = false; }; }, []);

  // offer to restore an interrupted review left in device storage
  useEffect(() => { let live = true; loadDraft().then((d) => { if (live && d?.lines?.length) setPendingDraft(d); }); return () => { live = false; }; }, []);

  // auto-save the in-progress review so closing the tab never loses it (debounced)
  useEffect(() => {
    if (!lines || busy) return;
    const t = setTimeout(() => { void saveDraft({ lines, meta, branchTotal, dayDate, assign, imageBlob: imageBlobRef.current ?? undefined, savedAt: Date.now() }); }, 600);
    return () => clearTimeout(t);
  }, [lines, meta, branchTotal, dayDate, assign, busy]);

  const prods = useQuery({ queryKey: ["coded-products"], queryFn: getCodedProducts, enabled: en });
  const index = useMemo(() => buildCodeIndex(prods.data ?? []), [prods.data]);
  const nameById = useMemo(() => new Map((prods.data ?? []).map((p) => [p.id, p.nameEn])), [prods.data]);
  const marketById = useMemo(() => new Map((prods.data ?? []).map((p) => [p.id, p.marketCode])), [prods.data]);
  const posCodeById = useMemo(() => new Map((prods.data ?? []).map((p) => [p.id, p.posCode])), [prods.data]);
  // reference price per product = catalog selling_price, else the most recent
  // sold price — so the weight-check works without manually setting selling_price.
  const refPrices = useQuery({ queryKey: ["product-ref-prices"], queryFn: getProductReferencePrices, enabled: en });
  const priceById = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const p of prods.data ?? []) m.set(p.id, p.sellingPrice ?? refPrices.data?.get(p.id) ?? null);
    return m;
  }, [prods.data, refPrices.data]);

  const locs = useQuery({ queryKey: ["locations"], queryFn: getLocations, enabled: en });
  const locationId = locs.data?.[0]?.id ?? "";

  const existing = useQuery({
    queryKey: ["existing-day", dayDate, locationId], enabled: en && !!dayDate && !!locationId,
    queryFn: () => fetchExistingDay(dayDate, locationId),
  });

  // live analysis over the (editable) read model
  const report = useMemo(() => lines ? { sale_date: dayDate || null, branch_total_net: branchTotal, line_items: lines } : null, [lines, dayDate, branchTotal]);
  const analysis = useMemo(() => report ? analyzeDayReport(report, index) : null, [report, index]);

  const viewLines = useMemo(() => {
    if (!analysis || !lines) return [];
    return analysis.lines.map((l, i) => {
      const assignedId = assign[i];
      const userAssigned = !!assignedId;
      const productId = l.productId ?? assignedId ?? null;
      const productName = l.productName ?? (assignedId ? nameById.get(assignedId) ?? "" : null);
      const marketCode = l.productMarketCode
        ?? (assignedId ? marketById.get(assignedId) ?? null : null)
        ?? marketCodeFromBarcode(l.barcode);
      const readConf = meta[i]?.conf ?? 0;
      // confidence: unmatched → unverified; else fold OCR/reconcile confidence with doc reconciliation
      const conf: Verification = !productId
        ? "unverified"
        : !analysis.totalReconciles
          ? "unverified"
          : l.issues.length || readConf < 0.55
            ? "partially_verified"
            : readConf < 0.8
              ? "estimated"
              : "verified";
      const saveable = !!productId && l.netValue != null && l.net_qty != null;
      // catalog integrity: value ÷ qty should ≈ the product's selling price;
      // a big gap means the weight is likely mis-read (would misdeduct stock).
      const catalogPrice = productId ? priceById.get(productId) ?? null : null;
      const catalog = checkAgainstCatalog({ qty: l.net_qty, price: l.avg_unit_price, value: l.netValue }, catalogPrice);
      return { ...l, i, productId, productName, marketCode, userAssigned, conf, saveable, readConf, catalog, warnings: meta[i]?.warnings ?? [] };
    });
  }, [analysis, lines, assign, nameById, marketById, priceById, meta]);

  const decision = useMemo(() => {
    if (!analysis) return null;
    return decideDayAction(analysis, existing.data ?? null);
  }, [analysis, existing.data]);

  const readyCount = viewLines.filter((l) => l.saveable).length;
  const canSave = !!decision && actionCanSave(decision.action) && readyCount > 0;

  function resetAll() { setLines(null); setMeta([]); setImgUrl(null); setResult(null); setAssign({}); setDayDate(""); setBranchTotal(null); setStage(""); setDupMark(null); imageBlobRef.current = null; imageHashRef.current = null; }
  function cancelAll() { resetAll(); setPendingDraft(null); void clearDraft(); }

  /** Restore an interrupted review from device storage. */
  function restoreDraft(d: DayImportDraft) {
    setLines(d.lines); setMeta(d.meta); setBranchTotal(d.branchTotal); setDayDate(d.dayDate); setAssign(d.assign);
    if (d.imageBlob) { imageBlobRef.current = d.imageBlob; setImgUrl(URL.createObjectURL(d.imageBlob)); }
    setPendingDraft(null);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    e.target.value = "";
    resetAll();
    setPendingDraft(null);
    setBusy(true);
    imageBlobRef.current = f;
    setImgUrl(URL.createObjectURL(f));
    // fingerprint the photo → warn if this exact image was imported before
    hashImage(f).then((h) => { imageHashRef.current = h; return findImportedImage(h); }).then((m) => { if (m) setDupMark(m); }).catch(() => {});

    // Read locally (on-device) as a fallback source when the accurate reader
    // can't run (offline / not signed in).
    const readLocal = async (): Promise<{ report: RawDayReport; metaRows: LineMeta[]; unknown: boolean }> => {
      const { extraction, report } = await runLocalDayReportOCR(f, setStage);
      const rows = signalRows(extraction);
      return {
        report,
        metaRows: rows.map((r) => { const p = lineProvenance(r); return { conf: p.confidence, warnings: [...p.warnings, "read on-device — check the money"] }; }),
        unknown: extraction.receiptType === "unknown",
      };
    };

    try {
      const online = typeof navigator === "undefined" || navigator.onLine;
      let report: RawDayReport;
      let metaRows: LineMeta[];
      if (online) {
        try {
          setStage("Reading the report…");
          report = await readDayReportPhoto(f);                                   // ACCURATE reader (vision)
          metaRows = report.line_items.map(() => ({ conf: 0.95, warnings: [] }));
        } catch (visErr) {
          if (visErr instanceof DayReportAuthError) throw visErr;                 // real sign-in problem — surface it
          const why = visErr instanceof Error ? visErr.message : "";
          reportError("Reader", new Error(`The accurate reader failed${why ? ` — ${why}` : ""}. Reading on-device instead — check the money carefully.`));
          ({ report, metaRows } = await readLocal());                             // graceful on-device fallback
        }
      } else {
        setStage("Offline — reading on this device…");
        const local = await readLocal();
        report = local.report; metaRows = local.metaRows;
      }
      setStage("");
      setLines(report.line_items);
      setMeta(metaRows);
      setBranchTotal(report.branch_total_net);
      setDayDate(report.sale_date ?? "");
      if (!report.line_items.length) reportError("Read photo", new Error("No product lines were read — try a sharper, straight-on photo."));
    } catch (err) {
      const msg = err instanceof DayReportAuthError ? err.message : (err instanceof Error ? err.message : "Reader failed");
      reportError("Read photo", new Error(msg));
    } finally { setBusy(false); setStage(""); }
  }

  /** Edit one numeric field on a line, live-updating reconciliation. */
  function editLine(i: number, field: "net_qty" | "avg_unit_price" | "net_value", raw: string) {
    setLines((prev) => {
      if (!prev) return prev;
      const next = prev.slice();
      const v = raw.trim() === "" ? null : Number(raw);
      next[i] = { ...next[i], [field]: Number.isFinite(v as number) ? v : null };
      return next;
    });
  }
  function removeLine(i: number) {
    setLines((prev) => prev ? prev.filter((_, k) => k !== i) : prev);
    setMeta((prev) => prev.filter((_, k) => k !== i));
    setAssign((prev) => { const n: Record<number, string> = {}; Object.entries(prev).forEach(([k, val]) => { const ki = Number(k); if (ki < i) n[ki] = val; else if (ki > i) n[ki - 1] = val; }); return n; });
  }

  const approve = useMutation({
    mutationFn: async () => {
      // saving writes to Supabase; if offline, keep the (auto-saved) draft and say so
      if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("You're offline — your review is saved. Reconnect, then Approve again.");
      if (!analysis || !decision) throw new Error("Nothing to import.");
      if (!actionCanSave(decision.action)) throw new Error("This day can't be saved yet — reconcile the totals first.");
      if (!dayDate) throw new Error("Set the sale day first.");
      if (!locationId) throw new Error("No active location.");
      const rows = viewLines.filter((l) => l.saveable && l.productId);
      if (!rows.length) throw new Error("No matched lines to save.");

      let saleId: string;
      if (decision.action === "create") {
        const chans = await getChannels();
        const ch = chans[0];
        if (!ch) throw new Error("No active channel.");
        const total = analysis.branchTotalNet ?? analysis.readTotal;
        saleId = await createSale({ date: dayDate, total, locationId, channelId: ch.id });
      } else {
        if (!existing.data) throw new Error("The day to attach to disappeared — reload.");
        saleId = existing.data.id;
      }

      let created = 0, failed = 0, coded = 0;
      for (const l of rows) {
        const qty = l.net_qty as number;
        const lineTotal = l.netValue as number;
        const unitPrice = l.avg_unit_price ?? (qty ? lineTotal / qty : 0);
        try {
          await addSaleItem({ saleId, productId: l.productId!, qty, unitPrice, lineTotal, notes: null }, l.conf);
          created++;
          if (l.userAssigned && !posCodeById.get(l.productId!) && l.item_code) {
            try { await setProductCodes(l.productId!, l.item_code, marketCodeFromBarcode(l.barcode)); coded++; }
            catch { /* code may collide with another product — skip silently */ }
          }
        } catch { failed++; }
      }
      return { created, failed, coded, action: decision.action };
    },
    onSuccess: (res) => {
      setResult(res);
      // review saved — drop the draft and remember this photo so re-importing it warns
      void clearDraft();
      if (imageHashRef.current) void markImageImported(imageHashRef.current, { date: dayDate, at: Date.now() });
      reportSuccess("Import day sales", `${res.created} product line(s) ${res.action === "create" ? "on a new day" : "attached"}${res.coded ? ` · ${res.coded} product(s) coded` : ""}${res.failed ? ` · ${res.failed} failed` : ""}`);
      qc.invalidateQueries();
    },
    onError: (e) => reportError("Import day sales", e),
  });

  if (!en) return <EmptyState title="Sign in to import" />;

  const rd = READY_LABEL[ready];
  const toAssign = viewLines.filter((l) => !l.productId).length;
  const needsAttention = viewLines.filter((l) => l.conf !== "verified" || !l.productId).length;
  const gap = Math.abs((analysis?.readTotal ?? 0) - (branchTotal ?? 0));
  const reconciled = !!analysis?.totalReconciles;
  const prettyDate = dayDate ? new Date(dayDate + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

  return (
    <div className="space-y-4">
      <Eyebrow>Daily sales · photo → read → check the totals → approve (never auto-saves)</Eyebrow>

      {pendingDraft && !lines && (
        <Card className="!border-pink/40 !bg-pink/5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 text-sm text-text">
              <b>You have an unfinished review</b> — {pendingDraft.lines.length} product line(s){pendingDraft.dayDate ? ` for ${new Date(pendingDraft.dayDate + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}, saved on this device. Pick up where you left off?
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => { setPendingDraft(null); void clearDraft(); }}>Discard</Button>
              <Button onClick={() => restoreDraft(pendingDraft)}>Restore</Button>
            </div>
          </div>
        </Card>
      )}

      {!lines ? (
        /* ───────── Upload ───────── */
        <Card>
          <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-8 text-center">
            <CardHead title="Snap today's sales report" sub="Photograph the POS day report, or pick a screenshot. It's read accurately for you, then you check the totals before anything is saved. Works on your device as a backup when you're offline." accent="pink" icon="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
              <label className={`lift flex cursor-pointer items-center justify-center gap-2 rounded-2xl bg-pink px-5 py-3 font-display text-sm font-bold text-ink shadow-pink ${busy ? "pointer-events-none opacity-60" : ""}`}>
                📷 Take photo<input type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} disabled={busy} />
              </label>
              <label className={`lift flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-line bg-panel2 px-5 py-3 font-display text-sm font-bold text-text ${busy ? "pointer-events-none opacity-60" : ""}`}>
                Choose a file<input type="file" accept="image/*,.png,.jpg,.jpeg,.webp" className="hidden" onChange={onFile} disabled={busy} />
              </label>
            </div>
            {busy
              ? <div className="flex items-center gap-2 text-[13px] font-medium text-pink"><span className="h-2 w-2 animate-pulse rounded-full bg-pink" />{stage || "Reading…"}</div>
              : <Badge tone={rd.tone}>{rd.text}</Badge>}
            <p className="text-[12px] text-faint">Have a spreadsheet export instead? <Link to="/sales/product-lines/file" className="text-pink underline">Use the file importer</Link>.</p>
          </div>
        </Card>
      ) : prods.isLoading ? <SkeletonRows rows={4} /> : (
        <>
          {/* ───────── Header: photo + what we read ───────── */}
          <Card className="!p-3">
            <div className="flex items-start gap-3">
              {imgUrl && <img src={imgUrl} alt="day report" className="h-20 w-20 flex-shrink-0 rounded-xl border border-line object-cover" />}
              <div className="min-w-0 flex-1">
                <div className="font-display text-base font-bold text-text">{prettyDate || "Set the sale day"}</div>
                <div className="mt-0.5 text-[13px] text-dim">
                  {analysis?.lines.length ?? 0} products read · <span className="text-good">{analysis?.matchedCount ?? 0} matched</span>{toAssign ? <> · <span className="text-warn">{toAssign} to assign</span></> : null}
                </div>
                <button className="mt-1.5 text-[12px] text-pink underline" onClick={resetAll}>Read a different photo</button>
              </div>
            </div>
            {dupMark && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
                <span>⚠</span><span>You already imported this exact photo{dupMark.date ? ` (for ${new Date(dupMark.date + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })})` : ""}. Saving again may double-count — check before approving.</span>
              </div>
            )}
          </Card>

          {/* ───────── Reconciliation — the thing to get right ───────── */}
          <Card>
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-muted">Sale day</span>
                <input type="date" value={dayDate} onChange={(e) => setDayDate(e.target.value)}
                  className="rounded-xl border border-line bg-panel2 px-3 py-2 text-sm text-text outline-none focus:border-pink/60" />
              </label>
              <div>
                <span className="mb-1 block text-[12px] font-medium text-muted">Lines add up to</span>
                <div className="font-display text-xl font-bold text-text tnum">{egp(analysis?.readTotal ?? 0)}</div>
              </div>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-muted">Total on your report</span>
                <input inputMode="decimal" value={branchTotal ?? ""} placeholder="type it"
                  onChange={(e) => setBranchTotal(e.target.value.trim() === "" ? null : Number(e.target.value))}
                  className={`w-32 rounded-xl border bg-panel2 px-3 py-2 text-sm tnum font-bold outline-none focus:border-pink/60 ${reconciled ? "border-good/50 text-good" : "border-warn/50 text-text"}`} />
              </label>
            </div>

            {/* Big friendly status banner */}
            <div className={`mt-3 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] ${reconciled ? "border-good/30 bg-good/10 text-good" : branchTotal == null ? "border-line bg-panel2 text-dim" : "border-warn/40 bg-warn/10 text-warn"}`}>
              <span className="mt-px text-base leading-none">{reconciled ? "✓" : branchTotal == null ? "ℹ" : "⚠"}</span>
              <div className="min-w-0">
                {reconciled
                  ? <span><b>Everything adds up.</b> The products match your report's total — you're good to approve.</span>
                  : branchTotal == null
                    ? <span>Type your report's printed total above, then check the lines match it.</span>
                    : <span><b>Off by {egp(gap)}.</b> Adjust the highlighted lines below until they add up to your report — then approve unlocks.</span>}
              </div>
            </div>
            {existing.data && !decision?.totalsMatch && (
              <p className="mt-2 text-[12px] text-dim">Note: this day already has a saved total of {egp(existing.data.total)}.</p>
            )}
            {decision && decision.action.startsWith("duplicate") && <p className="mt-2 text-[12px] text-warn">{decision.reason}</p>}
          </Card>

          {result && (
            <Card className="!border-good/40 !bg-good/5"><div className="text-sm text-text">✓ Saved <b className="text-good">{result.created}</b> product line(s){result.coded ? ` · ${result.coded} newly coded` : ""}{result.failed ? ` · ${result.failed} failed` : ""}.</div></Card>
          )}

          {/* ───────── Lines — edit money to reconcile ───────── */}
          <Card className="!p-0">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="font-display text-sm font-semibold text-text">Products</span>
              <span className="text-[12px] text-dim">{needsAttention ? `${needsAttention} to check` : "all checked"}</span>
            </div>
            <div className="max-h-[60vh] divide-y divide-line overflow-y-auto overscroll-contain">
              {viewLines.map((l) => {
                const attention = !l.productId || l.conf !== "verified";
                return (
                <div key={l.i} className={`px-3 py-2.5 text-sm ${attention ? "bg-warn/[0.04]" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${l.productId ? "bg-good" : "bg-warn"}`} title={l.productId ? "matched to a product" : "not matched — pick one below"} />
                    <span dir="auto" className="min-w-0 flex-1 truncate text-text">
                      {l.productName || l.name_ar || "—"}
                    </span>
                    {l.conf !== "verified" && <span className={`flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${CONF_STYLE[l.conf]}`}>{CONF_LABEL[l.conf]}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <input inputMode="decimal" value={l.net_qty ?? ""} onChange={(e) => editLine(l.i, "net_qty", e.target.value)}
                      aria-label="quantity or weight" placeholder="qty"
                      className="tnum w-[4.5rem] flex-shrink-0 rounded-lg border border-line bg-panel2 px-2 py-2 text-right text-[13px] text-text outline-none focus:border-pink/60 sm:py-1.5" />
                    <span className="text-faint" aria-hidden>×</span>
                    <input inputMode="decimal" value={l.avg_unit_price ?? ""} onChange={(e) => editLine(l.i, "avg_unit_price", e.target.value)}
                      aria-label="unit price" placeholder="price"
                      className="tnum w-[4.5rem] flex-shrink-0 rounded-lg border border-line bg-panel2 px-2 py-2 text-right text-[13px] text-text outline-none focus:border-pink/60 sm:py-1.5" />
                    <span className="text-faint" aria-hidden>=</span>
                    <input inputMode="decimal" value={l.netValue ?? ""} onChange={(e) => editLine(l.i, "net_value", e.target.value)}
                      aria-label="line total" placeholder="total"
                      className="tnum w-24 flex-shrink-0 rounded-lg border border-line bg-panel2 px-2 py-2 text-right font-display text-[13px] font-bold text-text outline-none focus:border-pink/60 sm:py-1.5" />
                    {l.catalog.qtyRisk && l.catalog.suggestedQty != null && (
                      <button onClick={() => editLine(l.i, "net_qty", String(l.catalog.suggestedQty))}
                        title={`Set the weight to ${l.catalog.suggestedQty} (line total ÷ catalog price) — keeps your stock count right`}
                        className="min-h-[34px] flex-shrink-0 rounded-lg bg-warn/15 px-2 py-1 text-[11px] font-semibold text-warn hover:bg-warn/25">fix weight → {l.catalog.suggestedQty}</button>
                    )}
                    <div className="flex-1" />
                    <button onClick={() => removeLine(l.i)} title="remove this line" aria-label="remove line" className="min-h-[34px] min-w-[34px] flex-shrink-0 rounded-lg px-2 text-faint hover:bg-bad/10 hover:text-bad">✕</button>
                  </div>
                  {!l.productId && (
                    <div className="mt-2"><ProductPicker value={assign[l.i] ?? ""} onChange={(id) => setAssign((a) => ({ ...a, [l.i]: id }))} /></div>
                  )}
                  {(l.issues.length > 0 || l.catalog.warnings.length > 0) && (
                    <p className="mt-1.5 text-[11px] leading-snug text-warn">{[...l.issues, ...l.catalog.warnings].join(" · ")}</p>
                  )}
                </div>
              );})}
            </div>
          </Card>

          {/* ───────── Sticky approve bar ───────── */}
          <div className="sticky bottom-3 z-10 flex items-center gap-2 rounded-2xl border border-line bg-panel/95 px-3 py-2.5 shadow-lg backdrop-blur">
            <span className="text-[13px] text-dim"><b className="text-text">{readyCount}</b> ready{toAssign ? ` · ${toAssign} to assign` : ""}</span>
            <div className="flex-1" />
            <Button variant="ghost" onClick={cancelAll}>Cancel</Button>
            <Button disabled={approve.isPending || !canSave} onClick={() => approve.mutate()}>
              {approve.isPending ? "Saving…" : !reconciled ? "Match the total first" : `Approve ${readyCount}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
