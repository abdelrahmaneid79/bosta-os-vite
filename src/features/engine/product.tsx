/** Product deep-dive page (/product/:id) — drill into one product: live stock,
 *  period KPIs over the global range, velocity & days-of-cover, sale lines and
 *  purchase batches, with quick actions. Honest: gross profit shows "unknown"
 *  when any sold line lacks a cost. */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, Eyebrow, Stat, Badge, Button } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { SkeletonRows, ErrorState, EmptyState } from "@/components/feedback";
import { DateRangePicker } from "@/components/DateRangePicker";
import { egp, num, pct } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { useActiveRange } from "@/store/filters";
import { rangeLabel } from "@/core/range";
import { useFilters } from "@/store/filters";
import { getProductDetail } from "@/core/read/product-detail";
import { getProducts } from "@/core/read/common";
import { PurchaseForm, ProductForm } from "./forms";
import type { Tables } from "@/core/db/tables";

export function ProductDetailScreen() {
  const { id = "" } = useParams();
  const range = useActiveRange();
  const rk = useFilters((s) => s.rangeKey);
  const [buy, setBuy] = useState(false);
  const [edit, setEdit] = useState(false);
  const d = useQuery({ queryKey: ["product-detail", id, range], queryFn: () => getProductDetail(id, range), enabled: isEngineConfigured && !!id });
  const prod = useQuery({ queryKey: ["products-list"], queryFn: getProducts, enabled: isEngineConfigured });
  const productRow = (prod.data ?? []).find((p) => p.id === id) as Tables<"products"> | undefined;

  if (!isEngineConfigured) return <EmptyState title="Sign in to view a product" />;
  if (d.isLoading) return <SkeletonRows rows={6} />;
  if (d.isError) return <ErrorState message={String((d.error as Error)?.message)} onRetry={() => d.refetch()} />;
  const p = d.data!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/stock" className="text-sm text-pink">← Goods</Link>
        <div className="flex-1" />
        <DateRangePicker />
      </div>

      {/* Header */}
      <Card glow>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <Eyebrow>Product</Eyebrow>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-2xl font-semibold text-white">{p.nameEn}</span>
              {p.nameAr && <span dir="rtl" className="text-sm text-dim">{p.nameAr}</span>}
              {!p.active && <Badge>inactive</Badge>}
              {p.isNegative && <Badge tone="bad">negative</Badge>}
              {!p.isNegative && p.isLow && <Badge tone="warn">low</Badge>}
              {p.onHand > 0 && !p.hasCost && <Badge tone="warn">no COGS</Badge>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setBuy(true)}>+ Purchase</Button>
            {productRow && <Button variant="outline" onClick={() => setEdit(true)}>Edit</Button>}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line2 pt-4 sm:grid-cols-4">
          <Stat label="On hand" value={`${num(p.onHand)} ${p.baseUnit}`} accent={p.isNegative ? "text-bad" : "text-text"} />
          <Stat label="Avg cost" value={p.hasCost ? `${egp(p.avgCost)}/${p.baseUnit}` : "—"} />
          <Stat label="Stock value" value={egp(p.stockValue)} />
          <Stat label="Sells at" value={p.sellingPrice != null ? egp(p.sellingPrice) : "—"} />
        </div>
      </Card>

      {/* Period KPIs */}
      <div className="flex items-center justify-between">
        <Eyebrow>Performance · {rangeLabel(rk, range)}</Eyebrow>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Units sold" value={`${num(p.unitsSold)} ${p.baseUnit}`} />
        <Stat label="Revenue" value={egp(p.revenue)} accent="text-good" />
        <Stat label="COGS" value={egp(p.cogs)} accent="text-bad" />
        <Stat label="Gross profit" value={p.grossProfit == null ? "unknown" : egp(p.grossProfit)} accent="text-good" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Margin" value={p.margin == null ? "unknown" : pct(p.margin)} />
        <Stat label="Bought (range)" value={`${num(p.purchaseQty)} ${p.baseUnit}`} />
        <Stat label="Purchase cost" value={egp(p.purchaseCost)} />
        <Stat label="Days of cover" value={p.daysCover == null ? "—" : `≈${Math.round(p.daysCover)}d`} accent={p.daysCover != null && p.daysCover < 7 ? "text-warn" : "text-text"} />
      </div>
      {p.missingCostLines > 0 && (
        <Card><div className="text-sm text-warn">⚠ {p.missingCostLines} sold line(s) have no recorded cost — gross profit is withheld. Add a purchase to set this product's cost.</div></Card>
      )}
      {p.unitsPerDay != null && p.unitsPerDay > 0 && (
        <p className="text-[12px] text-dim">Selling ≈{Math.round(p.unitsPerDay * 10) / 10} {p.baseUnit}/day in this range{p.daysCover != null ? ` · ~${Math.round(p.daysCover)} days of stock left` : ""}.</p>
      )}

      {/* Sale lines */}
      <Eyebrow>Sale lines · {p.saleLines.length}</Eyebrow>
      {p.saleLines.length === 0 ? <Card><p className="text-sm text-dim">No sales of this product in range.</p></Card> : (
        <Card className="!p-0"><div className="divide-y divide-line2">
          {p.saleLines.slice(0, 40).map((l, i) => (
            <Link key={i} to="/sales" className="row-hover flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text">{fmtDate(l.date)}</div>
                <div className="text-[11px] text-dim">{num(l.qty)} {p.baseUnit} × {egp(l.unitPrice ?? 0)}{l.hasCogs ? "" : " · no COGS"}</div>
              </div>
              <div className="font-display text-sm font-semibold text-good">{egp(l.lineTotal)}</div>
            </Link>
          ))}
        </div></Card>
      )}

      {/* Purchases */}
      <Eyebrow>Purchase batches · {p.purchases.length}</Eyebrow>
      {p.purchases.length === 0 ? <Card><p className="text-sm text-dim">No purchases of this product in range.</p></Card> : (
        <Card className="!p-0"><div className="divide-y divide-line2">
          {p.purchases.map((b) => (
            <div key={b.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text">{fmtDate(b.date)}</div>
                <div className="text-[11px] text-dim">{num(b.qty)} {p.baseUnit} × {egp(b.unitCost)}</div>
              </div>
              <div className="font-display text-sm font-semibold">{egp(b.totalCost)}</div>
            </div>
          ))}
        </div></Card>
      )}

      <Modal open={buy} onClose={() => setBuy(false)} title="Add purchase"><PurchaseForm onDone={() => { setBuy(false); d.refetch(); }} /></Modal>
      {productRow && <Modal open={edit} onClose={() => setEdit(false)} title="Edit product"><ProductForm product={productRow} onDone={() => { setEdit(false); d.refetch(); }} /></Modal>}
    </div>
  );
}
