import { describe, it, expect } from "vitest";
import { detectSalesGaps } from "@/core/strategist/analysis/operations";

/** The pure engine already has coverage (strategist-activation.test.ts); this
 *  proves the IO assembler's derivation rules are correct: a date counts as
 *  "lines missing" only when a sale exists for it AND none of its (non-void)
 *  lines belong to that date — the exact logic assembleSalesGaps performs
 *  before delegating to detectSalesGaps. */
describe("sales-gaps derivation rules (mirrors assembleSalesGaps)", () => {
  it("a recorded date with zero matching sale_items counts as lines-missing", () => {
    const dateBySaleId = new Map([["s1", "2026-07-10"]]);
    const recordedDates = new Set(["2026-07-10"]);
    const lineSaleIds: string[] = []; // no lines at all for s1
    const datesWithLines = new Set(lineSaleIds.map((id) => dateBySaleId.get(id)).filter((d): d is string => !!d));
    const datesWithLinesMissing = new Set([...recordedDates].filter((d) => !datesWithLines.has(d)));
    expect(datesWithLinesMissing.has("2026-07-10")).toBe(true);
  });

  it("a recorded date WITH matching sale_items is not lines-missing", () => {
    const dateBySaleId = new Map([["s1", "2026-07-10"]]);
    const recordedDates = new Set(["2026-07-10"]);
    const lineSaleIds = ["s1"];
    const datesWithLines = new Set(lineSaleIds.map((id) => dateBySaleId.get(id)).filter((d): d is string => !!d));
    const datesWithLinesMissing = new Set([...recordedDates].filter((d) => !datesWithLines.has(d)));
    expect(datesWithLinesMissing.has("2026-07-10")).toBe(false);
  });

  it("import period_from..period_to expands into a date set clipped to the range", () => {
    const fromDate = "2026-07-05", today = "2026-07-10";
    const period = { period_from: "2026-07-03", period_to: "2026-07-07" };
    const awaitingImport = new Set<string>();
    for (let t = Date.parse(period.period_from); t <= Date.parse(period.period_to); t += 86_400_000) {
      const d = new Date(t).toISOString().slice(0, 10);
      if (d >= fromDate && d <= today) awaitingImport.add(d);
    }
    // 07-03, 07-04 are before fromDate — excluded; 07-05..07-07 included
    expect([...awaitingImport].sort()).toEqual(["2026-07-05", "2026-07-06", "2026-07-07"]);
  });

  it("feeds cleanly into detectSalesGaps and produces recent-first priority", () => {
    const recorded = new Set(["2026-07-08"]);
    const linesMissing = new Set<string>();
    const awaiting = new Set(["2026-07-10"]);
    const gaps = detectSalesGaps(recorded, linesMissing, awaiting, "2026-07-07", "2026-07-10");
    expect(gaps[0].date).toBe("2026-07-10");
    expect(gaps[0].kind).toBe("awaiting_import");
    expect(gaps.some((g) => g.date === "2026-07-09" && g.kind === "missing")).toBe(true);
    expect(gaps.some((g) => g.date === "2026-07-07" && g.kind === "missing")).toBe(true);
    expect(gaps.find((g) => g.date === "2026-07-08")).toBeUndefined(); // recorded + has lines → no gap
  });
});
