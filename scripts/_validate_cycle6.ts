// TEMP: Cycle 6 production-data validation — real Apr vs May 2025 books
// through the REAL engines (no fixtures, no model).
import { readFileSync } from "node:fs";
import { makeSnapshot } from "@/core/strategist/analysis/fixture";
import { metric } from "@/core/strategist/contract";
import { analyzeContribution, decomposeChange, classifyPortfolio, shelfPriorities, pricingReviews, purchaseReviews } from "@/core/strategist/analysis/products";

const data = JSON.parse(readFileSync(process.argv[2], "utf8"));
const apr = data["2025-04"]; const may = data["2025-05"];
const sum = (l: { revenue: number }[]) => l.reduce((a, p) => a + p.revenue, 0);
const P = "2025-05-01→2025-05-31", C = "2025-04-01→2025-04-30";

const s = makeSnapshot({
  meta: { period: { from: "2025-05-01", to: "2025-05-31", label: P }, comparePeriod: { from: "2025-04-01", to: "2025-04-30", label: C } },
  revenue: { periodRevenue: metric(Math.round(sum(may)), "read/sales", P, "/sales"), priorRevenue: metric(Math.round(sum(apr)), "read/sales", C, "/sales") },
  products: {
    detail: metric(may, "read/products.getProductProfit", P, "/reports", { confidence: "high", completeness: 100 }),
    compareDetail: metric(apr, "read/products.getProductProfit", C, "/reports", { confidence: "high", completeness: 100 }),
    periodDays: metric(31, "read/sales", P, "/sales"),
    comparePeriodDays: metric(30, "read/sales", C, "/sales"),
    positions: metric([], "read/stock", "now", "/stock"),
  },
});
s.inventory.hasLiveData = false;

const rc = analyzeContribution(s, "revenue");
console.log(`\n═══ REVENUE CONTRIBUTION (May vs Apr 2025) — total Δ ${rc.totalChange}, explained ${rc.explainedPct}%, unexplained ${rc.unexplained}`);
console.log("  gainers:", rc.positive.map((x) => `${x.name} +${x.delta}`).join(" · "));
console.log("  decliners:", rc.negative.map((x) => `${x.name} ${x.delta}`).join(" · "));
console.log("  concentrated:", rc.concentrated, "· confidence:", rc.confidence);

const pc = analyzeContribution(s, "grossProfit");
console.log(`\n═══ GROSS-PROFIT CONTRIBUTION — Δ ${pc.totalChange} (known-cost products only; missing: ${pc.missing.length})`);
console.log("  gainers:", pc.positive.slice(0,3).map((x) => `${x.name} +${x.delta}`).join(" · "));
console.log("  drags:", pc.negative.slice(0,3).map((x) => `${x.name} ${x.delta}`).join(" · "));

const d = decomposeChange(s);
console.log(`\n═══ DECOMPOSITION available=${d.available} — volume ${d.volumeEffect} · price ${d.priceEffect} · mix ${d.mixEffect} · cost ${d.costEffect} · residual ${d.residual} (coverage ${d.coverage}%, ${d.knownProducts} products, excluded ${d.excludedProducts.length})`);

const pf = classifyPortfolio(s);
console.log(`\n═══ PORTFOLIO (${pf.classifications.length} products) — thresholds: ${pf.thresholds.map((t)=>`${t.name}=${t.value}(${t.basis})`).join(" · ")}`);
for (const c of pf.classifications.slice(0, 10)) console.log(`  ${c.name}: [${c.tags.join(",")}] rev ${c.revenue} margin ${c.marginPct ?? "?"}% trend ${c.trendPct ?? "—"}% → ${c.recommendedAction.slice(0, 60)}`);
const shelf = shelfPriorities(pf);
console.log(`\n═══ SHELF top: ${shelf.slice(0,5).map((x)=>`${x.name}(${x.verdict})`).join(" · ")}`);
const pr = pricingReviews(s);
console.log(`\n═══ PRICING REVIEWS (${pr.length}):`);
for (const r of pr) console.log(`  ${r.name}: ${r.signals[0]} → target-margin price ${r.priceForTargetMargin ?? "n/a (missing cost)"}${r.missing.length ? ` · missing: ${r.missing[0]}` : ""}`);
const pu = purchaseReviews(s);
console.log(`\n═══ PURCHASE REVIEWS (${pu.length}, inventory untracked → data-first): ${pu.map((x)=>x.name).join(" · ")}`);
