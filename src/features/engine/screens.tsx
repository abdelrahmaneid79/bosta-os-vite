/**
 * Stock / Sales / Purchases / Reconcile screens, driven entirely by live
 * Supabase reads through the verified engine's caches, with full write actions
 * (create/edit/void) on Goods, Sales and Purchases. No mock data: when the
 * connection isn't configured a Connect panel shows instead of fake numbers.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, Eyebrow, Stat, Badge, Tabs, Button, Input } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { Confirm } from "@/components/ui/Confirm";
import { EmptyState, SkeletonRows, ErrorState } from "@/components/feedback";
import { egp, egpShort, num, pct } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { monthBoundsCairo, lastMonthBoundsCairo, isoDaysAgo, todayCairo } from "@/core/time";
import type { DateRange } from "@/core/read/common";
import { getStockSummary } from "@/core/read/stock";
import { getProducts } from "@/core/read/common";
import { getRecentSales, getSalesStats, getSaleItems, type SaleRow as SaleRowVM, type SaleLine } from "@/core/read/sales";
import { getPurchases, getPurchaseTotal } from "@/core/read/purchases";
import { getProfitReadout } from "@/core/read/profit";
import { ProductForm, PurchaseForm, SaleForm, SaleItemForm } from "./forms";
import { voidSaleItem, voidSale } from "@/core/db/mutations";
import { errorMessage } from "@/core/db/errors";
import { useUI } from "@/store/ui";
import { useQueryClient } from "@tanstack/react-query";
import type { Tables } from "@/core/db/tables";

type RangeKey = "30d" | "month" | "last";
function useRange(): [DateRange, RangeKey, (k: RangeKey) => void] {
  const [key, setKey] = useState<RangeKey>("month");
  const range =
    key === "30d" ? { from: isoDaysAgo(todayCairo(), 29), to: todayCairo() }
    : key === "last" ? lastMonthBoundsCairo()
    : monthBoundsCairo();
  return [range, key, setKey];
}

function RangeTabs({ value, onChange }: { value: RangeKey; onChange: (k: RangeKey) => void }) {
  return (
    <Tabs value={value} onChange={onChange} options={[
      { value: "30d", label: "30 days" }, { value: "month", label: "This month" }, { value: "last", label: "Last month" },
    ]} />
  );
}

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
        <Stat label="Stock value" value={s ? egpShort(s.totalValue) : "—"} />
        <Stat label="Products" value={s ? s.positions.length : "—"} />
        <Stat label="Missing COGS" value={s ? s.missingCostCount : "—"} accent={s?.missingCostCount ? "text-warn" : "text-text"} />
        <Stat label="Negative" value={s ? s.negativeCount : "—"} accent={s?.negativeCount ? "text-bad" : "text-text"} />
      </div>
      <div className="flex items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…" className="flex-1" />
        <Button onClick={() => setModal({ mode: "add" })}>+ Product</Button>
      </div>
      <Guarded q={q} empty={!!s && s.positions.length === 0}>
        <Card className="!p-0">
          <div className="divide-y divide-line2">
            {positions.map((p) => {
              const prod = byId.get(p.id);
              return (
                <button key={p.id} onClick={() => prod && setModal({ mode: "edit", product: prod })}
                  className="row-hover flex w-full items-center gap-3 px-4 py-3 text-left">
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
                </button>
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
  const [range, key, setKey] = useRange();
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<SaleRowVM | null>(null);
  const stats = useQuery({ queryKey: ["salesStats", range], queryFn: () => getSalesStats(range), enabled: isEngineConfigured });
  const recent = useQuery({ queryKey: ["recentSales"], queryFn: () => getRecentSales(60), enabled: isEngineConfigured });
  const s = stats.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Revenue = Σ daily totals (canonical)</Eyebrow>
        <div className="flex-1" />
        <RangeTabs value={key} onChange={setKey} />
        <Button onClick={() => setAddOpen(true)}>+ Sale</Button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Revenue" value={s ? egp(s.total) : "—"} />
        <Stat label="Sales days" value={s ? s.days : "—"} />
        <Stat label="Unreconciled" value={s ? s.unreconciled : "—"} accent={s?.unreconciled ? "text-warn" : "text-text"} />
      </div>
      <Eyebrow>Recent sales · tap to open</Eyebrow>
      <Guarded q={recent} empty={!!recent.data && recent.data.length === 0}>
        <Card className="!p-0">
          <div className="divide-y divide-line2">
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
  const { toast } = useUI();
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ["saleItems", sale.id], queryFn: () => getSaleItems(sale.id), enabled: isEngineConfigured });
  const [addLine, setAddLine] = useState(false);
  const [editItem, setEditItem] = useState<SaleLine | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "line"; item: SaleLine } | { kind: "day" }>(null);

  const refresh = () => { qc.invalidateQueries(); items.refetch(); };
  const voidLine = useMutation({ mutationFn: (id: string) => voidSaleItem(id), onSuccess: () => { toast("Line voided · stock restored", "success"); setConfirm(null); refresh(); }, onError: (e) => { console.error("[BostaOS write]", e); toast(errorMessage(e), "error"); } });
  const voidDay = useMutation({ mutationFn: () => voidSale(sale.id), onSuccess: () => { toast("Sale day voided · stock restored", "success"); setConfirm(null); onClose(); qc.invalidateQueries(); }, onError: (e) => { console.error("[BostaOS write]", e); toast(errorMessage(e), "error"); } });

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
        <div className="divide-y divide-line2 rounded-xl border border-line">
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
  const [range, key, setKey] = useRange();
  const [addOpen, setAddOpen] = useState(false);
  const q = useQuery({ queryKey: ["purchases", range], queryFn: () => getPurchases(range), enabled: isEngineConfigured });
  const total = useQuery({ queryKey: ["purchaseTotal", range], queryFn: () => getPurchaseTotal(range), enabled: isEngineConfigured });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Purchases feed COGS → WAC</Eyebrow>
        <div className="flex-1" />
        <RangeTabs value={key} onChange={setKey} />
        <Button onClick={() => setAddOpen(true)}>+ Purchase</Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Spend in range" value={total.data != null ? egp(total.data) : "—"} />
        <Stat label="Batches" value={q.data ? q.data.length : "—"} />
      </div>
      <Guarded q={q} empty={!!q.data && q.data.length === 0}>
        <Card className="!p-0">
          <div className="divide-y divide-line2">
            {q.data?.map((r) => (
              <div key={r.id} className="row-hover flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-text">{r.productName}</div>
                  <div className="text-[12px] text-dim">{fmtDate(r.date)} · {num(r.quantity)} × {egp(r.unitCost)}</div>
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
  const [range, key, setKey] = useRange();
  const q = useQuery({ queryKey: ["profit", range], queryFn: () => getProfitReadout(range), enabled: isEngineConfigured });
  const p = q.data;
  const rangeLabel = key === "month" ? "this month" : key === "last" ? "last month" : "last 30 days";
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Eyebrow>Profit · {rangeLabel}</Eyebrow>
        <RangeTabs value={key} onChange={setKey} />
      </div>
      {!isEngineConfigured ? <ConnectPanel /> : q.isError ? <ErrorState message={String((q.error as Error)?.message)} /> : (
        <>
          <Card glow>
            <Eyebrow>Net profit · after costs &amp; expenses</Eyebrow>
            <div className="mt-1 flex flex-wrap items-end gap-3">
              <div className="font-display text-5xl font-semibold leading-none text-white">
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
      <div className="h-2 overflow-hidden rounded-full bg-line2">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, pctWidth))}%`, transition: "width .5s ease" }} />
      </div>
    </div>
  );
}
