/**
 * Stock / Sales / Purchases / Reconcile screens, driven entirely by live
 * Supabase reads through the verified engine's caches, with full write actions
 * (create/edit/void) on Goods, Sales and Purchases. No mock data: when the
 * connection isn't configured a Connect panel shows instead of fake numbers.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, Eyebrow, StatCard, Badge, Button, Input, Select } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { Confirm } from "@/components/ui/Confirm";
import { EmptyState, SkeletonRows, ErrorState, PartialNote } from "@/components/feedback";
import { DateRangePicker } from "@/components/DateRangePicker";
import { usePrefs } from "@/store/prefs";
import { egp, egpShort, num, pct } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { useActiveRange } from "@/store/filters";
import { rangeLabel } from "@/core/range";
import { useFilters } from "@/store/filters";
import { getStockSummary } from "@/core/read/stock";
import { getProducts } from "@/core/read/common";
import { getRecentSales, getSalesStats, getSaleItems, type SaleRow as SaleRowVM, type SaleLine } from "@/core/read/sales";
import { getPurchases, getInventoryPurchases } from "@/core/read/purchases";
import { getProfitReadout } from "@/core/read/profit";
import { ProductForm, PurchaseForm, SaleForm, SaleItemForm } from "./forms";
import { voidSaleItem, voidSale } from "@/core/db/mutations";
import { useUI } from "@/store/ui";
import { useQueryClient } from "@tanstack/react-query";
import type { Tables } from "@/core/db/tables";

const SI = {
  box: "M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10",
  tag: "M20.6 13.4 12 22l-9-9V3h10zM7.5 7.5h.01",
  warn: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  neg: "M12 8v4m0 4h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
  rev: "M3 3v18h18M7 14l3-3 3 3 5-6",
  cal: "M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5",
  spend: "M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  batch: "M21 16V8l-9-5-9 5v8l9 5z",
} as const;

function Guarded({ q, children, empty }: { q: { isLoading: boolean; isError: boolean; error: unknown }; children: React.ReactNode; empty?: boolean }) {
  if (!isEngineConfigured) return <ConnectPanel />;
  if (q.isLoading) return <SkeletonRows rows={6} />;
  if (q.isError) return <ErrorState message={String((q.error as Error)?.message ?? "Read failed")} />;
  if (empty) return <EmptyState title="No data in range" hint="Nothing recorded for this period yet — add an entry to get started." />;
  return <>{children}</>;
}

export function ConnectPanel() {
  return (
    <Card>
      <Eyebrow>Not connected</Eyebrow>
      <p className="mt-1 text-sm text-muted">
        Add <span className="font-mono text-pink">VITE_SUPABASE_URL</span> and{" "}
        <span className="font-mono text-pink">VITE_SUPABASE_ANON_KEY</span> to a <span className="font-mono">.env</span> file to
        load your real data, then sign in. All actions run under your authenticated session.
      </p>
    </Card>
  );
}

// ── Stock / Goods (operational: create + edit) ───────────────────────────────
export function StockScreen() {
  const q = useQuery({ queryKey: ["stock"], queryFn: getStockSummary, enabled: isEngineConfigured });
  const prods = useQuery({ queryKey: ["products-list"], queryFn: getProducts, enabled: isEngineConfigured });
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<null | { mode: "add" } | { mode: "edit"; product: Tables<"products"> }>(null);
  const s = q.data;
  const byId = new Map((prods.data ?? []).map((p) => [p.id, p]));
  const term = search.trim().toLowerCase();
  const positions = (s?.positions ?? []).filter((p) => !term || p.nameEn.toLowerCase().includes(term) || (byId.get(p.id)?.name_ar ?? "").toLowerCase().includes(term));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Stock value" accent="blue" icon={SI.box} value={s ? egpShort(s.totalValue) : "—"} />
        <StatCard label="Products" accent="pink" icon={SI.tag} value={s ? s.positions.length : "—"} />
        <StatCard label="Missing COGS" accent="amber" icon={SI.warn} value={s ? s.missingCostCount : "—"} />
        <StatCard label="Negative" accent="red" icon={SI.neg} value={s ? s.negativeCount : "—"} />
      </div>
      <div className="flex items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…" className="flex-1" />
        <Button onClick={() => setModal({ mode: "add" })}>+ Product</Button>
      </div>
      <Guarded q={q} empty={!!s && s.positions.length === 0}>
        <Card className="!p-0">
          <div className="divide-y divide-line">
            {positions.map((p) => {
              const prod = byId.get(p.id);
              return (
                <div key={p.id} className="row-hover flex w-full items-center gap-3 px-4 py-3">
                  <Link to={`/product/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm text-text">{p.nameEn}</span>
                        {!p.active && <Badge>inactive</Badge>}
                      </div>
                      <div className="text-[12px] text-dim">{num(p.onHand)} {p.baseUnit} · {p.hasCost ? `${egp(p.avgCost)}/${p.baseUnit}` : "no cost"}</div>
                    </div>
                    {p.isNegative && <Badge tone="bad">negative</Badge>}
                    {!p.isNegative && p.isLow && <Badge tone="warn">low</Badge>}
                    {p.onHand > 0 && !p.hasCost && <Badge tone="warn">no COGS</Badge>}
                    <div className="font-display text-sm font-semibold">{egp(p.stockValue)}</div>
                  </Link>
                  <button onClick={() => prod && setModal({ mode: "edit", product: prod })} className="px-1 text-dim hover:text-text" title="Edit product">✎</button>
                </div>
              );
            })}
          </div>
        </Card>
      </Guarded>
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.mode === "edit" ? "Edit product" : "Add product"}>
        <ProductForm product={modal?.mode === "edit" ? modal.product : undefined} onDone={() => setModal(null)} />
      </Modal>
    </div>
  );
}

// ── Sales (operational: create day, add/edit/void lines, void day) ───────────
export function SalesScreen() {
  const range = useActiveRange();
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<SaleRowVM | null>(null);
  const stats = useQuery({ queryKey: ["salesStats", range], queryFn: () => getSalesStats(range), enabled: isEngineConfigured });
  const recent = useQuery({ queryKey: ["recentSales", range], queryFn: () => getRecentSales(120, range), enabled: isEngineConfigured });
  const s = stats.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Revenue = Σ daily totals (canonical)</Eyebrow>
        <div className="flex-1" />
        <DateRangePicker />
        <Button onClick={() => setAddOpen(true)}>+ Sale</Button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Revenue" accent="mint" icon={SI.rev} value={s ? egpShort(s.total) : "—"} />
        <StatCard label="Sales days" accent="pink" icon={SI.cal} value={s ? s.days : "—"} />
        <StatCard label="Unreconciled" accent="amber" icon={SI.warn} value={s ? s.unreconciled : "—"} />
      </div>
      <Eyebrow>Sales in range · tap to open</Eyebrow>
      <Guarded q={recent} empty={!!recent.data && recent.data.length === 0}>
        <Card className="!p-0">
          <div className="divide-y divide-line">
            {recent.data?.map((r) => (
              <button key={r.id} onClick={() => setDetail(r)} className="row-hover flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className={`h-2.5 w-2.5 rounded-full ${r.reconciled ? "bg-good" : "bg-warn"}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text">{fmtDate(r.date)}</div>
                  <div className="text-[12px] text-dim">{r.payment} · {r.source}</div>
                </div>
                {!r.reconciled && <Badge tone="warn">mismatch</Badge>}
                <div className="font-display text-sm font-semibold text-good">{egp(r.total)}</div>
              </button>
            ))}
          </div>
        </Card>
      </Guarded>
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="New sale day"><SaleForm onDone={() => setAddOpen(false)} /></Modal>
      {detail && <Modal open onClose={() => setDetail(null)} title={`Sale · ${fmtDate(detail.date)}`}><SaleDetail sale={detail} onClose={() => setDetail(null)} /></Modal>}
    </div>
  );
}

function SaleDetail({ sale, onClose }: { sale: SaleRowVM; onClose: () => void }) {
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ["saleItems", sale.id], queryFn: () => getSaleItems(sale.id), enabled: isEngineConfigured });
  const [addLine, setAddLine] = useState(false);
  const [editItem, setEditItem] = useState<SaleLine | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "line"; item: SaleLine } | { kind: "day" }>(null);

  const refresh = () => { qc.invalidateQueries(); items.refetch(); };
  const voidLine = useMutation({ mutationFn: (id: string) => voidSaleItem(id), onSuccess: () => { reportSuccess("Void sale line", "Line voided · stock restored"); setConfirm(null); refresh(); }, onError: (e) => reportError("Void sale line", e) });
  const voidDay = useMutation({ mutationFn: () => voidSale(sale.id), onSuccess: () => { reportSuccess("Void sale day", "Sale day voided · all stock movements reversed · revenue removed"); setConfirm(null); onClose(); qc.invalidateQueries(); }, onError: (e) => reportError("Void sale day", e) });

  const lineSum = (items.data ?? []).reduce((a, l) => a + l.lineTotal, 0);
  const missingCogs = (items.data ?? []).filter((l) => l.productId && !l.hasCogs).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-xl bg-panel p-3">
        <div><div className="text-[11px] text-dim">Day total</div><div className="font-display text-lg font-semibold">{egp(sale.total)}</div></div>
        <div className="text-right"><div className="text-[11px] text-dim">Lines</div><div className="font-display text-lg font-semibold">{egp(lineSum)}</div></div>
        <Badge tone={sale.reconciled ? "good" : "warn"}>{sale.reconciled ? "reconciled" : "mismatch"}</Badge>
      </div>
      {missingCogs > 0 && <div className="rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">{missingCogs} line(s) have no cost yet — add a purchase for those products so profit is exact.</div>}

      {items.isLoading ? <SkeletonRows rows={3} /> : (items.data?.length ?? 0) === 0 ? (
        <p className="py-2 text-sm text-dim">No product lines yet. Add lines to deduct stock and track COGS.</p>
      ) : (
        <div className="divide-y divide-line rounded-xl border border-line">
          {items.data!.map((l) => (
            <div key={l.id} className="flex items-center gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-text">{l.name}</div>
                <div className="text-[11px] text-dim">{num(l.qty)} × {egp(l.unitPrice ?? 0)} {l.hasCogs ? "" : "· no COGS"}</div>
              </div>
              <div className="font-display text-sm font-semibold">{egp(l.lineTotal)}</div>
              <button onClick={() => setEditItem(l)} className="px-1.5 text-dim hover:text-text" title="Edit">✎</button>
              <button onClick={() => setConfirm({ kind: "line", item: l })} className="px-1.5 text-dim hover:text-bad" title="Void">✕</button>
            </div>
          ))}
        </div>
      )}

      {addLine ? (
        <div className="rounded-xl border border-line p-3"><SaleItemForm saleId={sale.id} onDone={() => { setAddLine(false); refresh(); }} /></div>
      ) : (
        <Button variant="outline" className="w-full" onClick={() => setAddLine(true)}>+ Add product line</Button>
      )}

      <button onClick={() => setConfirm({ kind: "day" })} className="w-full pt-1 text-center text-xs text-bad hover:underline">Void this whole sale day</button>

      {editItem && <Modal open onClose={() => setEditItem(null)} title="Edit line"><SaleItemForm saleId={sale.id} item={editItem} onDone={() => { setEditItem(null); refresh(); }} /></Modal>}
      <Confirm open={confirm?.kind === "line"} title="Void this line?" danger busy={voidLine.isPending}
        message="This restores the product's stock and removes the line. The day's revenue total is unchanged." confirmLabel="Void line"
        onConfirm={() => confirm?.kind === "line" && voidLine.mutate(confirm.item.id)} onClose={() => setConfirm(null)} />
      <Confirm open={confirm?.kind === "day"} title="Void the whole sale day?" danger busy={voidDay.isPending}
        message="This voids the day's sale and reverses every inventory movement it created. It's reversible only by re-entering the day." confirmLabel="Void day"
        onConfirm={() => voidDay.mutate()} onClose={() => setConfirm(null)} />
    </div>
  );
}

// ── Purchases ─────────────────────────────────────────────────────────────────
export function PurchasesScreen() {
  const range = useActiveRange();
  const [addOpen, setAddOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const prods = useQuery({ queryKey: ["products-list"], queryFn: getProducts, enabled: isEngineConfigured });
  const q = useQuery({ queryKey: ["purchases", range], queryFn: () => getPurchases(range), enabled: isEngineConfigured });
  const inv = useQuery({ queryKey: ["inv-purchases", range], queryFn: () => getInventoryPurchases(range), enabled: isEngineConfigured });
  const rows = (q.data ?? []).filter((r) => !productId || r.productId === productId);
  // lump historical stock buys (no per-product detail) only show in the unfiltered view
  const lump = productId ? [] : (inv.data ?? []);
  const filteredTotal = rows.reduce((s, r) => s + r.totalCost, 0) + lump.reduce((s, r) => s + r.totalCost, 0);
  const entries = rows.length + lump.length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Stock buying = cost of goods · per-product batches feed WAC</Eyebrow>
        <div className="flex-1" />
        <DateRangePicker />
        <Button onClick={() => setAddOpen(true)}>+ Purchase</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={productId} onChange={(e) => setProductId(e.target.value)} className="max-w-xs">
          <option value="">All products</option>
          {(prods.data ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name_en}</option>)}
        </Select>
        {productId && <Button variant="ghost" onClick={() => setProductId("")}>Clear</Button>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatCard label={productId ? "Spend (filtered)" : "Stock spend in range"} accent="amber" icon={SI.spend} value={egp(filteredTotal)} />
        <StatCard label="Entries" accent="blue" icon={SI.batch} value={entries} sub={lump.length ? `${lump.length} historical` : undefined} />
      </div>
      <Guarded q={q} empty={entries === 0}>
        <Card className="!p-0">
          <div className="divide-y divide-line">
            {rows.map((r) => (
              <Link key={r.id} to={`/product/${r.productId}`} className="row-hover flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-text">{r.productName}</div>
                  <div className="text-[12px] text-dim">{fmtDate(r.date)} · {num(r.quantity)} × {egp(r.unitCost)}</div>
                </div>
                <div className="font-display text-sm font-semibold">{egp(r.totalCost)}</div>
              </Link>
            ))}
            {lump.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-text">{r.note}</div>
                  <div className="text-[12px] text-dim">{fmtDate(r.date)} · stock purchase · no product breakdown</div>
                </div>
                <div className="font-display text-sm font-semibold">{egp(r.totalCost)}</div>
              </div>
            ))}
          </div>
        </Card>
      </Guarded>
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add purchase">
        <PurchaseForm onDone={() => setAddOpen(false)} />
      </Modal>
    </div>
  );
}

// ── Reconcile / P&L (read-derived) ────────────────────────────────────────────
export function ReconcileScreen() {
  const range = useActiveRange();
  const key = useFilters((s) => s.rangeKey);
  const accStart = usePrefs((s) => s.accountingStart);
  const q = useQuery({ queryKey: ["profit", range, accStart], queryFn: () => getProfitReadout(range, accStart), enabled: isEngineConfigured });
  const p = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>Profit · {rangeLabel(key, range)}</Eyebrow>
        <DateRangePicker />
      </div>
      {p?.partialBefore && <PartialNote since={p.partialBefore} />}
      {!isEngineConfigured ? <ConnectPanel /> : q.isError ? <ErrorState message={String((q.error as Error)?.message)} /> : (
        <>
          <Card glow>
            <Eyebrow>Net profit · after costs &amp; expenses</Eyebrow>
            <div className="mt-1 flex flex-wrap items-end gap-3">
              <div className="tnum font-display text-5xl font-extrabold leading-none text-text">
                {p ? (p.netProfit == null ? "unknown" : egp(p.netProfit)) : "—"}
              </div>
              {p && p.netMargin != null && <Badge tone={p.netMargin >= 0 ? "good" : "bad"}>{pct(p.netMargin)} net margin</Badge>}
            </div>
            <div className="mt-6 space-y-3">
              <Bar label="Revenue" amount={p ? egp(p.revenue) : "—"} pctWidth={100} tone="bg-good" />
              <Bar label="− Cost of goods" amount={p ? egp(p.cogs) : "—"} pctWidth={p && p.revenue > 0 ? (p.cogs / p.revenue) * 100 : 0} tone="bg-bad/70" />
              <Bar label="= Gross profit" amount={p ? (p.grossProfit == null ? "unknown" : egp(p.grossProfit)) : "—"}
                pctWidth={p && p.revenue > 0 && p.grossProfit != null ? Math.max(0, (p.grossProfit / p.revenue) * 100) : 0} tone="bg-pink/60" />
              <Bar label="− Operating expenses" amount={p ? egp(p.operatingExpenses) : "—"} pctWidth={p && p.revenue > 0 ? (p.operatingExpenses / p.revenue) * 100 : 0} tone="bg-warn/70" />
              <Bar label="= Net profit" amount={p ? (p.netProfit == null ? "unknown" : egp(p.netProfit)) : "—"}
                pctWidth={p && p.revenue > 0 && p.netProfit != null ? Math.max(0, (p.netProfit / p.revenue) * 100) : 0} tone="bg-pink" strong />
            </div>
            {p && p.grossProfit != null && (
              <div className="mt-4 text-[11px] text-dim">
                Gross margin {p.margin != null ? pct(p.margin) : "—"} · personal withdrawals are tracked as cash, never counted as expenses here.
              </div>
            )}
          </Card>
          {p && !p.complete && (
            <Card>
              <div className="text-sm text-warn">
                ⚠ Profit withheld — {p.missingCostLines} of {p.soldLines} sold lines have no recorded cost.
                Revenue is exact; COGS is incomplete, so we show “unknown” rather than a wrong number.
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Bar({ label, amount, pctWidth, tone, strong }: { label: string; amount: string; pctWidth: number; tone: string; strong?: boolean }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className={`text-xs ${strong ? "font-display font-semibold text-text" : "text-muted"}`}>{label}</span>
        <span className={`font-display text-sm font-semibold ${strong ? "text-pink" : "text-text"}`}>{amount}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel2">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, pctWidth))}%`, transition: "width .5s ease" }} />
      </div>
    </div>
  );
}
