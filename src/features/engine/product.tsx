/** Product deep-dive page (/product/:id) — drill into one product: live stock,
 *  period KPIs over the global range, velocity & days-of-cover, sale lines and
 *  purchase batches, with quick actions. Honest: gross profit shows "unknown"
 *  when any sold line lacks a cost. */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, Eyebrow, Stat, Badge, Button } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { SkeletonRows, ErrorState, EmptyState } from "@/components/feedback";
import { DateRangePicker } from "@/components/DateRangePicker";
import { egp, num, pct } from "@/core/utils/format";
/** Table cells carry bare numbers — the unit is named once in the header. */
const bare = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { useActiveRange } from "@/store/filters";
import { rangeLabel } from "@/core/range";
import { useFilters } from "@/store/filters";
import { getProductDetail } from "@/core/read/product-detail";
import { getProducts } from "@/core/read/common";
import { getLifetimeProducts } from "@/core/read/products";
import { normalize } from "@/core/products/match";
import { productMargin, marginTier, TIER_WORD } from "@/core/products/margin";
import { recommendProductAction, type AdviceTone } from "@/core/products/advice";
import { egpShort } from "@/core/utils/format";
import { PurchaseForm, ProductForm } from "./forms";
import type { Tables } from "@/core/db/tables";

const ADVICE_TONE: Record<AdviceTone, { wrap: string; text: string }> = {
  critical: { wrap: "border-bad/40 bg-bad/[0.06]", text: "text-bad" },
  warn: { wrap: "border-warn/40 bg-warn/[0.06]", text: "text-warn" },
  good: { wrap: "border-good/40 bg-good/[0.06]", text: "text-good" },
  info: { wrap: "border-line bg-panel2", text: "text-info" },
};

export function ProductDetailScreen({ id: idProp, onClose }: { id?: string; onClose?: () => void } = {}) {
  const { id: idParam = "" } = useParams();
  const id = idProp ?? idParam;
  const range = useActiveRange();
  const rk = useFilters((s) => s.rangeKey);
  const [buy, setBuy] = useState(false);
  const [edit, setEdit] = useState(false);
  const d = useQuery({ queryKey: ["product-detail", id, range], queryFn: () => getProductDetail(id, range), enabled: isEngineConfigured && !!id });
  const prod = useQuery({ queryKey: ["products-list"], queryFn: getProducts, enabled: isEngineConfigured });
  const lifetime = useQuery({ queryKey: ["lifetime-products"], queryFn: getLifetimeProducts, enabled: isEngineConfigured });
  const productRow = (prod.data ?? []).find((p) => p.id === id) as Tables<"products"> | undefined;

  if (!isEngineConfigured) return <EmptyState title="Sign in to view a product" />;
  if (d.isLoading) return <SkeletonRows rows={6} />;
  if (d.isError) return <ErrorState message={String((d.error as Error)?.message)} onRetry={() => d.refetch()} />;
  const p = d.data!;

  // Match this product to its lifetime POS totals (by Arabic/English name) + rank.
  const lifeRanked = (lifetime.data ?? []).slice().sort((a, b) => b.revenue - a.revenue);
  const names = new Set([normalize(p.nameEn), p.nameAr ? normalize(p.nameAr) : ""].filter(Boolean));
  const lifeIdx = lifeRanked.findIndex((x) => names.has(normalize(x.name)));
  const life = lifeIdx >= 0 ? lifeRanked[lifeIdx] : null;
  const advice = recommendProductAction({
    onHand: p.onHand, isNegative: p.isNegative, hasCost: p.hasCost, daysCover: p.daysCover,
    lifetimeRank: lifeIdx >= 0 ? lifeIdx + 1 : null, lifetimeCount: lifeRanked.length, active: p.active,
  });
  const at = ADVICE_TONE[advice.tone];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {onClose
          ? <button onClick={onClose} className="text-sm font-semibold text-pink">← Back to stock</button>
          : <Link to="/stock" className="text-sm text-pink">← Goods</Link>}
        <div className="flex-1" />
        <DateRangePicker />
      </div>

      {/* Header */}
      <Card glow>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <Eyebrow>Product</Eyebrow>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-2xl font-semibold text-text">{p.nameEn}</span>
              {p.nameAr && <span dir="rtl" className="text-sm text-dim">{p.nameAr}</span>}
              {p.marketCode && <span className="tnum rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[12px] font-semibold text-muted" title="Product code">#{p.marketCode}</span>}
              {!p.active && <Badge>inactive</Badge>}
              {p.isNegative && <Badge tone="bad">negative</Badge>}
              {!p.isNegative && p.isLow && <Badge tone="warn">low</Badge>}
              {p.onHand > 0 && !p.hasCost && <Badge tone="warn">no cost</Badge>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setBuy(true)}>+ Purchase</Button>
            {productRow && <Button variant="outline" onClick={() => setEdit(true)}>Edit</Button>}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-4">
          <Stat label="On hand" value={`${num(p.onHand)} ${p.baseUnit}`} accent={p.isNegative ? "text-bad" : "text-text"} />
          <Stat label="Avg cost" value={p.hasCost ? `${egp(p.avgCost)}/${p.baseUnit}` : "—"} />
          <Stat label="Stock value" value={egp(p.stockValue)} />
          <Stat label="Sells at" value={p.sellingPrice != null ? egp(p.sellingPrice) : "—"}
            sub={(() => { const m = productMargin(p.sellingPrice, p.avgCost); if (m == null) return undefined;
              const t = marginTier(m);
              return <span className={`chipx ${t}`} style={{ marginTop: 8 }}>{m.toFixed(1)}% · {TIER_WORD[t]}</span>; })()} />
        </div>
      </Card>

      {/* One day, under the lens: every sale day of this product, choosable */}
      <DayLens saleLines={p.saleLines} baseUnit={p.baseUnit} avgCost={p.hasCost ? p.avgCost : null} />

      {/* Recommended action */}
      <div className={`rounded-3xl border p-5 shadow-card ${at.wrap}`}>
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 ${at.text}`}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>
          </span>
          <div className="min-w-0 flex-1">
            <Eyebrow accent={at.text}>Recommended action</Eyebrow>
            <div className="mt-0.5 font-display text-base font-bold text-text">{advice.title}</div>
            <div className="mt-0.5 text-[13px] text-muted">{advice.detail}</div>
          </div>
        </div>
      </div>

      {/* Lifetime profitability (POS sales × supplier-bill cost) */}
      {life && (
        <>
          <div className="flex items-center justify-between">
            <Eyebrow>Lifetime · since launch</Eyebrow>
            {life.costSource === "estimate" ? <Badge tone="warn">cost is an estimate</Badge> : life.costSource === "verified" ? <Badge tone="good">cost confirmed</Badge> : <Badge tone="neutral">no cost yet</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Lifetime revenue" value={egpShort(life.revenue)} accent="text-good" sub={`${num(life.units)} units · #${lifeIdx + 1}`} />
            <Stat label="Total cost" value={life.cogs == null ? "—" : egpShort(life.cogs)} accent="text-bad" />
            <Stat label="Gross profit" value={life.grossProfit == null ? "—" : egpShort(life.grossProfit)} accent="text-good" />
            <Stat label="Margin" value={life.margin == null ? "—" : pct(life.margin)} accent={life.margin != null && life.margin < 20 ? "text-warn" : "text-text"} />
          </div>
          {life.costSource !== "unknown" && life.unitCost != null && (
            <p className="text-[11px] text-dim">Costs you {egp(life.unitCost)}/unit{life.costSource === "estimate" ? " · raw cost only" : ""}.</p>
          )}
        </>
      )}

      {/* Period KPIs */}
      <div className="flex items-center justify-between">
        <Eyebrow>Performance · {rangeLabel(rk, range)}</Eyebrow>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Units sold" value={`${num(p.unitsSold)} ${p.baseUnit}`} />
        <Stat label="Revenue" value={egp(p.revenue)} accent="text-good" />
        <Stat label="Cost" value={egp(p.cogs)} accent="text-bad" />
        <Stat label="Gross profit" value={p.grossProfit == null ? "—" : egp(p.grossProfit)} accent="text-good" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Margin" value={p.margin == null ? "—" : pct(p.margin)} />
        <Stat label="Bought (range)" value={`${num(p.purchaseQty)} ${p.baseUnit}`} />
        <Stat label="Purchase cost" value={egp(p.purchaseCost)} />
        <Stat label="Days of cover" value={p.daysCover == null ? "—" : `≈${Math.round(p.daysCover)}d`} accent={p.daysCover != null && p.daysCover < 7 ? "text-warn" : "text-text"} />
      </div>
      {p.missingCostLines > 0 && (
        <Card><div className="text-sm text-warn">Profit isn&rsquo;t final — {p.missingCostLines} sold {p.missingCostLines === 1 ? "day has" : "days have"} no cost yet. Add a purchase to set it.</div></Card>
      )}
      {p.unitsPerDay != null && p.unitsPerDay > 0 && (
        <p className="text-[12px] text-dim">Selling ≈{Math.round(p.unitsPerDay * 10) / 10} {p.baseUnit}/day in this range{p.daysCover != null ? ` · ~${Math.round(p.daysCover)} days of stock left` : ""}.</p>
      )}

      {/* Sale lines */}
      <Eyebrow>Sale lines · {p.saleLines.length}</Eyebrow>
      {p.saleLines.length === 0 ? <Card><p className="text-sm text-dim">No sales in range.</p></Card> : (
        <Card className="!p-0"><div className="scroll" style={{ maxHeight: 360 }}>
          <table className="dtbl">
            <thead><tr><th>Date</th><th className="r">Qty</th><th className="r">Price (EGP)</th><th className="r">Amount (EGP)</th></tr></thead>
            <tbody>
              {p.saleLines.slice(0, 60).map((l, i) => (
                <tr key={i}>
                  <td>{fmtDate(l.date, "d MMM yyyy")}</td>
                  <td className="r">{num(l.qty)} <span style={{ color: "rgb(var(--dim))", fontWeight: 400, fontSize: 12 }}>{p.baseUnit}</span></td>
                  <td className="r">{bare(l.unitPrice ?? 0)}{l.hasCogs ? "" : <span style={{ color: "var(--amber)", fontSize: 11 }}> · no cost</span>}</td>
                  <td className="r" style={{ color: "var(--green)" }}>{bare(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></Card>
      )}

      {/* Purchases */}
      <Eyebrow>Purchase batches · {p.purchases.length}</Eyebrow>
      {p.purchases.length === 0 ? <Card><p className="text-sm text-dim">No purchases in range.</p></Card> : (
        <Card className="!p-0"><div className="scroll" style={{ maxHeight: 360 }}>
          <table className="dtbl">
            <thead><tr><th>Date</th><th className="r">Qty</th><th className="r">Cost (EGP)</th><th className="r">Total (EGP)</th></tr></thead>
            <tbody>
              {p.purchases.map((b) => (
                <tr key={b.id}>
                  <td>{fmtDate(b.date, "d MMM yyyy")}</td>
                  <td className="r">{num(b.qty)} <span style={{ color: "rgb(var(--dim))", fontWeight: 400, fontSize: 12 }}>{p.baseUnit}</span></td>
                  <td className="r">{bare(b.unitCost)}</td>
                  <td className="r">{bare(b.totalCost)}</td>
                </tr>
              ))}
            </tbody>
            {p.purchases.length > 0 && (
              <tfoot><tr>
                <td>Total</td>
                <td className="r">{num(p.purchases.reduce((a, b) => a + b.qty, 0))}</td>
                <td />
                <td className="r">{bare(p.purchases.reduce((a, b) => a + b.totalCost, 0))}</td>
              </tr></tfoot>
            )}
          </table>
        </div></Card>
      )}

      <Modal open={buy} onClose={() => setBuy(false)} title="Add purchase"><PurchaseForm onDone={() => { setBuy(false); d.refetch(); }} /></Modal>
      {productRow && <Modal open={edit} onClose={() => setEdit(false)} title="Edit product"><ProductForm product={productRow} onDone={() => { setEdit(false); d.refetch(); }} /></Modal>}
    </div>
  );
}


/** One picked day for this product: sold · took · profit · margin.
 *  Profit prices the day's quantity at the CURRENT average cost — the sale
 *  lines don't carry their historical cost — and says so on the tile. */
function DayLens({ saleLines, baseUnit, avgCost }: {
  saleLines: { date: string; qty: number; lineTotal: number }[];
  baseUnit: string;
  avgCost: number | null;
}) {
  const days = useMemo(() => {
    const m = new Map<string, { qty: number; total: number }>();
    for (const l of saleLines) {
      const d = m.get(l.date) ?? { qty: 0, total: 0 };
      d.qty += l.qty; d.total += l.lineTotal; m.set(l.date, d);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [saleLines]);
  const [day, setDay] = useState<string>("");
  if (days.length === 0) return null;
  const sel = day || days[0][0];
  const d = days.find(([k]) => k === sel)?.[1] ?? { qty: 0, total: 0 };
  const cost = avgCost != null ? d.qty * avgCost : null;
  const profit = cost != null ? d.total - cost : null;
  const margin = profit != null && d.total > 0 ? (profit / d.total) * 100 : null;
  const tier = margin != null ? marginTier(margin) : null;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Eyebrow>One day</Eyebrow>
        <select className="input" style={{ width: "auto", padding: "8px 38px 8px 13px", fontSize: 13 }}
          value={sel} onChange={(e) => setDay(e.target.value)} aria-label="Pick a sale day">
          {days.map(([k, v]) => <option key={k} value={k}>{fmtDate(k, "EEE d MMM yyyy")} · {egpShort(v.total)}</option>)}
        </select>
      </div>
      <div className="dlens" style={{ marginTop: 14 }}>
        <div className="fig"><div className="l">Sold</div><div className="v">{num(d.qty)} <small style={{ fontSize: 12, color: "rgb(var(--dim))" }}>{baseUnit}</small></div></div>
        <div className="fig"><div className="l">Took (EGP)</div><div className="v" style={{ color: "var(--green)" }}>{d.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>
        <div className="fig"><div className="l">Profit (EGP)</div><div className="v" style={{ color: profit == null ? "rgb(var(--faint))" : profit >= 0 ? "var(--green)" : "var(--red)" }}>{profit == null ? "—" : profit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          {profit != null && <div style={{ fontSize: 10, color: "rgb(var(--faint))", marginTop: 3 }}>at current cost</div>}</div>
        <div className="fig"><div className="l">Margin</div><div className="v">{margin == null ? <span style={{ color: "rgb(var(--faint))" }}>add cost</span> : <span className={`chipx ${tier}`}>{margin.toFixed(1)}% · {TIER_WORD[tier!]}</span>}</div></div>
      </div>
    </Card>
  );
}
