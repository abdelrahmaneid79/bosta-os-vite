/** PERFORMANCE — the single answer to "how is the business actually doing?"
 *
 *  This replaces three overlapping screens (Reports Overview, Profit, and
 *  Tables & export) that between them showed the same P&L in three different
 *  shapes and buried it under a dozen charts. The owner's verdict on the old
 *  version was that he had no idea what it did or how to use it, which is a
 *  fair reading of a page that opened with eight KPI tiles and no sentence.
 *
 *  It now reads top to bottom as one argument:
 *
 *      what came in  →  what it cost  →  what's left
 *      is that getting better or worse?
 *      which products earn it?
 *      where does the money go?
 *
 *  Everything genuinely useful but occasional — the pattern charts, the event
 *  log, the CSV exports — moves behind a subpage so it stays available without
 *  competing with the headline. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card, Eyebrow, Badge, Button } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, SkeletonRows, ErrorState, PartialNote } from "@/components/feedback";
import { DateRangePicker } from "@/components/DateRangePicker";
import { useBooksStartDate } from "@/store/books";
import { BarChart, LineChart, DonutChart, HBars } from "@/components/charts";
import { egp, egpShort, pct } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { useActiveRange, useFilters } from "@/store/filters";
import { rangeLabel } from "@/core/range";
import { cn } from "@/core/utils/cn";
import { getAnalytics } from "@/core/read/analytics";
import { getProfitReadout } from "@/core/read/profit";
import { getLifetimeProducts, getProductProfit } from "@/core/read/products";
import { getExpenseCategoryTrends, getExpenses } from "@/core/read/expenses";
import { getActivityFeed } from "@/core/read/activity";
import { getStockSummary } from "@/core/read/stock";
import { getCheques } from "@/core/read/settlements";
import { getBurnMonths, summariseBurn } from "@/core/read/bank";
import { getBudgetStatus } from "@/core/read/budgets";
import { getRevenueForecast } from "@/core/read/forecast";
import { priorRange } from "@/core/time";
import { SubpageCard } from "./deck";

const en = isEngineConfigured;

/* ── shared bits ────────────────────────────────────────────────────────── */

/** One band of the money story. Width is share of revenue, so the bands
 *  visibly narrow from what came in down to what was actually kept. */
function Band({ label, amount, pctWidth, tone, strong }: {
  label: string; amount: string; pctWidth: number; tone: string; strong?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className={cn("text-[12.5px]", strong ? "font-display font-semibold text-text" : "text-muted")}>{label}</span>
        <span className={cn("tnum font-display text-sm font-semibold", strong ? "text-pink" : "text-text")}>{amount}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-panel2">
        <div className={cn("h-full rounded-full", tone)}
          style={{ width: `${Math.min(100, Math.max(0, pctWidth))}%`, transition: "width .5s cubic-bezier(.2,.8,.2,1)" }} />
      </div>
    </div>
  );
}

function downloadCSV(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

type ChartMode = "daily" | "trend" | "monthly";
const MODE_LABEL: Record<ChartMode, string> = { daily: "Daily", trend: "Trend", monthly: "Monthly" };

/* ── the screen ─────────────────────────────────────────────────────────── */

export function PerformanceScreen() {
  const nav = useNavigate();
  const range = useActiveRange();
  const rk = useFilters((s) => s.rangeKey);
  const accStart = useBooksStartDate();
  const [mode, setMode] = useState<ChartMode>("daily");
  const [sub, setSub] = useState<null | "patterns" | "activity" | "export">(null);

  const a = useQuery({ queryKey: ["analytics", range, accStart], queryFn: () => getAnalytics(range, accStart), enabled: en });
  const profit = useQuery({ queryKey: ["profit", range, accStart], queryFn: () => getProfitReadout(range, accStart), enabled: en });
  const lifetime = useQuery({ queryKey: ["lifetime-products"], queryFn: getLifetimeProducts, enabled: en });
  const burnQ = useQuery({ queryKey: ["owner-burn"], queryFn: getBurnMonths, enabled: en });

  if (!en) return <EmptyState title="Sign in to see how you're doing" />;
  if (a.isLoading || profit.isLoading) return <div className="space-y-4"><SkeletonRows rows={3} /><SkeletonRows rows={6} /></div>;
  if (a.isError) return <ErrorState message={String((a.error as Error)?.message)} onRetry={() => a.refetch()} />;

  const an = a.data!;
  const p = profit.data;
  const partial = range.from < accStart ? accStart : null;
  const hasData = an.daily.length > 0;

  // Product leaderboard: prefer per-line detail, fall back to lifetime POS totals
  const lp = lifetime.data ?? [];
  const lifeMode = an.productsByRevenue.length === 0 && lp.length > 0;
  const revLeaders = lifeMode
    ? lp.slice().sort((x, y) => y.revenue - x.revenue).slice(0, 8).map((x) => ({ label: x.name, value: x.revenue }))
    : an.productsByRevenue.slice(0, 8);

  const rev = p?.revenue ?? 0;
  const share = (n: number) => (rev > 0 ? (n / rev) * 100 : 0);

  // What the owner took out over the SAME months the page is showing. Drawings
  // sit below the profit line — they are an appropriation of profit, never an
  // expense — so they extend the story rather than changing any figure above.
  // Only months fully inside the chosen range count, so a part-month never
  // drags in a whole month's drawings.
  const burnInRange = (burnQ.data ?? []).filter(
    (m) => !m.cogsMissing && m.month >= range.from.slice(0, 7) && m.month <= range.to.slice(0, 7),
  );
  const draw = burnInRange.length ? summariseBurn(burnInRange) : null;
  const leftIn = p?.netProfit != null && draw ? p.netProfit - draw.tookOut : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>Performance · {rangeLabel(rk, range)}</Eyebrow>
        <DateRangePicker />
      </div>
      {partial && <PartialNote since={partial} />}

      {/* ═══ THE MONEY STORY — in, out, kept ═══ */}
      <Card glow>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Eyebrow>Kept after everything</Eyebrow>
            <div className="mt-1 tnum font-display text-4xl font-extrabold leading-none text-text sm:text-5xl">
              {p ? (p.netProfit == null ? "—" : egp(p.netProfit)) : "—"}
            </div>
          </div>
          {p && p.netMargin != null && (
            <Badge tone={p.netMargin >= 0 ? "good" : "bad"}>{pct(p.netMargin)} of every pound</Badge>
          )}
        </div>

        <div className="mt-6 space-y-3">
          <Band label="Sales" amount={p ? egp(p.revenue) : "—"} pctWidth={100} tone="bg-good" />
          <Band label="− What the goods cost" amount={p ? egp(p.cogs) : "—"} pctWidth={share(p?.cogs ?? 0)} tone="bg-bad/70" />
          <Band label="= Left after goods" amount={p ? (p.grossProfit == null ? "—" : egp(p.grossProfit)) : "—"}
            pctWidth={share(p?.grossProfit ?? 0)} tone="bg-pink/60" />
          <Band label="− Running costs" amount={p ? egp(p.operatingExpenses) : "—"} pctWidth={share(p?.operatingExpenses ?? 0)} tone="bg-warn/70" />
          <Band label="= Yours to keep" amount={p ? (p.netProfit == null ? "—" : egp(p.netProfit)) : "—"}
            pctWidth={share(p?.netProfit ?? 0)} tone="bg-pink" strong />
          {draw && (
            <>
              <Band label="− What you took out" amount={egp(draw.tookOut)} pctWidth={share(draw.tookOut)} tone="bg-warn/70" />
              <Band label="= Left in the business" amount={leftIn == null ? "—" : egp(leftIn)}
                pctWidth={share(Math.max(0, leftIn ?? 0))} tone={leftIn != null && leftIn < 0 ? "bg-bad" : "bg-good"} strong />
            </>
          )}
        </div>

        {draw && (
          <button type="button" onClick={() => nav("/bank")}
            className="mt-4 w-full rounded-xl border border-white/[0.09] bg-white/[0.03] px-3.5 py-3 text-left transition hover:bg-white/[0.06] active:scale-[0.995] motion-reduce:active:scale-100">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px]">
              <span className="font-bold text-text">Took out {egp(draw.tookOut)}</span>
              {leftIn != null && leftIn < 0
                ? <span className="font-bold text-bad">{egp(-leftIn)} over profit</span>
                : <span className="font-bold text-good">{egp(leftIn ?? 0)} left in</span>}
              <span className="w-full text-[11.5px] font-semibold text-dim">{draw.months} months · from the bank card → </span>
            </div>
          </button>
        )}

        {p && !p.complete && (
          <div className="mt-4 rounded-xl border border-warn/30 bg-warn/[0.07] px-3.5 py-2.5 text-[12.5px] text-warn">
            Not final yet — {egp(p.uncoveredRevenue)} of sales still need their product cost added.
            {p.margin != null && <span className="text-dim"> On the part with costs, margin is {pct(p.margin)}.</span>}
          </div>
        )}
      </Card>

      {/* ═══ TREND — is it getting better or worse ═══ */}
      {!hasData ? <EmptyState title="No sales in this range" hint="Pick a wider period or record a sale." /> : (
        <>
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <Eyebrow>Sales over time</Eyebrow>
                <div className="tnum text-[11.5px] text-dim">
                  {an.daily.length} days · {egp(an.daily.reduce((s, d) => s + d.value, 0))}
                </div>
              </div>
              <div className="seg">
                {(["daily", "trend", "monthly"] as ChartMode[]).map((m) => (
                  <span key={m} className={cn(mode === m && "on")} onClick={() => setMode(m)}>{MODE_LABEL[m]}</span>
                ))}
              </div>
            </div>
            {mode === "trend" ? <LineChart data={an.rolling} color="rgb(var(--good))" />
              : mode === "monthly" ? <BarChart data={an.monthlyRevenue} />
              : <BarChart data={an.daily} />}
          </Card>

          {/* ═══ WHAT EARNS / WHERE IT GOES ═══ */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <div className="flex items-center justify-between">
                <Eyebrow>What sells most</Eyebrow>
                {lifeMode && <Badge tone="neutral">all time</Badge>}
              </div>
              <div className="mt-3">
                {revLeaders.length
                  ? <HBars data={revLeaders} color="rgb(var(--pink))" format={(n) => egpShort(n)} />
                  : <p className="text-sm text-dim">No product sales recorded yet.</p>}
              </div>
            </Card>
            <Card>
              <Eyebrow>Where the money goes</Eyebrow>
              {an.expenseDistribution.length === 0
                ? <p className="mt-3 text-sm text-dim">No costs recorded in this period.</p>
                : <div className="mt-3"><DonutChart data={an.expenseDistribution} /></div>}
            </Card>
          </div>

          {/* ═══ THE REST — available, not in the way ═══ */}
          <div className="sp-grid">
            <SubpageCard title="Patterns" sub="Best days, weekly rhythm, forecast" onClick={() => setSub("patterns")} />
            <SubpageCard title="Every event" sub="Sales, purchases, cash, cheques" onClick={() => setSub("activity")} />
            <SubpageCard title="Download" sub="Spreadsheets of anything here" onClick={() => setSub("export")} />
          </div>
        </>
      )}

      <Modal open={sub === "patterns"} onClose={() => setSub(null)} title="Patterns" wide><PatternsPanel /></Modal>
      <Modal open={sub === "activity"} onClose={() => setSub(null)} title="Every event" wide><ActivityPanel /></Modal>
      <Modal open={sub === "export"} onClose={() => setSub(null)} title="Download" wide><ExportPanel /></Modal>
    </div>
  );
}

/* ── subpage: patterns ──────────────────────────────────────────────────── */

function PatternsPanel() {
  const range = useActiveRange();
  const accStart = useBooksStartDate();
  const a = useQuery({ queryKey: ["analytics", range, accStart], queryFn: () => getAnalytics(range, accStart), enabled: en });
  const budgets = useQuery({ queryKey: ["budget-status"], queryFn: getBudgetStatus, enabled: en });
  const forecast = useQuery({ queryKey: ["revenue-forecast"], queryFn: () => getRevenueForecast(), enabled: en });
  if (a.isLoading) return <SkeletonRows rows={6} />;
  const an = a.data;
  if (!an) return <EmptyState title="Nothing to chart yet" />;
  const f = forecast.data;
  const b = budgets.data;

  return (
    <div className="space-y-4">
      {f && f.tradingDays > 0 && (
        <Card>
          <Eyebrow>What the next few weeks look like</Eyebrow>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-line bg-panel2 p-4">
              <div className="text-[12px] font-medium text-muted">Next 7 days</div>
              <div className="mt-1 tnum font-display text-2xl font-extrabold text-text">{egpShort(f.next7)}</div>
              <div className="mt-0.5 text-[11px] text-dim">about {egpShort(f.avgPerDay)} a day</div>
            </div>
            <div className="rounded-2xl border border-line bg-panel2 p-4">
              <div className="text-[12px] font-medium text-muted">Next 30 days</div>
              <div className="mt-1 tnum font-display text-2xl font-extrabold text-text">{egpShort(f.next30)}</div>
              <div className="mt-0.5 text-[11px] text-dim">if trade holds</div>
            </div>
          </div>
        </Card>
      )}

      {b?.configured && b.rows.length > 0 && (
        <Card>
          <Eyebrow>Against your targets</Eyebrow>
          <div className="mt-3 space-y-3">
            {b.rows.map((r) => (
              <Band key={r.key} label={r.label} amount={r.actual == null ? "—" : egpShort(r.actual)}
                pctWidth={r.target > 0 && r.actual != null ? (r.actual / r.target) * 100 : 0}
                tone={r.status === "over" ? "bg-bad" : r.status === "behind" ? "bg-warn" : "bg-good"} />
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <Eyebrow>Which weekday earns most</Eyebrow>
          <div className="mt-3"><BarChart data={an.dayOfWeek} height={180} color="rgb(var(--info))" /></div>
        </Card>
        <Card>
          <Eyebrow>Your best days</Eyebrow>
          <div className="mt-2 -mb-1 divide-y divide-line">
            {an.topRevenueDays.map((d, i) => (
              <div key={d.date} className="flex items-center gap-3 py-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-panel2 tnum text-[11px] font-bold text-dim">{i + 1}</span>
                <span className="flex-1 text-sm font-medium text-text">{fmtDate(d.date, "d MMM yyyy")}</span>
                <span className="tnum font-display text-sm font-bold text-good">{egp(d.total)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <Eyebrow>Sales against stock buying</Eyebrow>
        <div className="mt-3 space-y-3">
          <div><div className="mb-1 text-[11px] font-semibold text-good">Sales</div><BarChart data={an.monthlyRevenue} height={140} color="rgb(var(--good))" /></div>
          <div><div className="mb-1 text-[11px] font-semibold text-warn">Stock bought</div><BarChart data={an.monthlyPurchases} height={110} color="rgb(var(--warn))" /></div>
        </div>
      </Card>
    </div>
  );
}

/* ── subpage: activity ──────────────────────────────────────────────────── */

const KIND_LABEL: Record<string, string> = {
  sale: "Sale", purchase: "Stock bought", expense: "Expense", cash: "Cash",
  withdrawal: "You took out", cheque: "Cheque", count: "Count", close: "Day closed", exception: "Needs attention",
};

function ActivityPanel() {
  const navigate = useNavigate();
  const feed = useQuery({ queryKey: ["activity-full"], queryFn: () => getActivityFeed(60, 200), enabled: en });
  if (feed.isLoading) return <SkeletonRows rows={8} />;
  if (feed.isError) return <ErrorState message={String((feed.error as Error)?.message)} onRetry={() => feed.refetch()} />;
  if ((feed.data?.length ?? 0) === 0) return <EmptyState title="Nothing recorded yet" hint="Your sales, purchases and cash show up here" />;
  return (
    <div className="scroll" style={{ maxHeight: "70vh" }}>
      <table className="dtbl">
        <thead><tr><th>Date</th><th>What happened</th><th className="r">Amount (EGP)</th></tr></thead>
        <tbody>
          {feed.data!.map((e) => (
            <tr key={`${e.kind}-${e.id}`} className="prodcell" onClick={() => navigate(e.route)}>
              <td style={{ whiteSpace: "nowrap", color: "rgb(var(--dim))" }}>{fmtDate(e.date, "d MMM yyyy")}</td>
              <td>
                <span style={{ color: "rgb(var(--dim))", fontSize: 12, marginRight: 8 }}>{KIND_LABEL[e.kind] ?? e.kind}</span>
                {e.label}
              </td>
              <td className="r" style={{ color: e.amount > 0 ? "var(--green)" : "rgb(var(--muted))" }}>
                {e.amount !== 0 ? `${e.amount > 0 ? "+" : "−"}${Math.abs(e.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── subpage: export ────────────────────────────────────────────────────── */

function ExportPanel() {
  const range = useActiveRange();
  const rk = useFilters((s) => s.rangeKey);
  const accStart = useBooksStartDate();
  const prior = priorRange(range);
  const stock = useQuery({ queryKey: ["stock"], queryFn: getStockSummary, enabled: en });
  const profit = useQuery({ queryKey: ["profit", range, accStart], queryFn: () => getProfitReadout(range, accStart), enabled: en });
  const expenses = useQuery({ queryKey: ["expenses", range], queryFn: () => getExpenses(range), enabled: en });
  const cats = useQuery({ queryKey: ["expTrends", range, prior], queryFn: () => getExpenseCategoryTrends(range, prior), enabled: en });
  const cheques = useQuery({ queryKey: ["cheques"], queryFn: getCheques, enabled: en });
  const prods = useQuery({ queryKey: ["productProfit", range], queryFn: () => getProductProfit(range), enabled: en });
  const p = profit.data;

  const items: { label: string; ready: boolean; run: () => void }[] = [
    { label: "Profit summary", ready: !!p, run: () => downloadCSV("profit.csv", p ? [{
      range: rangeLabel(rk, range), sales: Math.round(p.revenue), cost_of_goods: Math.round(p.cogs),
      gross_profit: p.grossProfit == null ? "unknown" : Math.round(p.grossProfit),
      gross_margin_pct: p.margin == null ? "unknown" : p.margin.toFixed(1),
      running_costs: Math.round(p.operatingExpenses),
      net_profit: p.netProfit == null ? "unknown" : Math.round(p.netProfit),
    }] : []) },
    { label: "Products", ready: (prods.data?.length ?? 0) > 0, run: () => downloadCSV("products.csv", (prods.data ?? []).map((x) => ({
      product: x.name, units: x.units, sales: Math.round(x.revenue), cost: Math.round(x.cogs),
      profit: x.grossProfit == null ? "unknown" : Math.round(x.grossProfit),
      margin_pct: x.margin == null ? "unknown" : x.margin.toFixed(1),
    }))) },
    { label: "Stock", ready: !!stock.data, run: () => downloadCSV("stock.csv", (stock.data?.positions ?? []).map((x) => ({
      product: x.nameEn, on_hand: x.onHand, unit: x.baseUnit, unit_cost: x.avgCost, stock_value: Math.round(x.stockValue),
    }))) },
    { label: "Expenses", ready: (expenses.data?.length ?? 0) > 0, run: () => downloadCSV("expenses.csv", (expenses.data ?? []).map((e) => ({
      date: e.date, category: e.category, amount: Math.round(e.amount), paid_by: e.paymentMethod, notes: e.notes ?? "",
    }))) },
    { label: "Cost categories", ready: (cats.data?.length ?? 0) > 0, run: () => downloadCSV("cost-categories.csv", (cats.data ?? []).map((c) => ({
      category: c.category, amount: Math.round(c.amount), prior_period: Math.round(c.prior), share_pct: c.sharePct.toFixed(1),
    }))) },
    { label: "Cheques", ready: (cheques.data?.length ?? 0) > 0, run: () => downloadCSV("cheques.csv", (cheques.data ?? []).map((c) => ({
      received: c.receivedDate ?? "", expected: Math.round(c.expected), received_amount: c.received ?? "", difference: c.difference ?? "", status: c.status,
    }))) },
  ];

  return (
    <div>
      <p className="mb-3 text-[12.5px] text-dim">Opens in Excel or Sheets · uses the picked period</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((it) => (
          <Button key={it.label} variant="outline" disabled={!it.ready} onClick={it.run}>
            ⤓ {it.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
