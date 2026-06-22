import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, Eyebrow, Stat, Badge, Tabs } from "@/components/ui";
import { EmptyState, SkeletonRows, ErrorState } from "@/components/feedback";
import { egp, egpShort } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { monthBoundsCairo, lastMonthBoundsCairo, isoDaysAgo, todayCairo } from "@/core/time";
import { getMoneyMovements, getCashSummary } from "@/core/read/money";
import { getSettlementPeriods, getCheques } from "@/core/read/settlements";

const en = isEngineConfigured;
type RK = "30d" | "month" | "last";
function range(k: RK) {
  return k === "30d" ? { from: isoDaysAgo(todayCairo(), 29), to: todayCairo() } : k === "last" ? lastMonthBoundsCairo() : monthBoundsCairo();
}

// ── Money / Cash ───────────────────────────────────────────────────────────
export function MoneyScreen() {
  const [k, setK] = useState<RK>("month");
  const r = range(k);
  const sum = useQuery({ queryKey: ["cash", r], queryFn: () => getCashSummary(r), enabled: en });
  const mv = useQuery({ queryKey: ["mv", r], queryFn: () => getMoneyMovements(r), enabled: en });
  const c = sum.data;
  if (!en) return <EmptyState title="Sign in to load money" />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Eyebrow>Cash ledger · withdrawals kept out of profit</Eyebrow>
        <Tabs value={k} onChange={setK} options={[{ value: "30d", label: "30 days" }, { value: "month", label: "This month" }, { value: "last", label: "Last month" }]} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Cash balance" value={c ? (c.balance == null ? "—" : egp(c.balance)) : "—"} />
        <Stat label="Inflow" value={c ? egpShort(c.inflow) : "—"} accent="text-good" />
        <Stat label="Outflow" value={c ? egpShort(Math.abs(c.outflow)) : "—"} accent="text-bad" />
        <Stat label="Withdrawals" value={c ? egpShort(c.withdrawals) : "—"} accent="text-bad" />
      </div>
      <Eyebrow>Movements</Eyebrow>
      {mv.isLoading ? <SkeletonRows /> : mv.isError ? <ErrorState message={String((mv.error as Error)?.message)} /> :
        (mv.data?.length ?? 0) === 0 ? <EmptyState title="No movements in range" /> : (
        <Card className="!p-0"><div className="divide-y divide-line2">
          {mv.data!.map((m) => (
            <div key={m.id} className="row-hover flex items-center gap-3 px-4 py-3">
              <span className={`h-2.5 w-2.5 rounded-full ${m.amount >= 0 ? "bg-good" : "bg-bad"}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm capitalize text-text">{m.type.replace(/_/g, " ")}{m.notes ? ` · ${m.notes}` : ""}</div>
                <div className="text-[12px] text-dim">{fmtDate(m.date)}{m.isWithdrawal ? " · not an expense" : ""}</div>
              </div>
              <div className={`font-display text-sm font-semibold ${m.amount >= 0 ? "text-good" : "text-bad"}`}>{m.amount >= 0 ? "+" : "−"}{egp(Math.abs(m.amount))}</div>
            </div>
          ))}
        </div></Card>
      )}
    </div>
  );
}

// ── Cheques / Settlements ────────────────────────────────────────────────────
export function ChequesScreen() {
  const periods = useQuery({ queryKey: ["periods"], queryFn: getSettlementPeriods, enabled: en });
  const cheques = useQuery({ queryKey: ["cheques"], queryFn: getCheques, enabled: en });
  if (!en) return <EmptyState title="Sign in to load settlements" />;
  return (
    <div className="space-y-4">
      <Eyebrow>Settlement periods · net expected = revenue − deductions</Eyebrow>
      {periods.isLoading ? <SkeletonRows /> : periods.isError ? <ErrorState message={String((periods.error as Error)?.message)} /> :
        (periods.data?.length ?? 0) === 0 ? <EmptyState title="No settlement periods yet" /> : (
        <Card className="!p-0"><div className="divide-y divide-line2">
          {periods.data!.map((p) => (
            <div key={p.id} className="row-hover flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text">{fmtDate(p.start)}{p.end ? ` → ${fmtDate(p.end)}` : ""}</div>
                <div className="text-[12px] text-dim">{egp(p.revenue)} − {egp(p.deductions)} deductions</div>
              </div>
              <Badge tone={p.status === "reconciled" ? "good" : p.status === "open" ? "pink" : "neutral"}>{p.status}</Badge>
              <div className="font-display text-sm font-semibold">{egp(p.netExpected)}</div>
            </div>
          ))}
        </div></Card>
      )}
      <Eyebrow>Cheques received</Eyebrow>
      {cheques.isLoading ? <SkeletonRows /> : (cheques.data?.length ?? 0) === 0 ? <EmptyState title="No cheques recorded" /> : (
        <Card className="!p-0"><div className="divide-y divide-line2">
          {cheques.data!.map((c) => (
            <div key={c.id} className="row-hover flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text">{c.receivedDate ? fmtDate(c.receivedDate) : "pending"}</div>
                <div className="text-[12px] text-dim">expected {egp(c.expected)}{c.received != null ? ` · received ${egp(c.received)}` : ""}</div>
              </div>
              <Badge tone={c.status === "reconciled" ? "good" : "neutral"}>{c.status}</Badge>
              {c.difference != null && <div className={`font-display text-sm font-semibold ${c.difference >= 0 ? "text-good" : "text-bad"}`}>{c.difference >= 0 ? "+" : "−"}{egp(Math.abs(c.difference))}</div>}
            </div>
          ))}
        </div></Card>
      )}
    </div>
  );
}
