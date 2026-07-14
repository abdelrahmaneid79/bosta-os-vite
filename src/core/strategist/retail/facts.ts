/** RetailBusinessFacts — the provider-neutral facts aggregate (Cycle 10).
 *
 *  `composeRetailFacts` is PURE and unit-tested; `assembleRetailFacts` does the
 *  IO, projecting the audited snapshot + the optional structured merchandising
 *  fields from the products table. It never invents a field — optional layout /
 *  packaging data stays null when unrecorded, and the reasoning engine says
 *  "needs this observation" rather than guessing. */
import { requireEngine } from "@/core/db/engine";
import type { StrategistSnapshot, ProductPeriodEntry, ProductPositionEntry } from "../contract";
import type { StrategyReport } from "../analysis/report";
import type { ProductFact, RetailBusinessFacts } from "./contract";
import { loadRetailContext, listPackagingFormats } from "../persistence/retail-context";
import { EMPTY_CONTEXT } from "./interview";

export interface MerchFields {
  category: string | null;
  packagingFormat: string | null;
  packSizeG: number | null;
  packagingCost: number | null;
  displayZone: string | null;
  shelfLevel: string | null;
  facings: number | null;
  tier: ProductFact["tier"];
  impulseType: ProductFact["impulseType"];
  minOrderQty: number | null;
  supplierLeadDays: number | null;
  quantityBreaks: { minQty: number; unitCost: number }[] | null;
  doNotDiscontinue: boolean;
  ownerTrafficDriver: boolean;
}

export interface ComposeFactsInput {
  period: string;
  comparePeriod: string;
  detail: ProductPeriodEntry[];
  compareDetail: ProductPeriodEntry[];
  positions: ProductPositionEntry[];
  stockRisk: { name: string; daysCover: number | null; onHand: number }[];
  periodDays: number;
  merch: Map<string, MerchFields>;
  totalRevenue: number;
  totalGrossProfit: number | null;
  coveragePct: number | null;
  inventoryTracked: boolean;
  stockCountAgeDays: number | null;
  cashCountFresh: boolean;
  marginFloorPct: number | null;
  maxCoverDays: number | null;
  deadStockDays: number | null;
  strategicProducts: string[];
  cashForPurchases: number | null;
  nextChequeEta: string | null;
  season: RetailBusinessFacts["season"];
  offeredPackaging: RetailBusinessFacts["offeredPackaging"];
  allowedPromotions: string[];
  allowedDisplayChanges: string[];
  customerOccasions: string[];
  operationalConstraints: string[];
  commonlyBoughtTogether: [string, string][];
  isStale: boolean;
  staleDays: number | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function composeRetailFacts(i: ComposeFactsInput): RetailBusinessFacts {
  const priorByName = new Map(i.compareDetail.map((d) => [d.name, d]));
  const posByName = new Map(i.positions.map((p) => [p.name, p]));
  const riskByName = new Map(i.stockRisk.map((r) => [r.name, r]));

  // total inventory value across products with known value
  let totalInvValue = 0;
  for (const p of i.positions) if (p.onHand > 0 && p.avgCost > 0) totalInvValue += p.onHand * p.avgCost;

  const products: ProductFact[] = i.detail.map((d) => {
    const pos = posByName.get(d.name);
    const prior = priorByName.get(d.name);
    const risk = riskByName.get(d.name);
    const merch = i.merch.get(d.name);
    const onHand = pos?.onHand ?? null;
    const avgCost = pos?.avgCost ?? 0;
    const invValue = onHand != null && avgCost > 0 ? onHand * avgCost : null;
    const growthPct = prior && prior.revenue > 0 ? r1(((d.revenue - prior.revenue) / prior.revenue) * 100) : null;
    const marginDeltaPts = d.marginPct != null && prior?.marginPct != null ? r1(d.marginPct - prior.marginPct) : null;
    return {
      id: null,
      name: d.name,
      category: merch?.category ?? null,
      revenue: Math.round(d.revenue),
      grossProfit: d.grossProfit != null ? Math.round(d.grossProfit) : null,
      marginPct: d.marginPct,
      units: d.units,
      cogs: Math.round(d.cogs),
      daysSold: d.daysSold,
      velocityPerDay: d.daysSold > 0 ? r1(d.units / d.daysSold) : null,
      revenueSharePct: i.totalRevenue > 0 ? r1((d.revenue / i.totalRevenue) * 100) : 0,
      profitSharePct: d.grossProfit != null && i.totalGrossProfit && i.totalGrossProfit > 0 ? r1((d.grossProfit / i.totalGrossProfit) * 100) : null,
      growthPct,
      marginDeltaPts,
      onHand,
      inventoryValue: invValue != null ? Math.round(invValue) : null,
      inventorySharePct: invValue != null && totalInvValue > 0 ? r1((invValue / totalInvValue) * 100) : null,
      daysCover: risk?.daysCover ?? null,
      sellingPrice: pos?.sellingPrice ?? null,
      avgCost,
      hasCost: pos?.hasCost ?? !d.missingCost,
      isLow: pos?.isLow ?? false,
      vendor: pos?.vendor ?? null,
      packagingFormat: merch?.packagingFormat ?? null,
      packSizeG: merch?.packSizeG ?? null,
      packagingCost: merch?.packagingCost ?? null,
      displayZone: merch?.displayZone ?? null,
      shelfLevel: merch?.shelfLevel ?? null,
      facings: merch?.facings ?? null,
      tier: merch?.tier ?? null,
      impulseType: merch?.impulseType ?? null,
      minOrderQty: merch?.minOrderQty ?? null,
      supplierLeadDays: merch?.supplierLeadDays ?? null,
      quantityBreaks: merch?.quantityBreaks ?? null,
      doNotDiscontinue: merch?.doNotDiscontinue ?? false,
      ownerTrafficDriver: merch?.ownerTrafficDriver ?? false,
    };
  });

  const basis: string[] = [];
  if (!i.inventoryTracked) basis.push("inventory not counted (cover/value limited)");
  if ((i.coveragePct ?? 0) < 60) basis.push(`product-line coverage ${Math.round(i.coveragePct ?? 0)}%`);
  if (i.merch.size === 0) basis.push("no merchandising/packaging fields recorded yet");
  if (i.isStale) basis.push(`books ${i.staleDays ?? "?"} days stale`);

  return {
    period: i.period, comparePeriod: i.comparePeriod, products,
    totalRevenue: Math.round(i.totalRevenue), totalGrossProfit: i.totalGrossProfit != null ? Math.round(i.totalGrossProfit) : null,
    coveragePct: i.coveragePct, inventoryTracked: i.inventoryTracked, stockCountAgeDays: i.stockCountAgeDays,
    cashCountFresh: i.cashCountFresh, marginFloorPct: i.marginFloorPct, maxCoverDays: i.maxCoverDays,
    deadStockDays: i.deadStockDays, strategicProducts: i.strategicProducts, cashForPurchases: i.cashForPurchases,
    nextChequeEta: i.nextChequeEta, season: i.season,
    offeredPackaging: i.offeredPackaging, allowedPromotions: i.allowedPromotions, allowedDisplayChanges: i.allowedDisplayChanges,
    customerOccasions: i.customerOccasions, operationalConstraints: i.operationalConstraints, commonlyBoughtTogether: i.commonlyBoughtTogether,
    isStale: i.isStale, staleDays: i.staleDays,
    basisNote: basis.length ? basis.join("; ") : "full coverage",
  };
}

/** Read the optional structured merchandising fields keyed by product name. */
async function loadMerch(): Promise<Map<string, MerchFields>> {
  const { data, error } = await requireEngine().from("products")
    .select("id,name_en,packaging_format,pack_size_g,packaging_cost,display_zone,shelf_level,facings,tier,impulse_type,min_order_qty,supplier_lead_days,quantity_breaks,do_not_discontinue,is_traffic_driver");
  if (error) return new Map();
  const m = new Map<string, MerchFields>();
  for (const p of data ?? []) {
    m.set(p.name_en, {
      category: null,
      packagingFormat: p.packaging_format, packSizeG: p.pack_size_g, packagingCost: p.packaging_cost,
      displayZone: p.display_zone, shelfLevel: p.shelf_level, facings: p.facings,
      tier: (p.tier as MerchFields["tier"]) ?? null, impulseType: (p.impulse_type as MerchFields["impulseType"]) ?? null,
      minOrderQty: p.min_order_qty, supplierLeadDays: p.supplier_lead_days,
      quantityBreaks: (p.quantity_breaks as MerchFields["quantityBreaks"]) ?? null,
      doNotDiscontinue: p.do_not_discontinue ?? false, ownerTrafficDriver: p.is_traffic_driver ?? false,
    });
  }
  return m;
}

/** Assemble the facts from the audited snapshot + report + merchandising fields
 *  + the owner-interview context (packaging offered, allowed promotions, etc.). */
export async function assembleRetailFacts(s: StrategistSnapshot, report: StrategyReport): Promise<RetailBusinessFacts> {
  const [merch, ctx, packaging] = await Promise.all([loadMerch(), loadRetailContext().catch(() => EMPTY_CONTEXT), listPackagingFormats().catch(() => [])]);
  const offeredPackaging = packaging.map((f) => {
    const total = [f.packageCost, f.prepCost, f.labelSealCost].reduce<number | null>((s2, c) => (c == null ? s2 : (s2 ?? 0) + c), null);
    return { type: f.packagingType ?? "custom", name: f.name, hasCost: total != null, totalUnitCost: total, giftingSuitable: f.giftingSuitable, impulseSuitable: f.impulseSuitable, premiumScore: f.premiumScore };
  });
  const lastCount = s.inventory.lastPhysicalCount.value;
  const stockAge = lastCount ? Math.round((Date.parse(s.meta.today) - Date.parse(lastCount)) / 86_400_000) : null;
  return composeRetailFacts({
    period: s.meta.period.label,
    comparePeriod: s.meta.comparePeriod.label,
    detail: s.products.detail.value ?? [],
    compareDetail: s.products.compareDetail.value ?? [],
    positions: s.products.positions.value ?? [],
    stockRisk: s.products.stockRisk.value ?? [],
    periodDays: s.products.periodDays.value ?? 30,
    merch,
    totalRevenue: s.revenue.periodRevenue.value ?? 0,
    totalGrossProfit: s.profit.grossProfit.value,
    coveragePct: s.products.coveragePct.value,
    inventoryTracked: s.inventory.hasLiveData,
    stockCountAgeDays: stockAge,
    cashCountFresh: report.liveHealth.cashConfidence === "high",
    marginFloorPct: s.context.grossMarginFloorPct.value,
    maxCoverDays: s.context.maxStockCoverDays.value,
    deadStockDays: s.context.deadStockDays.value,
    strategicProducts: s.context.strategicProducts.value ?? [],
    cashForPurchases: null,                              // unknown until the drawer is counted (honest pre-live)
    nextChequeEta: s.cheques.nextChequeEta.value,
    season: null,
    offeredPackaging,
    allowedPromotions: ctx.allowedPromotions,
    allowedDisplayChanges: ctx.allowedDisplayChanges,
    customerOccasions: ctx.customerOccasions,
    operationalConstraints: ctx.operationalConstraints,
    commonlyBoughtTogether: ctx.commonlyBoughtTogether,
    isStale: s.meta.isStale,
    staleDays: s.meta.staleDays,
  });
}
