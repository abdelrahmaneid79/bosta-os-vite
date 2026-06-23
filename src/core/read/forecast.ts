/** Forecast read-model — pulls a trailing daily-revenue window and runs the pure
 *  forecaster. READ-ONLY. */
import { todayCairo, isoDaysAgo } from "@/core/time";
import { getDailyRevenue } from "./sales";
import { forecastRevenue, type RevenueForecast } from "@/core/forecast/logic";

export async function getRevenueForecast(windowDays = 180): Promise<RevenueForecast> {
  const today = todayCairo();
  const from = isoDaysAgo(today, windowDays - 1);
  const daily = await getDailyRevenue({ from, to: today });
  return forecastRevenue(daily.map((d) => ({ date: d.date, total: d.total })), today);
}
