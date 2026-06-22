/** Shared read helpers. All queries are READ-ONLY (select only). */
import { requireEngine } from "@/core/db/engine";
import type { Tables } from "@/core/db/tables";

export interface DateRange {
  from: string;
  to: string;
}

/** Active + inactive products, by English name. */
export async function getProducts(): Promise<Tables<"products">[]> {
  const { data, error } = await requireEngine()
    .from("products")
    .select("*")
    .order("name_en");
  if (error) throw error;
  return data;
}

export function productMap(products: Tables<"products">[]): Map<string, Tables<"products">> {
  return new Map(products.map((p) => [p.id, p]));
}

/** Display unit + factor: stock is stored in base units; owners think in sale units. */
export function displayQty(p: Pick<Tables<"products">, "current_stock">): number {
  return p.current_stock;
}

/** Active business locations (the stall). Needed when posting purchases/sales. */
export async function getLocations(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await requireEngine()
    .from("locations").select("id,name").eq("active", true).order("name");
  if (error) throw error;
  return data;
}

/** Active sales channels (counter, delivery, …). Needed for the sale header. */
export async function getChannels(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await requireEngine()
    .from("channels").select("id,name").eq("active", true).order("name");
  if (error) throw error;
  return data;
}
