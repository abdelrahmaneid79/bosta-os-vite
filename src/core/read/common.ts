/** Shared read helpers. All queries are READ-ONLY (select only). */
import { requireEngine } from "@/core/db/engine";
import type { Tables } from "@/core/db/tables";

export interface DateRange {
  from: string;
  to: string;
}

/** PostgREST silently caps un-paginated selects at 1000 rows. Every read that
 *  can exceed that (sale_items, sales, movements over long ranges) must page
 *  through .range() until a short page. `build` receives the query to page. */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += pageSize) {
    const { data, error } = await build(off, off + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    out.push(...page);
    if (page.length < pageSize) return out;
  }
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
