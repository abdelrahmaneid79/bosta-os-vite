/**
 * Read-only Stock / Sales / Purchases / Reconcile screens, driven entirely by
 * live Supabase reads through the verified engine's caches. No mock data: when
 * the connection isn't configured a Connect panel shows instead of fake numbers.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, Eyebrow, Stat, Badge, Tabs } from "@/components/ui";
import { EmptyState, SkeletonRows, ErrorState } from "@/components/feedback";
import { egp, egpShort, num, pct } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { monthBoundsCairo, lastMonthBoundsCairo, isoDaysAgo, todayCairo } from "@/core/time";
import type { DateRange } from "@/core/read/common";
import { getStockSummary } from "@/core/read/stock";
import { getRecentSales, getSalesStats } from "@/core/read/sales";
import { getPurchases, getPurchaseTotal } from "@/core/read/purchases";
import { getProfitReadout } from "@/core/read/profit";

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
  if (empty) return <EmptyState title="No data in range" hint="Read-only — nothing recorded for this period yet." />;
  return <>{children}</>;
}

export function ConnectPanel() {
  return (
    <Card>
      <Eyebrow>Read-only · not connected</Eyebrow>
      <p className="mt-1 text-sm text-muted">
        Add <span className="font-mono text-pink">VITE_SUPABASE_URL</span> and{" "}
        <span className="font-mono text-pink">VITE_SUPABASE_ANON_KEY</span> to a <span className="font-mono">.env</span> file to
        load your real data. The anon key is free and read-only here — no writes happen, and nothing is created.
      </p>
    </Card>
  );
}

// ── Stock ───────────────────────────────────────────────────────────────────
export function StockScreen() {
  const q = useQuery({ queryKey: ["stock"], queryFn: getStockSummary, enabled: isEngineConfigured });
  const s = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Stock value" value={s ? egpShort(s.totalValue) : "—"} />
        <Stat label="Items" value={s ? s.positions.length : "—"} />
        <Stat label="Missing COGS" value={s ? s.missingCostCount : "—"} accent={s?.missingCostCount ? "text-warn" : "text-text"} />
        <Stat label="Negative" value={s ? s.negativeCount : "—"} accent={s?.negativeCount ? "text-bad" : "text-text"} />
      </div>
      <Eyebrow>Positions (live caches)</Eyebrow>
      <Guarded q={q} empty={!!s && s.positions.length === 0}>
        <Card className="!p-0">
          <div className="divide-y divide-line2">
            {s?.positions.map((p) => (
              <div key={p.id} className="row-hover flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-text">{p.nameEn}</span>
                    {!p.active && <Badge>inactive</Badge>}
                  </div>
                  <div className="text-[12px] text-dim">
                    {num(p.onHand)} {p.baseUnit} · {p.hasCost ? `${egp(p.avgCost)}/${p.baseUnit}` : "no cost"}
                  </div>
                </div>
                {p.isNegative && <Badge tone="bad">negative</Badge>}
                {!p.isNegative && p.isLow && <Badge tone="warn">low</Badge>}
                {p.onHand > 0 && !p.hasCost && <Badge tone="warn">no COGS</Badge>}
                <div className="font-display text-sm font-semibold">{egp(p.stockValue)}</div>
              </div>
            ))}
          </div>
        </Card>
      </Guarded>
    </div>
  );
}

// ── Sales ─────────────────────────────────────────────────────────────────────
export function SalesScreen() {
  const [range, key, setKey] = useRange();
  const stats = useQuery({ queryKey: ["salesStats", range], queryFn: () => getSalesStats(range), enabled: isEngineConfigured });
  const recent = useQuery({ queryKey: ["recentSales"], queryFn: () => getRecentSales(60), enabled: isEngineConfigured });
  const s = stats.data;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Eyebrow>Revenue = Σ daily totals (canonical)</Eyebrow>
        <RangeTabs value={key} onChange={setKey} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Revenue" value={s ? egp(s.total) : "—"} />
        <Stat label="Sales days" value={s ? s.days : "—"} />
        <Stat label="Unreconciled" value={s ? s.unreconciled : "—"} accent={s?.unreconciled ? "text-warn" : "text-text"} />
      </div>
      <Eyebrow>Recent sales</Eyebrow>
      <Guarded q={recent} empty={!!recent.data && recent.data.length === 0}>
        <Card className="!p-0">
          <div className="divide-y divide-line2">
            {recent.data?.map((r) => (
              <div key={r.id} className="row-hover flex items-center gap-3 px-4 py-3">
                <span className={`h-2.5 w-2.5 rounded-full ${r.reconciled ? "bg-good" : "bg-warn"}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text">{fmtDate(r.date)}</div>
                  <div className="text-[12px] text-dim">{r.payment} · {r.source}</div>
                </div>
                {!r.reconciled && <Badge tone="warn">mismatch</Badge>}
                <div className="font-display text-sm font-semibold text-good">{egp(r.total)}</div>
              </div>
            ))}
          </div>
        </Card>
      </Guarded>
    </div>
  );
}

// ── Purchases ─────────────────────────────────────────────────────────────────
export function PurchasesScreen() {
  const [range, key, setKey] = useRange();
  const q = useQuery({ queryKey: ["purchases", range], queryFn: () => getPurchases(range), enabled: isEngineConfigured });
  const total = useQuery({ queryKey: ["purchaseTotal", range], queryFn: () => getPurchaseTotal(range), enabled: isEngineConfigured });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Eyebrow>Purchases feed COGS → WAC</Eyebrow>
        <RangeTabs value={key} onChange={setKey} />
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
    </div>
  );
}

// ── Reconcile / read-only P&L ─────────────────────────────────────────────────
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
            <Eyebrow>Gross profit</Eyebrow>
            <div className="mt-1 flex flex-wrap items-end gap-3">
              <div className="font-display text-5xl font-semibold leading-none text-white">
                {p ? (p.grossProfit == null ? "unknown" : egp(p.grossProfit)) : "—"}
              </div>
              {p && p.margin != null && <Badge tone={p.margin >= 0 ? "good" : "bad"}>{pct(p.margin)} margin</Badge>}
            </div>
            <div className="mt-6 space-y-3">
              <Bar label="Revenue" amount={p ? egp(p.revenue) : "—"} pctWidth={100} tone="bg-good" />
              <Bar label="− Cost of goods" amount={p ? egp(p.cogs) : "—"} pctWidth={p && p.revenue > 0 ? (p.cogs / p.revenue) * 100 : 0} tone="bg-bad/70" />
              <Bar label="= Gross profit" amount={p ? (p.grossProfit == null ? "unknown" : egp(p.grossProfit)) : "—"}
                pctWidth={p && p.revenue > 0 && p.grossProfit != null ? Math.max(0, (p.grossProfit / p.revenue) * 100) : 0} tone="bg-pink" strong />
            </div>
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
