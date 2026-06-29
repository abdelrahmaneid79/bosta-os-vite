/** Missing-data detection from live reads. Each issue links to where it's
 *  fixed. READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import { getStockSummary } from "./stock";
import { getLifetimeProducts } from "./products";

export type Severity = "high" | "medium" | "low";
export interface MissingIssue {
  key: string; title: string; detail: string; severity: Severity; count: number; route: string; action: string;
}

export async function getMissingData(): Promise<MissingIssue[]> {
  const sb = requireEngine();
  const issues: MissingIssue[] = [];

  const [stock, unmapped, unrecon, lifetime] = await Promise.all([
    getStockSummary(),
    sb.from("sale_items").select("id", { count: "exact", head: true }).is("voided_at", null).is("product_id", null),
    sb.from("sales").select("id", { count: "exact", head: true }).is("voided_at", null).eq("reconciled", false),
    getLifetimeProducts().catch(() => []),
  ]);

  const noCost = lifetime.filter((p) => p.costSource === "unknown" && p.revenue > 0).length;
  if (noCost) issues.push({ key: "product-cost-review", title: "Products with sales but no cost", severity: "low",
    detail: "These sold-through products have no confident cost yet — their gross profit is withheld.", count: noCost, route: "/stock",
    action: "Open each in Goods and set its unit cost (COGS) to unlock profit." });

  if (stock.missingCostCount) issues.push({ key: "missing-cogs", title: "Products missing cost", severity: "high",
    detail: "In stock but no recorded cost — profit is understated.", count: stock.missingCostCount, route: "/purchases",
    action: "Record a purchase for each so weighted-average cost is set." });
  if (stock.negativeCount) issues.push({ key: "negative-stock", title: "Negative stock", severity: "high",
    detail: "On-hand below zero — a purchase is likely missing.", count: stock.negativeCount, route: "/purchases",
    action: "Add the missing purchase to bring on-hand back to reality." });

  const unmappedCount = unmapped.count ?? 0;
  if (unmappedCount) issues.push({ key: "unmapped", title: "Unmapped sale lines", severity: "medium",
    detail: "Sale lines not linked to a product — excluded from product reports.", count: unmappedCount, route: "/sales",
    action: "Open those sale days and map each line to a product." });

  const unreconCount = unrecon.count ?? 0;
  if (unreconCount) issues.push({ key: "unreconciled-sales", title: "Sales days not matching lines", severity: "medium",
    detail: "Day total differs from the sum of product lines beyond tolerance.", count: unreconCount, route: "/sales",
    action: "Open each day and adjust lines or the day total until they agree." });

  const order = { high: 0, medium: 1, low: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
