import { describe, it, expect } from "vitest";
import {
  composeAlerts, categoryForKey, fromInsight, fromMissing,
  severityCounts, partitionAlerts, bellCount, type Alert,
} from "@/core/alerts/engine";
import type { Insight } from "@/core/insights/risk";
import type { MissingIssue } from "@/core/read/missing";

const insight = (over: Partial<Insight> = {}): Insight => ({
  key: "stock-neg-1", severity: "critical", title: "Neg", detail: "d", action: "fix", route: "/purchases", confidence: "high", ...over,
});
const missing = (over: Partial<MissingIssue> = {}): MissingIssue => ({
  key: "missing-cogs", title: "No cost", detail: "d", severity: "high", count: 3, route: "/purchases", action: "fix", ...over,
});

describe("alert category mapping", () => {
  it("maps key prefixes to categories", () => {
    expect(categoryForKey("stock-out-9")).toBe("stock");
    expect(categoryForKey("cash-negative")).toBe("cash");
    expect(categoryForKey("settle-diff-1")).toBe("settlement");
    expect(categoryForKey("trend-rev")).toBe("trend");
    expect(categoryForKey("budget-revenue")).toBe("budget");
    expect(categoryForKey("import-row-3")).toBe("import");
    expect(categoryForKey("unmapped")).toBe("data");
    expect(categoryForKey("negative-stock")).toBe("stock");
  });
});

describe("source mapping", () => {
  it("carries insight fields through unchanged", () => {
    const a = fromInsight(insight({ metric: "−5 kg" }));
    expect(a).toMatchObject({ key: "stock-neg-1", severity: "critical", category: "stock", metric: "−5 kg", confidence: "high" });
  });
  it("namespaces missing keys and maps severity high→critical", () => {
    const a = fromMissing(missing());
    expect(a.key).toBe("missing:missing-cogs");
    expect(a.severity).toBe("critical");
    expect(a.metric).toBe("3");
  });
  it("maps missing medium→warning, low→info", () => {
    expect(fromMissing(missing({ severity: "medium" })).severity).toBe("warning");
    expect(fromMissing(missing({ severity: "low" })).severity).toBe("info");
  });
});

describe("composeAlerts", () => {
  it("merges sources, dedupes by key, sorts by severity", () => {
    const extra: Alert = { key: "z-info", severity: "info", category: "trend", title: "i", detail: "d", action: "a", route: "/" };
    const out = composeAlerts({
      insights: [insight({ key: "k1", severity: "warning" }), insight({ key: "k1", severity: "critical" })],
      missing: [missing({ key: "neg", severity: "high" })],
      extra: [extra],
    });
    // dedup: k1 appears once (first wins = warning)
    expect(out.filter((a) => a.key === "k1")).toHaveLength(1);
    // sorted critical → warning → info
    expect(out[0].severity).toBe("critical");
    expect(out[out.length - 1].severity).toBe("info");
  });
  it("returns [] for empty sources", () => {
    expect(composeAlerts({})).toEqual([]);
  });
});

describe("severityCounts + bellCount", () => {
  const alerts: Alert[] = [
    { key: "a", severity: "critical", category: "stock", title: "", detail: "", action: "", route: "/" },
    { key: "b", severity: "warning", category: "cash", title: "", detail: "", action: "", route: "/" },
    { key: "c", severity: "info", category: "trend", title: "", detail: "", action: "", route: "/" },
  ];
  it("counts by severity", () => {
    expect(severityCounts(alerts)).toEqual({ critical: 1, warning: 1, info: 1, total: 3 });
  });
  it("bell counts only non-info open alerts", () => {
    expect(bellCount(alerts)).toBe(2);
  });
});

describe("partitionAlerts (dismiss + auto-resolve)", () => {
  const alerts: Alert[] = [
    { key: "a", severity: "critical", category: "stock", title: "", detail: "", action: "", route: "/" },
    { key: "b", severity: "warning", category: "cash", title: "", detail: "", action: "", route: "/" },
  ];
  it("splits open vs dismissed", () => {
    const { open, dismissed } = partitionAlerts(alerts, ["b"]);
    expect(open.map((a) => a.key)).toEqual(["a"]);
    expect(dismissed.map((a) => a.key)).toEqual(["b"]);
  });
  it("reports stale dismissals (resolved conditions) for pruning", () => {
    const { staleKeys } = partitionAlerts(alerts, ["b", "gone-key"]);
    expect(staleKeys).toEqual(["gone-key"]);
  });
});
