/** Opening balances — the clean-books setup for the books-start date (1 Jul 2026).
 *  Sets the cash-on-hand opening balance (app_settings.books_start.openingCash) and
 *  records counted opening stock as a stock-in dated the books-start, so on-hand
 *  starts at reality and live tracking is accurate from day one. */
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHead, Eyebrow, Button, Field, Input, StatCard } from "@/components/ui";
import { EmptyState, SkeletonRows } from "@/components/feedback";
import { egp } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { getBooksStart } from "@/core/read/money";
import { getProducts, getLocations } from "@/core/read/common";
import { getStockSummary } from "@/core/read/stock";
import { setAppSetting, addPurchase } from "@/core/db/mutations";
import { useUI } from "@/store/ui";

const en = isEngineConfigured;
const num = (s: string): number | null => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };

export function OpeningBalancesScreen() {
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const books = useQuery({ queryKey: ["books-start"], queryFn: getBooksStart, enabled: en });
  const products = useQuery({ queryKey: ["products-list"], queryFn: getProducts, enabled: en });
  const stock = useQuery({ queryKey: ["stock"], queryFn: getStockSummary, enabled: en });
  const locations = useQuery({ queryKey: ["locations"], queryFn: getLocations, enabled: en });

  const [cash, setCash] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});

  const date = books.data?.date ?? "2026-07-01";
  useEffect(() => { if (books.data?.openingCash != null) setCash(String(books.data.openingCash)); }, [books.data]);

  const onHandById = new Map((stock.data?.positions ?? []).map((p) => [p.id, p.onHand]));
  const loc = locations.data?.[0];
  const active = (products.data ?? []).filter((p) => p.active);

  const saveCash = useMutation({
    mutationFn: () => setAppSetting("books_start", { date, openingCash: num(cash) ?? 0 }),
    onSuccess: () => { reportSuccess("Opening cash", `Cash on hand set to ${egp(num(cash) ?? 0)} as of ${fmtDate(date)}`); qc.invalidateQueries(); },
    onError: (e) => reportError("Opening cash", e),
  });

  const stockEntries = Object.entries(counts).map(([id, q]) => ({ id, qty: num(q) ?? 0 })).filter((e) => e.qty > 0);
  const saveStock = useMutation({
    mutationFn: async () => {
      if (!loc) throw new Error("No active location.");
      let n = 0;
      for (const e of stockEntries) {
        const prod = active.find((p) => p.id === e.id);
        await addPurchase({ productId: e.id, quantity: e.qty, unitCost: prod?.reference_cost ?? null, vendor: "Opening stock", invoiceRef: "opening", date, locationId: loc.id });
        n++;
      }
      return n;
    },
    onSuccess: (n) => { reportSuccess("Opening stock", `Recorded opening stock for ${n} product(s) as of ${fmtDate(date)}`); setCounts({}); qc.invalidateQueries(); },
    onError: (e) => reportError("Opening stock", e),
  });

  if (!en) return <EmptyState title="Sign in to set opening balances" />;

  return (
    <div className="space-y-4">
      <Eyebrow>Clean-books setup · opening balances as of {fmtDate(date)}</Eyebrow>

      {/* Opening cash */}
      <Card>
        <CardHead title="Opening cash on hand" sub={`Real cash in the drawer on ${fmtDate(date)}`} accent="mint" icon="M3 7h18v11H3zM3 11h18M7 15h2" />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Cash on hand (EGP)"><Input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="e.g. 2500" className="!w-48" /></Field>
          <Button disabled={saveCash.isPending || num(cash) == null} onClick={() => saveCash.mutate()}>{saveCash.isPending ? "Saving…" : "Set opening cash"}</Button>
        </div>
        <p className="mt-2 text-[11px] text-dim">Replaces the carried-forward prior balance.</p>
      </Card>

      {/* Opening stock */}
      <Card className="!p-0">
        <div className="p-5 pb-2">
          <CardHead title="Opening stock count" sub="Enter what you have on hand" accent="blue" icon="M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10" />
          <div className="flex flex-wrap items-center gap-2">
            <StatCard label="Products to count" accent="violet" icon="M4 7l8-4 8 4v10l-8 4-8-4z" value={active.length} sub="active" />
            <div className="flex-1" />
            <Button disabled={saveStock.isPending || stockEntries.length === 0} onClick={() => saveStock.mutate()}>{saveStock.isPending ? "Saving…" : `Save ${stockEntries.length} count(s)`}</Button>
          </div>
        </div>
        {products.isLoading || stock.isLoading ? <div className="p-4"><SkeletonRows rows={5} /></div> : (
          <div className="max-h-[55vh] divide-y divide-line overflow-y-auto">
            {active.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-text" dir="auto">{p.name_en}{p.name_ar ? <span className="text-dim"> · {p.name_ar}</span> : ""}</div>
                  <div className="text-[11px] text-dim">on hand {onHandById.get(p.id) ?? 0} {p.base_unit}{p.reference_cost != null ? ` · cost ${egp(p.reference_cost)}/${p.base_unit}` : " · no cost yet"}</div>
                </div>
                <Input inputMode="decimal" placeholder="count" value={counts[p.id] ?? ""} onChange={(e) => setCounts((c) => ({ ...c, [p.id]: e.target.value }))} className="!w-28" />
                <span className="w-10 flex-shrink-0 text-[11px] text-dim">{p.base_unit}</span>
              </div>
            ))}
          </div>
        )}
        <p className="px-5 py-3 text-[11px] text-dim">Run once at setup. Leave a product blank to skip. Costs come from Inventory → Product costs.</p>
      </Card>
    </div>
  );
}
