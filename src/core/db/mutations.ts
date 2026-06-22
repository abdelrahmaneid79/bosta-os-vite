/**
 * Write layer — the ONLY place the app mutates Supabase. Products/aliases use
 * safe typed table inserts (no engine side-effects); purchases go through the
 * verified `create_purchase` RPC (stock-in + WAC via DB trigger). All writes
 * run under the owner's authenticated session (RLS `admin_all`). READ paths
 * stay in src/core/read/*.
 */
import { requireEngine, createPurchase as rpcCreatePurchase } from "@/core/db/engine";
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
