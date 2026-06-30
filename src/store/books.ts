/** Authoritative bookkeeping-start date. Prefers the DB clean-books anchor
 *  (app_settings.books_start) so the partial (pre-start) vs accurate (post-start)
 *  eras separate the same way on every device; falls back to the per-browser
 *  preference until the anchor is set. Used as the P&L "partial before" boundary. */
import { useQuery } from "@tanstack/react-query";
import { getBooksStart } from "@/core/read/money";
import { isEngineConfigured } from "@/core/db/engine";
import { usePrefs } from "./prefs";

export function useBooksStartDate(): string {
  const pref = usePrefs((s) => s.accountingStart);
  const q = useQuery({ queryKey: ["books-start"], queryFn: getBooksStart, enabled: isEngineConfigured });
  return q.data?.date ?? pref;
}
