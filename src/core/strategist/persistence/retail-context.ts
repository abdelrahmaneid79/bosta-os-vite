/** Owner-context + packaging persistence (Cycle 11). Stores the answers to the
 *  Owner Knowledge Interview: global context in app_settings 'retail_context',
 *  per-product facts on the products row, and the packaging-format catalog. */
import { requireEngine } from "@/core/db/engine";
import { setAppSetting } from "@/core/db/mutations";
import type { RetailContext, InterviewState } from "../retail/interview";

/* ── global owner context ─────────────────────────────────────────────── */

export async function loadRetailContext(): Promise<RetailContext> {
  const { data } = await requireEngine().from("app_settings").select("value").eq("key", "retail_context").maybeSingle();
  const v = (data?.value ?? {}) as Partial<RetailContext>;
  return {
    allowedPromotions: v.allowedPromotions ?? [],
    allowedDisplayChanges: v.allowedDisplayChanges ?? [],
    customerOccasions: v.customerOccasions ?? [],
    operationalConstraints: v.operationalConstraints ?? [],
    commonlyBoughtTogether: v.commonlyBoughtTogether ?? [],
    answeredKeys: v.answeredKeys ?? [],
    updatedAt: v.updatedAt ?? null,
  };
}

export async function saveRetailContext(patch: Partial<RetailContext>): Promise<void> {
  const cur = await loadRetailContext();
  const next: RetailContext = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  await setAppSetting("retail_context", next);
}

/** Mark a question addressed (incl. deliberate "unknown") so it's never re-asked. */
export async function markQuestionAnswered(id: string): Promise<void> {
  const cur = await loadRetailContext();
  if (cur.answeredKeys.includes(id)) return;
  await saveRetailContext({ answeredKeys: [...cur.answeredKeys, id] });
}

/* ── per-product owner facts ──────────────────────────────────────────── */

export interface ProductContextPatch {
  facings?: number | null;
  displayZone?: string | null;
  shelfLevel?: string | null;
  tier?: "premium" | "standard" | "value" | null;
  packagingFormat?: string | null;
  packagingCost?: number | null;
  packSizeG?: number | null;
  impulseType?: "impulse" | "destination" | null;
  minOrderQty?: number | null;
  supplierLeadDays?: number | null;
  adjacentProductIds?: string[] | null;
  quantityBreaks?: { minQty: number; unitCost: number }[] | null;
  doNotDiscontinue?: boolean;
  isTrafficDriver?: boolean;
}

export async function setProductContext(productId: string, p: ProductContextPatch): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (p.facings !== undefined) row.facings = p.facings;
  if (p.displayZone !== undefined) row.display_zone = p.displayZone;
  if (p.shelfLevel !== undefined) row.shelf_level = p.shelfLevel;
  if (p.tier !== undefined) row.tier = p.tier;
  if (p.packagingFormat !== undefined) row.packaging_format = p.packagingFormat;
  if (p.packagingCost !== undefined) row.packaging_cost = p.packagingCost;
  if (p.packSizeG !== undefined) row.pack_size_g = p.packSizeG;
  if (p.impulseType !== undefined) row.impulse_type = p.impulseType;
  if (p.minOrderQty !== undefined) row.min_order_qty = p.minOrderQty;
  if (p.supplierLeadDays !== undefined) row.supplier_lead_days = p.supplierLeadDays;
  if (p.adjacentProductIds !== undefined) row.adjacent_product_ids = p.adjacentProductIds;
  if (p.quantityBreaks !== undefined) row.quantity_breaks = p.quantityBreaks as never;
  if (p.doNotDiscontinue !== undefined) row.do_not_discontinue = p.doNotDiscontinue;
  if (p.isTrafficDriver !== undefined) row.is_traffic_driver = p.isTrafficDriver;
  const { error } = await requireEngine().from("products").update(row as never).eq("id", productId);
  if (error) throw error;
}

/* ── packaging-format catalog ─────────────────────────────────────────── */

export interface PackagingFormat {
  id?: string;
  name: string;
  packagingType: string | null;
  material: string | null;
  packSizeG: number | null;
  packageCost: number | null;
  prepCost: number | null;
  labelSealCost: number | null;
  prepMinutes: number | null;
  premiumScore: number | null;
  impulseSuitable: boolean;
  giftingSuitable: boolean;
  shelfSpace: string | null;
  displayZone: string | null;
  seasonal: boolean;
  season: string | null;
  applicableProductIds: string[];
  active: boolean;
}

export async function listPackagingFormats(): Promise<PackagingFormat[]> {
  const { data, error } = await requireEngine().from("packaging_formats").select("*").eq("active", true).order("name");
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id, name: r.name, packagingType: r.packaging_type, material: r.material, packSizeG: r.pack_size_g,
    packageCost: r.package_cost, prepCost: r.prep_cost, labelSealCost: r.label_seal_cost, prepMinutes: r.prep_minutes,
    premiumScore: r.premium_score, impulseSuitable: r.impulse_suitable, giftingSuitable: r.gifting_suitable,
    shelfSpace: r.shelf_space, displayZone: r.display_zone, seasonal: r.seasonal, season: r.season,
    applicableProductIds: r.applicable_product_ids ?? [], active: r.active,
  }));
}

export async function createPackagingFormat(f: PackagingFormat): Promise<string> {
  const { data, error } = await requireEngine().from("packaging_formats").insert({
    name: f.name, packaging_type: f.packagingType, material: f.material, pack_size_g: f.packSizeG,
    package_cost: f.packageCost, prep_cost: f.prepCost, label_seal_cost: f.labelSealCost, prep_minutes: f.prepMinutes,
    premium_score: f.premiumScore, impulse_suitable: f.impulseSuitable, gifting_suitable: f.giftingSuitable,
    shelf_space: f.shelfSpace, display_zone: f.displayZone, seasonal: f.seasonal, season: f.season,
    applicable_product_ids: f.applicableProductIds, active: f.active,
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

/* ── interview state assembler ────────────────────────────────────────── */

export async function assembleInterviewState(): Promise<InterviewState> {
  const sb = requireEngine();
  const [context, products, pkg] = await Promise.all([
    loadRetailContext(),
    sb.from("products").select("facings,display_zone,tier,packaging_format,min_order_qty,supplier_lead_days,is_traffic_driver,do_not_discontinue,adjacent_product_ids").eq("active", true),
    sb.from("packaging_formats").select("id", { count: "exact", head: true }).eq("active", true),
  ]);
  const rows = products.data ?? [];
  const cnt = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred).length;
  return {
    context,
    packagingCount: pkg.count ?? 0,
    activeProducts: rows.length,
    productsWithFacings: cnt((r) => r.facings != null),
    productsWithZone: cnt((r) => r.display_zone != null),
    productsWithTier: cnt((r) => r.tier != null),
    productsWithPackaging: cnt((r) => r.packaging_format != null),
    productsWithSupplierTerms: cnt((r) => r.min_order_qty != null || r.supplier_lead_days != null),
    trafficDriversFlagged: cnt((r) => r.is_traffic_driver === true),
    doNotDiscontinueFlagged: cnt((r) => r.do_not_discontinue === true),
    adjacencyFlagged: cnt((r) => Array.isArray(r.adjacent_product_ids) && r.adjacent_product_ids.length > 0),
  };
}
