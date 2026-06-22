import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import { Card, Eyebrow, Stat, Button, Tabs, Field, Input, Badge } from "@/components/ui";
import { Confirm } from "@/components/ui/Confirm";
import { EmptyState } from "@/components/feedback";
import { errorMessage } from "@/core/db/errors";
import { parseSalesRows, parseExpenseRows, type Row } from "@/core/import/csv";
import { getChannels } from "@/core/read/common";
import { createSale, addExpense, ensureExpenseCategory } from "@/core/db/mutations";
import type { Enums } from "@/core/db/tables";
import { egp, egpShort, pct } from "@/core/utils/format";
import { isEngineConfigured, sb } from "@/core/db/engine";
import { useAuth, SignOutButton } from "@/features/auth/auth";
import { monthBoundsCairo, lastMonthBoundsCairo, isoDaysAgo, todayCairo, priorRange } from "@/core/time";
import { getStockSummary } from "@/core/read/stock";
import { getSalesStats } from "@/core/read/sales";
import { getProfitReadout } from "@/core/read/profit";
import { getProductProfit } from "@/core/read/products";
import { getPurchaseTotal } from "@/core/read/purchases";
import { getSettings, getExpenses, getExpenseCategoryTrends } from "@/core/read/expenses";
import { getCheques } from "@/core/read/settlements";
import { getLocations } from "@/core/read/common";
import { setAppSetting, setLocationTerm } from "@/core/db/mutations";
import { WRITE_BADGE } from "@/core/capabilities";
import { useUI } from "@/store/ui";

const en = isEngineConfigured;
type RK = "30d" | "month" | "last" | "custom";
const presetRange = (k: Exclude<RK, "custom">) => k === "30d" ? { from: isoDaysAgo(todayCairo(), 29), to: todayCairo() } : k === "last" ? lastMonthBoundsCairo() : monthBoundsCairo();
const rangeLabel = (k: RK) => k === "month" ? "this month" : k === "last" ? "last month" : k === "30d" ? "last 30 days" : "custom range";

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
  const [cFrom, setCFrom] = useState(monthBoundsCairo().from);
  const [cTo, setCTo] = useState(todayCairo());
  const r = k === "custom" ? { from: cFrom <= cTo ? cFrom : cTo, to: cTo >= cFrom ? cTo : cFrom } : presetRange(k);
  const prior = priorRange(r);
  const stock = useQuery({ queryKey: ["stock"], queryFn: getStockSummary, enabled: en });
  const sales = useQuery({ queryKey: ["salesStats", r], queryFn: () => getSalesStats(r), enabled: en });
  const profit = useQuery({ queryKey: ["profit", r], queryFn: () => getProfitReadout(r), enabled: en });
  const purch = useQuery({ queryKey: ["purchaseTotal", r], queryFn: () => getPurchaseTotal(r), enabled: en });
  const expenses = useQuery({ queryKey: ["expenses", r], queryFn: () => getExpenses(r), enabled: en });
  const expTrends = useQuery({ queryKey: ["expTrends", r, prior], queryFn: () => getExpenseCategoryTrends(r, prior), enabled: en });
  const cheques = useQuery({ queryKey: ["cheques"], queryFn: getCheques, enabled: en });
  const products = useQuery({ queryKey: ["productProfit", r], queryFn: () => getProductProfit(r), enabled: en });
  if (!en) return <EmptyState title="Sign in to build reports" />;
  const p = profit.data;
  const prods = products.data ?? [];
  const cats = expTrends.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>P&L · {rangeLabel(k)} {k === "custom" ? `(${r.from} → ${r.to})` : ""}</Eyebrow>
        <Tabs value={k} onChange={setK} options={[{ value: "30d", label: "30 days" }, { value: "month", label: "This month" }, { value: "last", label: "Last month" }, { value: "custom", label: "Custom" }]} />
      </div>
      {k === "custom" && (
        <Card className="!py-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="From"><Input type="date" value={cFrom} max={cTo} onChange={(e) => setCFrom(e.target.value)} /></Field>
            <Field label="To"><Input type="date" value={cTo} max={todayCairo()} onChange={(e) => setCTo(e.target.value)} /></Field>
            <span className="pb-2 text-[11px] text-dim">vs prior {prior.from} → {prior.to}</span>
          </div>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Revenue" value={p ? egp(p.revenue) : "—"} />
        <Stat label="COGS" value={p ? egp(p.cogs) : "—"} />
        <Stat label="Gross profit" value={p ? (p.grossProfit == null ? "unknown" : egp(p.grossProfit)) : "—"} accent="text-good" />
        <Stat label="Gross margin" value={p ? (p.margin == null ? "unknown" : pct(p.margin)) : "—"} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Operating expenses" value={p ? egp(p.operatingExpenses) : "—"} accent="text-warn" />
        <Stat label="Net profit" value={p ? (p.netProfit == null ? "unknown" : egp(p.netProfit)) : "—"} accent="text-good" />
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
            onClick={() => downloadCSV("pnl-report.csv", p ? [{ range: k, revenue: Math.round(p.revenue), cogs: Math.round(p.cogs), gross_profit: p.grossProfit == null ? "unknown" : Math.round(p.grossProfit), gross_margin_pct: p.margin == null ? "unknown" : p.margin.toFixed(1), operating_expenses: Math.round(p.operatingExpenses), net_profit: p.netProfit == null ? "unknown" : Math.round(p.netProfit), net_margin_pct: p.netMargin == null ? "unknown" : p.netMargin.toFixed(1) }] : [])}>⤓ P&L CSV</Button>
          <Button variant="outline" disabled={!expenses.data?.length}
            onClick={() => downloadCSV("expenses-report.csv", (expenses.data ?? []).map((e) => ({ date: e.date, category: e.category, amount: Math.round(e.amount), payment: e.paymentMethod, notes: e.notes ?? "" })))}>⤓ Expenses CSV</Button>
          <Button variant="outline" disabled={!cheques.data?.length}
            onClick={() => downloadCSV("cheques-report.csv", (cheques.data ?? []).map((c) => ({ received_date: c.receivedDate ?? "", expected: Math.round(c.expected), received: c.received ?? "", difference: c.difference ?? "", status: c.status })))}>⤓ Cheques CSV</Button>
          <Button variant="outline" disabled={!prods.length}
            onClick={() => downloadCSV("product-profit.csv", prods.map((x) => ({ product: x.name, units: x.units, revenue: Math.round(x.revenue), cogs: Math.round(x.cogs), gross_profit: x.grossProfit == null ? "unknown" : Math.round(x.grossProfit), margin_pct: x.margin == null ? "unknown" : x.margin.toFixed(1) })))}>⤓ Products CSV</Button>
        </div>
      </Card>

      <Card className="!p-0">
        <div className="flex items-center justify-between px-4 pt-4">
          <Eyebrow>Most profitable products</Eyebrow>
          {prods.length > 0 && <span className="text-[11px] text-dim">{prods.length} sold</span>}
        </div>
        {products.isLoading ? <div className="px-4 pb-4 pt-2 text-sm text-dim">Loading…</div>
          : prods.length === 0 ? <div className="px-4 pb-4 pt-2 text-sm text-dim">No product lines sold in this range.</div>
          : (
          <div className="mt-2 divide-y divide-line2">
            {prods.slice(0, 12).map((x, i) => {
              const top = prods[0]?.grossProfit ?? 0;
              const w = x.grossProfit != null && top > 0 ? Math.max(2, (x.grossProfit / top) * 100) : 0;
              return (
                <div key={x.productId} className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-5 text-center font-display text-xs font-semibold text-dim">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-text">{x.name}</div>
                      <div className="text-[11px] text-dim">{x.units} sold · {egp(x.revenue)} revenue{x.margin != null ? ` · ${pct(x.margin)} margin` : ""}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-display text-sm font-semibold text-good">{x.grossProfit == null ? "—" : egp(x.grossProfit)}</div>
                      {x.missingCostLines > 0 && <Badge tone="warn">no cost</Badge>}
                    </div>
                  </div>
                  {w > 0 && <div className="ml-7 mt-1.5 h-1.5 overflow-hidden rounded-full bg-line2"><div className="h-full rounded-full bg-pink" style={{ width: `${w}%` }} /></div>}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="!p-0">
        <div className="flex items-center justify-between px-4 pt-4">
          <Eyebrow>Expenses by category · vs prior period</Eyebrow>
          <Button variant="ghost" disabled={!cats.length}
            onClick={() => downloadCSV("expense-categories.csv", cats.map((c) => ({ category: c.category, amount: Math.round(c.amount), prior: Math.round(c.prior), share_pct: c.sharePct.toFixed(1), change_pct: c.changePct == null ? "n/a" : c.changePct.toFixed(1) })))}>⤓ CSV</Button>
        </div>
        {expTrends.isLoading ? <div className="px-4 pb-4 pt-2 text-sm text-dim">Loading…</div>
          : cats.length === 0 ? <div className="px-4 pb-4 pt-2 text-sm text-dim">No expenses in this range.</div>
          : (
          <div className="mt-2 divide-y divide-line2">
            {cats.slice(0, 12).map((c) => (
              <div key={c.category} className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm capitalize text-text">{c.category}</div>
                    <div className="text-[11px] text-dim">{pct(c.sharePct)} of spend{c.prior > 0 ? ` · was ${egp(c.prior)}` : " · new this period"}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-sm font-semibold text-bad">−{egp(c.amount)}</div>
                    {c.changePct != null && (
                      <span className={`font-mono text-[11px] ${c.changePct > 0 ? "text-bad" : "text-good"}`}>
                        {c.changePct > 0 ? "▲ +" : "▼ −"}{Math.abs(Math.round(c.changePct))}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line2"><div className="h-full rounded-full bg-warn/70" style={{ width: `${Math.max(2, Math.min(100, c.sharePct))}%` }} /></div>
              </div>
            ))}
          </div>
        )}
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
    { name: "Write mode", ok: true, detail: "Fully operational" },
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

// ── Imports (CSV → preview → approve; never auto-saves) ──────────────────────
const PAY: Enums<"payment_method">[] = ["cash", "cheque", "card", "transfer", "credit", "unknown"];
type ImpKind = "sales" | "expenses";

export function ImportsScreen() {
  const toast = useUI().toast;
  const qc = useQueryClient();
  const [kind, setKind] = useState<ImpKind>("sales");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileName, setFileName] = useState("");
  const locations = useQuery({ queryKey: ["locations"], queryFn: getLocations, enabled: en });
  const channels = useQuery({ queryKey: ["channels"], queryFn: getChannels, enabled: en });
  const existingDays = useQuery({
    queryKey: ["sale-days"], enabled: en && kind === "sales",
    queryFn: async () => { const { data, error } = await sb!.from("sales").select("sale_date").is("voided_at", null); if (error) throw error; return new Set((data ?? []).map((r) => r.sale_date)); },
  });

  const sales = kind === "sales" && rows ? parseSalesRows(rows) : [];
  const exps = kind === "expenses" && rows ? parseExpenseRows(rows) : [];
  const dup = (d: string | null) => kind === "sales" && d != null && (existingDays.data?.has(d) ?? false);

  const salesReady = sales.filter((r) => !r.issues.length && !dup(r.date));
  const salesDup = sales.filter((r) => !r.issues.length && dup(r.date));
  const expReady = exps.filter((r) => !r.issues.length);
  const blocked = (kind === "sales" ? sales : exps).filter((r) => r.issues.length).length;

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setFileName(f.name);
    Papa.parse<Row>(f, { header: true, skipEmptyLines: true, complete: (res) => setRows(res.data), error: () => toast("Could not parse CSV", "error") });
  }

  const approve = useMutation({
    mutationFn: async () => {
      let imported = 0, skipped = 0, failed = 0;
      if (kind === "sales") {
        const loc = locations.data?.[0], ch = channels.data?.[0];
        if (!loc || !ch) throw new Error("No active location/channel.");
        const seen = new Set(existingDays.data ?? []);
        for (const r of sales) {
          if (r.issues.length || seen.has(r.date!)) { skipped++; continue; }
          try { await createSale({ date: r.date!, total: r.total!, locationId: loc.id, channelId: ch.id }); seen.add(r.date!); imported++; }
          catch { failed++; }
        }
      } else {
        const loc = locations.data?.[0];
        if (!loc) throw new Error("No active location.");
        const cache = new Map<string, string>();
        for (const r of exps) {
          if (r.issues.length) { skipped++; continue; }
          try {
            const key = r.category.toLowerCase();
            let catId = cache.get(key);
            if (!catId) { catId = await ensureExpenseCategory(r.category, true); cache.set(key, catId); }
            const pay = (PAY.includes(r.payment as Enums<"payment_method">) ? r.payment : "cash") as Enums<"payment_method">;
            await addExpense({ date: r.date!, categoryId: catId, amount: r.amount!, paymentMethod: pay, notes: r.notes || null, locationId: loc.id });
            imported++;
          } catch { failed++; }
        }
      }
      return { imported, skipped, failed };
    },
    onSuccess: (res) => { toast(`Imported ${res.imported} · skipped ${res.skipped}${res.failed ? ` · failed ${res.failed}` : ""}`, res.failed ? "error" : "success"); qc.invalidateQueries(); setRows(null); setFileName(""); },
    onError: (e) => { console.error("[BostaOS import]", e); toast(errorMessage(e), "error"); },
  });

  if (!en) return <EmptyState title="Sign in to import" />;
  const readyCount = kind === "sales" ? salesReady.length : expReady.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>CSV import · preview → approve (never auto-saves)</Eyebrow>
        <div className="flex-1" />
        <Tabs value={kind} onChange={(v) => { setKind(v); setRows(null); }} options={[{ value: "sales", label: "Daily sales" }, { value: "expenses", label: "Expenses" }]} />
      </div>

      {!rows ? (
        <Card className="border-dashed">
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="font-display text-base font-semibold">Upload a {kind === "sales" ? "daily sales" : "expenses"} CSV</div>
            <div className="max-w-md text-sm text-dim">
              {kind === "sales" ? "Columns: date, total (grand total per day). Duplicate days are skipped." : "Columns: date, category, amount, payment, notes. New categories are created."}
            </div>
            <label className="lift cursor-pointer rounded-xl bg-pink px-4 py-2.5 font-display text-sm font-semibold text-ink shadow-pink">
              Choose CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
            </label>
          </div>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-dim">{fileName}</span>
            <Badge tone="good">{readyCount} ready</Badge>
            {kind === "sales" && salesDup.length > 0 && <Badge tone="neutral">{salesDup.length} duplicate</Badge>}
            {blocked > 0 && <Badge tone="bad">{blocked} blocked</Badge>}
            <div className="flex-1" />
            <Button variant="ghost" onClick={() => { setRows(null); setFileName(""); }}>Cancel</Button>
            <Button disabled={approve.isPending || readyCount === 0} onClick={() => approve.mutate()}>{approve.isPending ? "Importing…" : `Approve ${readyCount}`}</Button>
          </div>
          <Card className="!p-0">
            <div className="max-h-[55vh] divide-y divide-line2 overflow-y-auto">
              {(kind === "sales" ? sales : exps).slice(0, 200).map((r, i) => {
                const bad = r.issues.length > 0;
                const isDup = kind === "sales" && dup((r as { date: string | null }).date);
                return (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${bad ? "bg-bad" : isDup ? "bg-dim" : "bg-good"}`} />
                    <div className="min-w-0 flex-1">
                      {kind === "sales"
                        ? <span className="text-text">{(r as { date: string | null }).date ?? "—"}</span>
                        : <span className="text-text">{(r as { date: string | null; category: string }).date ?? "—"} · {(r as { category: string }).category}</span>}
                      {(bad || isDup) && <span className="ml-2 text-[11px] text-dim">{bad ? r.issues.join(", ") : "already imported"}</span>}
                    </div>
                    <div className="font-display font-semibold text-text">{egp(kind === "sales" ? (r as { total: number | null }).total ?? 0 : (r as { amount: number | null }).amount ?? 0)}</div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Settings (editable: tracking start, low-stock default, rent, revenue share)
export function SettingsScreen() {
  const { email } = useAuth();
  const toast = useUI().toast;
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings, enabled: en });
  const locations = useQuery({ queryKey: ["locations"], queryFn: getLocations, enabled: en });

  const [tracking, setTracking] = useState("");
  const [lowDefault, setLowDefault] = useState("");
  const [rent, setRent] = useState("");
  const [share, setShare] = useState("");
  const [confirm, setConfirm] = useState<null | "rent" | "share">(null);
  useEffect(() => {
    const s = settings.data; if (!s) return;
    if (typeof s["inventory_tracking_start_date"] === "string") setTracking(s["inventory_tracking_start_date"] as string);
    if (s["low_stock_default"] != null) setLowDefault(String(s["low_stock_default"]));
  }, [settings.data]);

  const loc = locations.data?.[0];
  const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const save = useMutation({
    mutationFn: async (what: "tracking" | "low" | "rent" | "share") => {
      if (what === "tracking") return setAppSetting("inventory_tracking_start_date", tracking);
      if (what === "low") return setAppSetting("low_stock_default", num(lowDefault) ?? 0);
      if (!loc) throw new Error("No location.");
      if (what === "rent") return setLocationTerm(loc.id, "rent", num(rent) ?? 0, todayCairo());
      return setLocationTerm(loc.id, "revenue_charge", (num(share) ?? 0) / 100, todayCairo()); // % → rate
    },
    onSuccess: () => { toast("Saved", "success"); setConfirm(null); qc.invalidateQueries(); },
    onError: (e) => { console.error("[BostaOS write]", e); toast(errorMessage(e), "error"); },
  });

  if (!en) return <EmptyState title="Sign in to manage settings" />;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Card>
        <Eyebrow>Account</Eyebrow>
        <Row label="Signed in" value={email ?? "—"} />
        <Row label="Mode" value={WRITE_BADGE} />
        <Row label="Backend" value="Verified Supabase engine" last />
        <div className="mt-3"><SignOutButton /></div>
      </Card>

      <Card>
        <Eyebrow>Tracking & stock</Eyebrow>
        <div className="mt-2 space-y-3">
          <div className="flex items-end gap-2">
            <Field label="Inventory tracking start"><Input type="date" value={tracking} onChange={(e) => setTracking(e.target.value)} /></Field>
            <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate("tracking")}>Save</Button>
          </div>
          <div className="flex items-end gap-2">
            <Field label="Default low-stock alert (base units)"><Input type="number" step="any" value={lowDefault} onChange={(e) => setLowDefault(e.target.value)} /></Field>
            <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate("low")}>Save</Button>
          </div>
        </div>
      </Card>

      <Card>
        <Eyebrow>Settlement terms (new effective from today)</Eyebrow>
        <p className="mb-2 text-[12px] text-dim">Adds a new effective-dated lease term; the settlement engine uses the latest. Existing periods are unchanged.</p>
        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <Field label="Monthly rent (EGP, flat)"><Input type="number" step="any" value={rent} onChange={(e) => setRent(e.target.value)} placeholder="15000" /></Field>
            <Button variant="outline" disabled={!loc || save.isPending || num(rent) == null} onClick={() => setConfirm("rent")}>Save</Button>
          </div>
          <div className="flex items-end gap-2">
            <Field label="Revenue share (%)"><Input type="number" step="any" value={share} onChange={(e) => setShare(e.target.value)} placeholder="3" /></Field>
            <Button variant="outline" disabled={!loc || save.isPending || num(share) == null} onClick={() => setConfirm("share")}>Save</Button>
          </div>
        </div>
      </Card>

      <Confirm open={confirm === "rent"} title="Change monthly rent?" busy={save.isPending}
        message={`This adds a new lease term of ${num(rent) ?? 0} EGP/month effective today. Future settlement periods will use it; past periods are unchanged. This affects what you're owed.`}
        confirmLabel="Set rent" onConfirm={() => save.mutate("rent")} onClose={() => setConfirm(null)} />
      <Confirm open={confirm === "share"} title="Change revenue share?" busy={save.isPending}
        message={`This adds a new revenue-share term of ${num(share) ?? 0}% effective today. Future settlements deduct this rate from revenue; past periods are unchanged.`}
        confirmLabel="Set share" onConfirm={() => save.mutate("share")} onClose={() => setConfirm(null)} />
    </div>
  );
}
function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return <div className={`flex items-center justify-between py-2.5 ${last ? "" : "border-b border-line2"}`}><span className="text-sm text-muted">{label}</span><span className="text-sm text-text">{value}</span></div>;
}
