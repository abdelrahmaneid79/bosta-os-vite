/** Sales catch-up assembler — IO for the pure `detectSalesGaps` engine
 *  (Cycle 9 candidate, built Cycle 13). Recorded dates, dates missing
 *  product-line detail, and dates with a staged-but-unapproved import, in one
 *  range. READ-ONLY. */
import { requireEngine } from "@/core/db/engine";
import { detectSalesGaps, type SalesGap } from "@/core/strategist/analysis/operations";

export async function assembleSalesGaps(fromDate: string, today: string): Promise<SalesGap[]> {
  const sb = requireEngine();
  const sales = await sb.from("sales").select("id,sale_date").is("voided_at", null)
    .gte("sale_date", fromDate).lte("sale_date", today);
  if (sales.error) throw sales.error;

  const recordedDates = new Set(sales.data.map((s) => s.sale_date));
  const dateBySaleId = new Map(sales.data.map((s) => [s.id, s.sale_date]));
  const saleIds = sales.data.map((s) => s.id);

  const datesWithLinesMissing = new Set<string>();
  if (saleIds.length) {
    const lines = await sb.from("sale_items").select("sale_id").is("voided_at", null).in("sale_id", saleIds);
    if (lines.error) throw lines.error;
    const datesWithLines = new Set(lines.data.map((l) => dateBySaleId.get(l.sale_id)).filter((d): d is string => !!d));
    for (const d of recordedDates) if (!datesWithLines.has(d)) datesWithLinesMissing.add(d);
  }

  // The imports staging table exists (0009) but current importers preview
  // in-memory rather than writing to it — this stays correct (and empty) for
  // as long as that remains true, and picks up real data the day it isn't.
  const previewed = await sb.from("imports").select("period_from,period_to")
    .is("voided_at", null).eq("status", "previewed").eq("kind", "daily_sales");
  const awaitingImport = new Set<string>();
  if (!previewed.error) {
    for (const imp of previewed.data ?? []) {
      if (!imp.period_from || !imp.period_to) continue;
      for (let t = Date.parse(imp.period_from); t <= Date.parse(imp.period_to); t += 86_400_000) {
        const d = new Date(t).toISOString().slice(0, 10);
        if (d >= fromDate && d <= today) awaitingImport.add(d);
      }
    }
  }

  return detectSalesGaps(recordedDates, datesWithLinesMissing, awaitingImport, fromDate, today);
}
