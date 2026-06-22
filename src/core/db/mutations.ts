/**
 * Write layer — the ONLY place the app mutates Supabase. Products/aliases use
 * safe typed table inserts (no engine side-effects); purchases go through the
 * verified `create_purchase` RPC (stock-in + WAC via DB trigger). All writes
 * run under the owner's authenticated session (RLS `admin_all`). READ paths
 * stay in src/core/read/*.
 */
import {
  requireEngine, createPurchase as rpcCreatePurchase,
  createSaleItem as rpcCreateSaleItem, updateSaleItem as rpcUpdateSaleItem,
  deleteSaleItem as rpcDeleteSaleItem, voidSaleMovements as rpcVoidSaleMovements,
  recalcMoneyAccount, ensureMonthlySettlementPeriod,
} from "@/core/db/engine";
import type { Enums } from "@/core/db/tables";
import type { Database } from "@/core/db/database.types";

type MoneyType = Enums<"money_movement_type">;
type ChequeStatus = Enums<"cheque_status">;
const INFLOW: MoneyType[] = ["cheque_inflow", "owner_injection"];
const OUTFLOW: MoneyType[] = ["personal_withdrawal", "cash_expense", "salary"];
const r2 = (n: number) => Math.round(n * 100) / 100;

type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

// ── Products (safe table writes) ────────────────────────────────────────────
export interface ProductInput {
  nameEn: string;
  nameAr: string | null;
  unitType: Enums<"product_unit_type">; // 'weight' | 'count'
  baseUnit: string;                      // 'g' | 'piece' | ...
  saleUnit: string | null;               // 'kg' | ...
  sellingPrice: number | null;
  lowStock: number | null;
  active: boolean;
}

export async function createProduct(input: ProductInput): Promise<string> {
  const { data, error } = await requireEngine()
    .from("products")
    .insert({
      name_en: input.nameEn.trim(),
      name_ar: input.nameAr?.trim() || null,
      unit_type: input.unitType,
      base_unit: input.baseUnit,
      sale_unit: input.saleUnit?.trim() || null,
      selling_price: input.sellingPrice,
      low_stock_threshold: input.lowStock,
      active: input.active,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateProduct(id: string, input: Partial<ProductInput>): Promise<void> {
  const patch: ProductUpdate = {};
  if (input.nameEn !== undefined) patch.name_en = input.nameEn.trim();
  if (input.nameAr !== undefined) patch.name_ar = input.nameAr?.trim() || null;
  if (input.unitType !== undefined) patch.unit_type = input.unitType;
  if (input.baseUnit !== undefined) patch.base_unit = input.baseUnit;
  if (input.saleUnit !== undefined) patch.sale_unit = input.saleUnit?.trim() || null;
  if (input.sellingPrice !== undefined) patch.selling_price = input.sellingPrice;
  if (input.lowStock !== undefined) patch.low_stock_threshold = input.lowStock;
  if (input.active !== undefined) patch.active = input.active;
  const { error } = await requireEngine().from("products").update(patch).eq("id", id);
  if (error) throw error;
}

export async function setProductActive(id: string, active: boolean): Promise<void> {
  const { error } = await requireEngine().from("products").update({ active }).eq("id", id);
  if (error) throw error;
}

/** Teach the import matcher an alternate name for a product (idempotent-ish). */
export async function addAlias(productId: string, alias: string): Promise<void> {
  const normalized = alias.trim().toLowerCase().replace(/\s+/g, " ");
  const { error } = await requireEngine().from("product_aliases").insert({
    product_id: productId, alias: alias.trim(), normalized, alias_type: "name_ar", source: "manual",
  });
  if (error) throw error;
}

// ── Purchases (verified engine RPC: stock-in + weighted-average cost) ────────
export interface PurchaseInput {
  productId: string;
  quantity: number;        // in product base units
  unitCost: number;        // per base unit
  vendor: string | null;   // free-text supplier note (kept simple for now)
  invoiceRef: string | null;
  date: string;            // YYYY-MM-DD
  locationId: string;
}

export async function addPurchase(input: PurchaseInput): Promise<void> {
  await rpcCreatePurchase({
    supplierId: null,            // supplier picker comes later; vendor kept in invoiceRef/note
    invoiceRef: input.invoiceRef ?? input.vendor ?? null,
    purchaseDate: input.date,
    locationId: input.locationId,
    lines: [{ product_id: input.productId, quantity: input.quantity, unit_cost: input.unitCost }],
    source: "manual",
    verification: "verified",
  });
}

// ── Sales (header = safe insert; lines + reversal = verified RPCs) ───────────
export interface SaleInput { date: string; total: number; locationId: string; channelId: string; }

/** One canonical sale per (location, day). Guarded against duplicates. */
export async function createSale(input: SaleInput): Promise<string> {
  const sb = requireEngine();
  const existing = await sb.from("sales").select("id").is("voided_at", null)
    .eq("location_id", input.locationId).eq("sale_date", input.date).limit(1);
  if (existing.error) throw existing.error;
  if (existing.data.length) throw new Error("A sale already exists for that day — open it to add items.");
  const { data, error } = await sb.from("sales").insert({
    sale_date: input.date, location_id: input.locationId, channel_id: input.channelId,
    total_amount: input.total, source_type: "manual", verification: "verified",
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

export async function updateSaleTotal(saleId: string, total: number): Promise<void> {
  const { error } = await requireEngine().from("sales").update({ total_amount: total }).eq("id", saleId);
  if (error) throw error;
}

export interface SaleItemInput { saleId: string; productId: string; qty: number; unitPrice: number; lineTotal: number; notes: string | null; }

/** Add a product line → deducts stock + snapshots COGS + reconciles the day (RPC). */
export async function addSaleItem(i: SaleItemInput): Promise<void> {
  await rpcCreateSaleItem({
    p_sale_id: i.saleId, p_product_id: i.productId, p_raw_product_name: "",
    p_quantity: i.qty, p_unit_price: i.unitPrice, p_line_total: i.lineTotal, p_notes: i.notes ?? "",
  });
}

/** Edit a line → reverses old movement, reapplies new at current weighted cost (RPC). */
export async function editSaleItem(itemId: string, i: Omit<SaleItemInput, "saleId">): Promise<void> {
  await rpcUpdateSaleItem({
    p_id: itemId, p_product_id: i.productId, p_raw_product_name: "",
    p_quantity: i.qty, p_unit_price: i.unitPrice, p_line_total: i.lineTotal, p_notes: i.notes ?? "",
  });
}

/** Void a line → restores stock (RPC). Reversible, never a hard money delete. */
export async function voidSaleItem(itemId: string): Promise<void> {
  await rpcDeleteSaleItem(itemId);
}

/** Void the whole day → soft-void header + void all its inventory movements (RPC). */
export async function voidSale(saleId: string): Promise<void> {
  await rpcVoidSaleMovements(saleId);
  const { error } = await requireEngine().from("sales")
    .update({ voided_at: new Date().toISOString(), void_reason: "Voided by owner" }).eq("id", saleId);
  if (error) throw error;
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 3 — EXPENSES (standalone ledger; independent of revenue/settlement)
// ════════════════════════════════════════════════════════════════════════════
export interface ExpenseInput {
  date: string; categoryId: string; amount: number;
  paymentMethod: Enums<"payment_method">; notes: string | null; locationId: string;
}
export async function addExpense(i: ExpenseInput): Promise<void> {
  const { error } = await requireEngine().from("expenses").insert({
    expense_date: i.date, location_id: i.locationId, category_id: i.categoryId,
    amount: i.amount, payment_method: i.paymentMethod, notes: i.notes,
    verification: "verified", is_estimated: false, source_type: "manual",
  });
  if (error) throw error;
}
export async function voidExpense(id: string): Promise<void> {
  const { error } = await requireEngine().from("expenses")
    .update({ voided_at: new Date().toISOString(), void_reason: "Voided by owner" })
    .eq("id", id).is("voided_at", null);
  if (error) throw error;
}
/** Find-or-create an expense category by name. */
export async function ensureExpenseCategory(name: string, isOperating: boolean): Promise<string> {
  const sb = requireEngine();
  const existing = await sb.from("expense_categories").select("id").ilike("name", name.trim()).limit(1);
  if (existing.error) throw existing.error;
  if (existing.data.length) return existing.data[0].id;
  const { data, error } = await sb.from("expense_categories")
    .insert({ name: name.trim(), is_operating: isOperating, active: true }).select("id").single();
  if (error) throw error;
  return data.id;
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 3 — CASH / MONEY (signed movements; recalc is the single source of truth)
// ════════════════════════════════════════════════════════════════════════════
export interface MovementInput {
  accountId: string; type: MoneyType; amount: number; // positive magnitude
  date: string; direction?: "in" | "out"; notes: string | null;
}
function signed(type: MoneyType, magnitude: number, direction?: "in" | "out"): number {
  if (INFLOW.includes(type)) return Math.abs(magnitude);
  if (OUTFLOW.includes(type)) return -Math.abs(magnitude);
  return direction === "out" ? -Math.abs(magnitude) : Math.abs(magnitude); // adjustment
}
export async function createMovement(i: MovementInput): Promise<void> {
  const sb = requireEngine();
  const { error } = await sb.from("money_movements").insert({
    account_id: i.accountId, movement_date: i.date, movement_type: i.type,
    amount: signed(i.type, i.amount, i.direction), notes: i.notes, source_type: "manual",
  });
  if (error) throw error;
  await recalcMoneyAccount(i.accountId);
}
/** Owner withdrawal — forced to personal_withdrawal so it can never be an expense. */
export async function recordWithdrawal(accountId: string, amount: number, date: string, notes: string | null): Promise<void> {
  await createMovement({ accountId, type: "personal_withdrawal", amount, date, notes });
}
export async function voidMovement(id: string, accountId: string): Promise<void> {
  const sb = requireEngine();
  const { error } = await sb.from("money_movements")
    .update({ voided_at: new Date().toISOString(), void_reason: "Voided by owner" })
    .eq("id", id).is("voided_at", null);
  if (error) throw error;
  await recalcMoneyAccount(accountId);
}
/** Physical cash count: snapshot expected, store reconciliation, land balance via a voidable adjustment. */
export async function recordCashCount(accountId: string, counted: number, date: string, notes: string | null): Promise<number> {
  const sb = requireEngine();
  const acc = await sb.from("money_accounts").select("current_balance").eq("id", accountId).single();
  if (acc.error) throw acc.error;
  const expected = Number(acc.data.current_balance);
  const difference = r2(counted - expected);
  const recon = await sb.from("cash_reconciliations")
    .insert({ account_id: accountId, count_date: date, counted_amount: counted, expected_balance: expected, notes })
    .select("id").single();
  if (recon.error) throw recon.error;
  if (difference !== 0) {
    const mv = await sb.from("money_movements").insert({
      account_id: accountId, movement_date: date, movement_type: "adjustment", amount: difference,
      reference_type: "cash_reconciliation", reference_id: recon.data.id,
      notes: notes ?? `Cash count: counted ${counted} vs expected ${expected}`, source_type: "manual",
    });
    if (mv.error) throw mv.error;
    await recalcMoneyAccount(accountId);
  }
  return difference;
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 4 — CHEQUES / SETTLEMENTS
// ════════════════════════════════════════════════════════════════════════════
export async function openSettlementPeriod(locationId: string, month: string): Promise<void> {
  await ensureMonthlySettlementPeriod(locationId, month); // idempotent RPC; seeds rent + 3%
}
export interface ChequeInput {
  periodId: string; expected: number; received: number | null;
  receivedDate: string | null; status: ChequeStatus; notes: string | null;
}
export async function recordCheque(i: ChequeInput): Promise<void> {
  const received = (["received", "deposited", "cleared", "reconciled"] as ChequeStatus[]).includes(i.status);
  if (received && (i.received == null || !i.receivedDate)) {
    throw new Error("A received cheque needs an amount received and a received date.");
  }
  const { error } = await requireEngine().from("cheques").insert({
    settlement_period_id: i.periodId, status: i.status, expected_amount: i.expected,
    amount_received: i.received, received_date: i.receivedDate, notes: i.notes,
  });
  if (error) throw error;
}
/** Mark a recorded cheque reconciled (forward-only lifecycle). */
export async function reconcileCheque(id: string): Promise<void> {
  const { error } = await requireEngine().from("cheques")
    .update({ status: "reconciled", edited_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}
export async function voidCheque(id: string): Promise<void> {
  const { error } = await requireEngine().from("cheques")
    .update({ voided_at: new Date().toISOString(), void_reason: "Voided by owner" })
    .eq("id", id).is("voided_at", null);
  if (error) throw error;
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 7 — SETTINGS (app_settings + location_terms; additive, no migrations)
// ════════════════════════════════════════════════════════════════════════════
export async function setAppSetting(key: string, value: unknown): Promise<void> {
  const { error } = await requireEngine().from("app_settings")
    .upsert({ key, value: value as never, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
}
/** New effective-dated lease term (rent flat amount, or revenue_charge rate). */
export async function setLocationTerm(locationId: string, type: Enums<"term_type">, value: number, effectiveFrom: string): Promise<void> {
  const { error } = await requireEngine().from("location_terms").insert({
    location_id: locationId, term_type: type, effective_from: effectiveFrom,
    amount: type === "rent" ? value : null, rate: type === "revenue_charge" ? value : null,
  });
  if (error) throw error;
}
