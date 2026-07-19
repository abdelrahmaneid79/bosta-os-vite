/**
 * The engine seam. The Vite app NEVER recomputes verified money math — it calls
 * the proven Postgres RPCs (WAC, inventory ledger, settlement, money recalc)
 * shipped with the existing Supabase backend. This is the ONLY place those
 * write-path RPCs are invoked, with arguments typed from the generated schema.
 * Writes run under the owner's authenticated session (RLS). Reads live in
 * src/core/read/*; all mutations route through src/core/db/mutations.ts.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { FnArgs, Enums } from "./tables";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when Supabase is configured; the app runs under the owner's session. */
export const isEngineConfigured = Boolean(url && anonKey);

export const sb: SupabaseClient<Database> | null = isEngineConfigured
  ? createClient<Database>(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

export function requireEngine(): SupabaseClient<Database> {
  if (!sb) throw new Error("Supabase not configured (set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).");
  return sb;
}

async function rpc<T extends keyof Database["public"]["Functions"]>(
  name: T,
  args: FnArgs<T>,
): Promise<Database["public"]["Functions"][T]["Returns"]> {
  const client = requireEngine();
  const { data, error } = await client.rpc(name, args as never);
  if (error) throw error;
  return data as Database["public"]["Functions"][T]["Returns"];
}

// ── WRITE-PATH WRAPPERS — the verified Postgres RPCs, called from mutations.ts ──

export interface PurchaseLine {
  product_id: string;
  quantity: number;
  /** null = cost-neutral inflow (opening counts with unknown cost) — WAC unchanged per 0006. */
  unit_cost: number | null;
  total_cost?: number;
}

/** Stock IN + WAC snapshot (via trigger). Reverse with void_purchase_batch. */
export const createPurchase = (args: {
  supplierId: string | null;
  invoiceRef: string | null;
  purchaseDate: string;
  locationId: string;
  lines: PurchaseLine[];
  source?: Enums<"source_type">;
  verification?: Enums<"verification_status">;
}) =>
  rpc("create_purchase", {
    p_supplier_id: args.supplierId as string,
    p_invoice_ref: args.invoiceRef as string,
    p_purchase_date: args.purchaseDate,
    p_location_id: args.locationId,
    p_source_type: args.source ?? "manual",
    p_verification: args.verification ?? "verified",
    p_lines: args.lines as unknown as Database["public"]["Functions"]["create_purchase"]["Args"]["p_lines"],
  });

/** Sale line → posts stock-out movement + COGS snapshot + reconciles the day. */
export const createSaleItem = (a: FnArgs<"create_sale_item">) => rpc("create_sale_item", a);
/** Edit: voids old movement first, updates line, re-posts at current WAC. */
export const updateSaleItem = (a: FnArgs<"update_sale_item">) => rpc("update_sale_item", a);
/** Delete: voids movement (restores stock) then removes the line. */
export const deleteSaleItem = (p_id: string) => rpc("delete_sale_item", { p_id });
export const voidSaleAtomic = async (p_sale_id: string, p_reason?: string): Promise<void> => {
  const { error } = await requireEngine().rpc("void_sale" as never, { p_sale_id, p_reason: p_reason ?? null } as never);
  if (error) throw error;
};

export const recalcMoneyAccount = (p_account_id: string) => rpc("recalc_money_account", { p_account_id });
/** Reverse a purchase: voids the batch + its inventory movement; WAC replays. */
export const voidPurchaseBatch = (p_batch_id: string, p_reason: string) => rpc("void_purchase_batch", { p_batch_id, p_reason });
export const ensureMonthlySettlementPeriod = (p_location_id: string, p_month: string) =>
  rpc("ensure_monthly_settlement_period", { p_location_id, p_month });
/** Atomic cash count (0039): reconciliation + conditional adjustment + balance
 *  recalc in one transaction — replaces a 3-round-trip client sequence. */
export const recordCashCountAtomic = (args: {
  accountId: string; countDate: string; counted: number; expected: number; notes: string | null;
  isOpeningBaseline: boolean; verification: string; countedSource: string; bankBalance: number | null;
  idempotencyKey: string | null;
}) => rpc("record_cash_count", {
  p_account_id: args.accountId, p_count_date: args.countDate, p_counted: args.counted, p_expected: args.expected,
  p_notes: args.notes, p_is_opening_baseline: args.isOpeningBaseline, p_verification: args.verification,
  p_counted_source: args.countedSource, p_bank_balance: args.bankBalance, p_idempotency_key: args.idempotencyKey,
  // The generated types mark every function argument non-null, but the SQL
  // signature takes nullable text/numeric and branches on them explicitly
  // (0039: `if p_idempotency_key is not null`). Nulls are the intended input.
} as never) as Promise<{ id: string; difference: number; replayed: boolean }>;
