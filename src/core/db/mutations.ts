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
} from "@/core/db/engine";
import type { Enums } from "@/core/db/tables";
import type { Database } from "@/core/db/database.types";

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
