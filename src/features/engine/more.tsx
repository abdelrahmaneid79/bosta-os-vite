import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, Eyebrow, Stat, Button, Tabs } from "@/components/ui";
import { EmptyState, ErrorState } from "@/components/feedback";
import { egp, egpShort, pct } from "@/core/utils/format";
import { isEngineConfigured, sb } from "@/core/db/engine";
import { useAuth, SignOutButton } from "@/features/auth/auth";
import { monthBoundsCairo, lastMonthBoundsCairo, isoDaysAgo, todayCairo } from "@/core/time";
import { getStockSummary } from "@/core/read/stock";
import { getSalesStats } from "@/core/read/sales";
import { getProfitReadout } from "@/core/read/profit";
import { getPurchaseTotal } from "@/core/read/purchases";

const en = isEngineConfigured;
type RK = "30d" | "month" | "last";
const range = (k: RK) => k === "30d" ? { from: isoDaysAgo(todayCairo(), 29), to: todayCairo() } : k === "last" ? lastMonthBoundsCairo() : monthBoundsCairo();

function downloadCSV(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

// ── Reports ─────────────────────────────────────────────────────────────────
export function ReportsScreen() {
  const [k, setK] = useState<RK>("month");
  const r = range(k);
  const stock = useQuery({ queryKey: ["stock"], queryFn: getStockSummary, enabled: en });
  const sales = useQuery({ queryKey: ["salesStats", r], queryFn: () => getSalesStats(r), enabled: en });
  const profit = useQuery({ queryKey: ["profit", r], queryFn: () => getProfitReadout(r), enabled: en });
  const purch = useQuery({ queryKey: ["purchaseTotal", r], queryFn: () => getPurchaseTotal(r), enabled: en });
  if (!en) return <EmptyState title="Sign in to build reports" />;
  const p = profit.data;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Eyebrow>P&L · {k === "month" ? "this month" : k === "last" ? "last month" : "30 days"}</Eyebrow>
        <Tabs value={k} onChange={setK} options={[{ value: "30d", label: "30 days" }, { value: "month", label: "This month" }, { value: "last", label: "Last month" }]} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Revenue" value={p ? egp(p.revenue) : "—"} />
        <Stat label="COGS" value={p ? egp(p.cogs) : "—"} />
        <Stat label="Gross profit" value={p ? (p.grossProfit == null ? "unknown" : egp(p.grossProfit)) : "—"} accent="text-good" />
        <Stat label="Margin" value={p ? (p.margin == null ? "unknown" : pct(p.margin)) : "—"} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Sales days" value={sales.data ? sales.data.days : "—"} />
        <Stat label="Purchases" value={purch.data != null ? egpShort(purch.data) : "—"} />
      </div>
      <Card>
        <Eyebrow>Export (from loaded real data)</Eyebrow>
        <div className="mt-1 flex flex-wrap gap-2">
          <Button variant="outline" disabled={!stock.data}
            onClick={() => downloadCSV("stock-report.csv", (stock.data?.positions ?? []).map((x) => ({
              product: x.nameEn, on_hand: x.onHand, unit: x.baseUnit, avg_cost: x.avgCost, stock_value: Math.round(x.stockValue), missing_cost: !x.hasCost,
            })))}>⤓ Stock CSV</Button>
          <Button variant="outline" disabled={!p}
            onClick={() => downloadCSV("pnl-report.csv", p ? [{ range: k, revenue: Math.round(p.revenue), cogs: Math.round(p.cogs), gross_profit: p.grossProfit == null ? "unknown" : Math.round(p.grossProfit), margin_pct: p.margin == null ? "unknown" : p.margin.toFixed(1) }] : [])}>⤓ P&L CSV</Button>
        </div>
      </Card>
    </div>
  );
}

// ── System Check ──────────────────────────────────────────────────────────
type Chk = { name: string; ok: boolean | null; detail: string };
export function SystemCheckScreen() {
  const { session, email } = useAuth();
  const [tables, setTables] = useState<Chk[]>([]);
  useEffect(() => {
    let on = true;
    (async () => {
      if (!sb) return;
      const names = ["products", "sales", "sale_items", "purchase_batches", "inventory_movements", "money_accounts", "settlement_periods", "cheques"];
      const out: Chk[] = [];
      for (const t of names) {
        const { count, error } = await sb.from(t as "products").select("id", { count: "exact", head: true });
        out.push({ name: `read ${t}`, ok: !error, detail: error ? error.message : `${count ?? 0} rows` });
      }
      if (on) setTables(out);
    })();
    return () => { on = false; };
  }, []);
  const env: Chk[] = [
    { name: "Supabase configured", ok: isEngineConfigured, detail: isEngineConfigured ? "URL + anon key present" : "missing env" },
    { name: "Authenticated session", ok: !!session, detail: session ? (email ?? "signed in") : "not signed in" },
    { name: "Write mode", ok: true, detail: "Write-enabled: Goods + Purchases (others gated)" },
  ];
  return (
    <div className="space-y-4">
      <Group title="Connection & auth" checks={env} />
      <Group title="Table reads (under your session / RLS)" checks={tables} />
    </div>
  );
}
function Group({ title, checks }: { title: string; checks: Chk[] }) {
  return (
    <Card className="!p-0">
      <div className="border-b border-line2 px-4 py-3 font-display text-sm font-semibold">{title}</div>
      <div className="divide-y divide-line2">
        {checks.length === 0 && <div className="px-4 py-3 text-sm text-dim">…</div>}
        {checks.map((c) => (
          <div key={c.name} className="flex items-center gap-3 px-4 py-3">
            <span className={`h-2.5 w-2.5 rounded-full ${c.ok == null ? "bg-dim" : c.ok ? "bg-good" : "bg-bad"}`} />
            <span className="flex-1 text-sm text-text">{c.name}</span>
            <span className="text-[12px] text-dim">{c.detail}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Imports (read-only) ─────────────────────────────────────────────────────
export function ImportsScreen() {
  const q = useQuery({
    queryKey: ["importsCount"], enabled: en,
    queryFn: async () => { const { count, error } = await sb!.from("imports").select("id", { count: "exact", head: true }); if (error) throw error; return count ?? 0; },
  });
  if (!en) return <EmptyState title="Sign in to view imports" />;
  if (q.isError) return <ErrorState message={String((q.error as Error)?.message)} />;
  return (
    <Card>
      <Eyebrow>Import history · read-only</Eyebrow>
      <p className="mt-1 text-sm text-muted">{q.data ?? 0} approved imports on record. Upload + preview/approve is a write workflow and stays disabled until you approve writes.</p>
    </Card>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────
export function SettingsScreen() {
  const { email } = useAuth();
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Card>
        <Eyebrow>Account</Eyebrow>
        <Row label="Signed in" value={email ?? "—"} />
        <Row label="Mode" value="Write-enabled: Goods + Purchases" />
        <Row label="Backend" value="Verified Supabase engine" last />
        <div className="mt-3"><SignOutButton /></div>
      </Card>
      <Card>
        <Eyebrow>Business settings</Eyebrow>
        <p className="text-sm text-muted">Rent, revenue-share and tracking-start live in the engine's <span className="font-mono text-pink">app_settings</span> / <span className="font-mono text-pink">location_terms</span>. Editing them is a write action — gated for now.</p>
      </Card>
    </div>
  );
}
function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return <div className={`flex items-center justify-between py-2.5 ${last ? "" : "border-b border-line2"}`}><span className="text-sm text-muted">{label}</span><span className="text-sm text-text">{value}</span></div>;
}
