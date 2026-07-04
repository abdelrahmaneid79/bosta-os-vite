/** DAILY SALES PHOTO IMPORT (vision-direct, code-matched) — the rebuilt importer.
 *  Snap the POS daily product report → Claude vision reads it into strict JSON →
 *  the pure pipeline (core/import/day-sales) validates the arithmetic + branch
 *  total, matches each line to a product by POS item code, decides attach/create/
 *  duplicate against the day that already exists, and cross-checks the read total
 *  to that day's saved total. Nothing saves until the owner approves; unmatched
 *  codes are queued (never dropped/guessed). Writes go through the existing
 *  create_sale_item RPC (addSaleItem) — the money math is untouched. */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardHead, Eyebrow, Button, Badge } from "@/components/ui";
import { EmptyState, SkeletonRows } from "@/components/feedback";
import { ProductPicker } from "@/components/ProductPicker";
import { egp } from "@/core/utils/format";
import { isEngineConfigured, requireEngine } from "@/core/db/engine";
import { getCodedProducts } from "@/core/read/products";
import { getLocations, getChannels } from "@/core/read/common";
import { createSale, addSaleItem, setProductCodes } from "@/core/db/mutations";
import { readDayReportPhoto, DayReportAuthError } from "@/core/import/day-report-ai";
import {
  buildCodeIndex, analyzeDayReport, lineConfidence, decideDayAction, actionCanSave,
  marketCodeFromBarcode,
  type RawDayReport, type ExistingDay, type Verification,
} from "@/core/import/day-sales";
import { useUI } from "@/store/ui";

const en = isEngineConfigured;

const CONF_STYLE: Record<Verification, string> = {
  verified: "bg-good/15 text-good",
  partially_verified: "bg-warn/15 text-warn",
  estimated: "bg-warn/15 text-warn",
  unverified: "bg-bad/15 text-bad",
};
const ACTION_LABEL: Record<string, { text: string; tone: "good" | "warn" | "bad" | "pink" }> = {
  attach: { text: "Attach to existing day", tone: "good" },
  create: { text: "Create new day", tone: "pink" },
  duplicate_block: { text: "Already imported", tone: "warn" },
  duplicate_flag: { text: "Duplicate — totals differ", tone: "bad" },
  blocked_unreconciled: { text: "Doesn't reconcile", tone: "bad" },
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

export function DaySalesPhotoImport() {
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState("");
  const [report, setReport] = useState<RawDayReport | null>(null);
  const [dayDate, setDayDate] = useState("");
  const [assign, setAssign] = useState<Record<number, string>>({}); // line index → product override
  const [result, setResult] = useState<{ created: number; failed: number; coded: number; action: string } | null>(null);

  const prods = useQuery({ queryKey: ["coded-products"], queryFn: getCodedProducts, enabled: en });
  const index = useMemo(() => buildCodeIndex(prods.data ?? []), [prods.data]);
  const nameById = useMemo(() => new Map((prods.data ?? []).map((p) => [p.id, p.nameEn])), [prods.data]);
  const marketById = useMemo(() => new Map((prods.data ?? []).map((p) => [p.id, p.marketCode])), [prods.data]);
  const posCodeById = useMemo(() => new Map((prods.data ?? []).map((p) => [p.id, p.posCode])), [prods.data]);

  const locs = useQuery({ queryKey: ["locations"], queryFn: getLocations, enabled: en });
  const locationId = locs.data?.[0]?.id ?? "";

  const existing = useQuery({
    queryKey: ["existing-day", dayDate, locationId], enabled: en && !!dayDate && !!locationId,
    queryFn: () => fetchExistingDay(dayDate, locationId),
  });

  // Analyze the read report against the product code index, folding in any
  // manual product assignments for lines the code didn't match.
  const analysis = useMemo(() => report ? analyzeDayReport(report, index) : null, [report, index]);
  const viewLines = useMemo(() => {
    if (!analysis) return [];
    return analysis.lines.map((l, i) => {
      const assignedId = assign[i];
      const userAssigned = !!assignedId;
      const productId = l.productId ?? assignedId ?? null;
      const productName = l.productName ?? (assignedId ? nameById.get(assignedId) ?? "" : null);
      // owner-facing 4-digit code: from the matched/assigned product, else derived
      // from this line's barcode. The hidden 8-digit pos code is never shown.
      const marketCode = l.productMarketCode
        ?? (assignedId ? marketById.get(assignedId) ?? null : null)
        ?? marketCodeFromBarcode(l.barcode);
      const conf: Verification = !productId
        ? "unverified"
        : userAssigned
          ? (analysis.totalReconciles ? "partially_verified" : "unverified") // matched by hand, not by code
          : lineConfidence(l, analysis.totalReconciles);
      const saveable = !!productId && l.netValue != null && l.net_qty != null;
      return { ...l, i, productId, productName, marketCode, userAssigned, conf, saveable };
    });
  }, [analysis, assign, nameById, marketById]);

  const decision = useMemo(() => {
    if (!analysis) return null;
    return decideDayAction(analysis, existing.data ?? null);
  }, [analysis, existing.data]);

  const readyCount = viewLines.filter((l) => l.saveable).length;
  const canSave = !!decision && actionCanSave(decision.action) && readyCount > 0;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    e.target.value = "";
    setFileName(f.name); setResult(null); setAssign({}); setReport(null);
    setImgUrl(URL.createObjectURL(f));
    try {
      setStatus("Reading photo with AI…");
      const r = await readDayReportPhoto(f);
      setStatus("");
      setReport(r);
      setDayDate(r.sale_date ?? "");
      if (!r.line_items.length) reportError("Read photo", new Error("No product lines were read — try a sharper, straight-on photo."));
    } catch (err) {
      setStatus("");
      const msg = err instanceof DayReportAuthError ? err.message : `AI reader failed (${(err as Error)?.message ?? "error"})`;
      reportError("Read photo", new Error(msg));
    }
  }

  const approve = useMutation({
    mutationFn: async () => {
      if (!analysis || !decision) throw new Error("Nothing to import.");
      if (!actionCanSave(decision.action)) throw new Error("This day can't be saved — resolve the flagged issue first.");
      if (!dayDate) throw new Error("Set the sale day first.");
      if (!locationId) throw new Error("No active location.");
      const rows = viewLines.filter((l) => l.saveable && l.productId);
      if (!rows.length) throw new Error("No matched lines to save.");

      let saleId: string;
      if (decision.action === "create") {
        const chans = await getChannels();
        const ch = chans[0];
        if (!ch) throw new Error("No active channel.");
        // New day's total = the document's branch net (the day's real revenue figure).
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
          // Going forward: a manually-assigned line whose product isn't coded yet
          // gets coded now — hidden pos_code from the document, market_code from the
          // barcode. Best-effort: never let it fail the import.
          if (l.userAssigned && !posCodeById.get(l.productId!) && l.item_code) {
            try {
              await setProductCodes(l.productId!, l.item_code, marketCodeFromBarcode(l.barcode));
              coded++;
            } catch { /* code may collide with another product — skip silently */ }
          }
        } catch { failed++; }
      }
      return { created, failed, coded, action: decision.action };
    },
    onSuccess: (res) => {
      setResult(res);
      reportSuccess("Import day sales", `${res.created} product line(s) ${res.action === "create" ? "on a new day" : "attached"}${res.coded ? ` · ${res.coded} product(s) coded` : ""}${res.failed ? ` · ${res.failed} failed` : ""}`);
      qc.invalidateQueries();
    },
    onError: (e) => reportError("Import day sales", e),
  });

  if (!en) return <EmptyState title="Sign in to import" />;

  const codedCount = (prods.data ?? []).filter((p) => p.marketCode).length;

  return (
    <div className="space-y-4">
      <Eyebrow>Daily sales · photo → read → review → approve (never auto-saves)</Eyebrow>

      {!report ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CardHead title="Snap the daily product-sales report" sub="Take a straight-on photo of the POS day report. The item code, Arabic name, quantities, returns and the branch total are read automatically and matched to your products by code." accent="pink" icon="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            <label className="lift cursor-pointer rounded-2xl bg-pink px-4 py-2.5 font-display text-sm font-bold text-ink shadow-pink">
              Choose photo<input type="file" accept=".png,.jpg,.jpeg,.webp,image/*" className="hidden" onChange={onFile} />
            </label>
            {status && <p className="text-[12px] font-medium text-pink">{status}</p>}
            <p className="max-w-md text-[12px] text-dim">
              {codedCount} product(s) have a 4-digit code. Anything the code can't match is queued for you to assign — nothing is saved until you approve.
            </p>
            <p className="text-[12px] text-faint">Have a CSV/Excel export instead? <Link to="/sales/product-lines/file" className="text-pink underline">Use the file importer</Link>.</p>
          </div>
        </Card>
      ) : prods.isLoading ? <SkeletonRows rows={4} /> : (
        <>
          {/* Photo + read summary */}
          <Card className="!p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              {imgUrl && <img src={imgUrl} alt="day report" className="max-h-56 rounded-lg border border-line object-contain" />}
              <div className="min-w-0 flex-1 text-[12px] text-dim">
                <div className="font-display text-sm font-semibold text-text">{fileName}</div>
                <div className="mt-1">Read {analysis?.lines.length ?? 0} line(s) · {analysis?.matchedCount ?? 0} matched by code{analysis && analysis.unmatchedCodes.length ? ` · ${analysis.unmatchedCodes.length} code(s) unmatched` : ""}.</div>
                <button className="mt-2 text-pink underline" onClick={() => { setReport(null); setImgUrl(null); setResult(null); setAssign({}); setFileName(""); setDayDate(""); }}>Read a different photo</button>
              </div>
            </div>
          </Card>

          {/* Sale day + reconciliation + decision */}
          <Card>
            <CardHead title="Sale day & totals" sub="The report is one day, read from its «من» date. Confirm it, then check the totals." accent="pink" icon="M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5" />
            <div className="flex flex-wrap items-end gap-4">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-muted">Sale day</span>
                <input type="date" value={dayDate} onChange={(e) => setDayDate(e.target.value)}
                  className="rounded-2xl border border-line bg-panel2 px-3.5 py-2.5 text-sm text-text outline-none focus:border-pink/60" />
              </label>
              <div className="text-[12px]">
                <div className="text-muted">Read total (Σ net value)</div>
                <div className="font-display text-lg font-bold text-text">{egp(analysis?.readTotal ?? 0)}</div>
              </div>
              <div className="text-[12px]">
                <div className="text-muted">Photo branch total</div>
                <div className={`font-display text-lg font-bold ${analysis?.totalReconciles ? "text-good" : "text-bad"}`}>
                  {analysis?.branchTotalNet != null ? egp(analysis.branchTotalNet) : "—"}
                </div>
              </div>
              {existing.data && (
                <div className="text-[12px]">
                  <div className="text-muted">Day's saved total</div>
                  <div className={`font-display text-lg font-bold ${decision?.totalsMatch ? "text-good" : "text-warn"}`}>{egp(existing.data.total)}</div>
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {analysis?.totalReconciles
                ? <Badge tone="good">lines reconcile ✓</Badge>
                : <Badge tone="bad">lines don't sum to the branch total</Badge>}
              {decision && <Badge tone={ACTION_LABEL[decision.action].tone}>{ACTION_LABEL[decision.action].text}</Badge>}
              {existing.isLoading && dayDate && <span className="text-[12px] text-dim">checking the day…</span>}
            </div>
            {decision && <p className="mt-2 text-[12px] text-dim">{decision.reason}</p>}
            {analysis?.issues.map((iss, k) => <p key={k} className="mt-1 text-[12px] text-warn">⚠ {iss}</p>)}
          </Card>

          {/* Approve */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="good">{readyCount} ready</Badge>
            {viewLines.some((l) => !l.productId) && <Badge tone="warn">{viewLines.filter((l) => !l.productId).length} to assign</Badge>}
            <div className="flex-1" />
            <Button variant="ghost" onClick={() => { setReport(null); setImgUrl(null); setResult(null); setAssign({}); setFileName(""); setDayDate(""); }}>Cancel</Button>
            <Button disabled={approve.isPending || !canSave} onClick={() => approve.mutate()}>
              {approve.isPending ? "Saving…" : decision && !actionCanSave(decision.action) ? "Resolve issue to save" : `Approve ${readyCount} line(s)`}
            </Button>
          </div>

          {result && (
            <Card><div className="text-sm text-text">Saved <b className="text-good">{result.created}</b> product line(s){result.failed ? ` · ${result.failed} failed` : ""}.</div></Card>
          )}

          {/* Line review */}
          <Card className="!p-0">
            <div className="max-h-[60vh] divide-y divide-line overflow-y-auto">
              {viewLines.map((l) => (
                <div key={l.i} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${l.productId ? "bg-good" : "bg-warn"}`} />
                  <span className="tnum w-14 flex-shrink-0 text-[11px] text-faint" title="4-digit product code">{l.marketCode ? `#${l.marketCode}` : "—"}</span>
                  <span dir="auto" className="min-w-0 flex-1 truncate text-text">
                    {l.name_ar || "—"}{l.productName && l.productName !== l.name_ar ? <span className="text-dim"> → {l.productName}</span> : ""}
                  </span>
                  <span className="tnum w-28 flex-shrink-0 text-right text-dim">
                    {l.net_qty ?? "—"}{l.qty_returned ? <span className="text-warn"> (−{l.qty_returned})</span> : ""} × {l.avg_unit_price != null ? egp(l.avg_unit_price) : "—"}
                  </span>
                  <span className="tnum w-20 flex-shrink-0 text-right font-display font-bold text-text">{l.netValue != null ? egp(l.netValue) : "—"}</span>
                  <span className={`flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${CONF_STYLE[l.conf]}`}>{l.conf.replace("_", " ")}</span>
                  {!l.productId && (
                    <div className="w-full sm:w-64"><ProductPicker value={assign[l.i] ?? ""} onChange={(id) => setAssign((a) => ({ ...a, [l.i]: id }))} /></div>
                  )}
                  {l.issues.length > 0 && <span className="w-full text-[11px] text-warn sm:w-auto">{l.issues.join(" · ")}</span>}
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
