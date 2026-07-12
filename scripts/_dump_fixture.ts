// TEMP: dump a realistic snapshot + findings for the live grounding test
import { writeFileSync } from "node:fs";
import { makeSnapshot } from "@/core/strategist/analysis/fixture";
import { analyzeSnapshot } from "@/core/strategist/analysis/engine";
import { computeCalendar } from "@/core/strategist/calendar";
import { metric } from "@/core/strategist/contract";

const s = makeSnapshot({
  revenue: { changePct: metric(18, "read/sales.getDailyRevenue", "2026-04→2026-05", "/sales", { basis: "calculated" }) },
  profit: {
    grossMarginPct: metric(35.8, "read/profit.getProfitReadout", "2026-05", "/reconcile", { confidence: "high" }),
    priorGrossMarginPct: metric(40, "read/profit.getProfitReadout", "2026-04", "/reconcile"),
  },
  expenses: { withdrawals: metric(20000, "read/money.getCashSummary", "2026-05", "/money", { note: "NEVER part of operating expenses" }) },
  meta: { isStale: true, staleDays: 43, lastDataDate: "2026-05-31" },
});
const findings = analyzeSnapshot(s);
writeFileSync(process.argv[2], JSON.stringify({ snapshot: s, findings, calendar: computeCalendar("2026-07-13") }));
console.log("findings:", findings.map((f) => `${f.rank}.${f.id}`).join(" "));
