/** Import-center reads (light). READ-ONLY. */
import { requireEngine } from "@/core/db/engine";

/** Imports staged and previewed but not yet approved — they are not counted in
 *  any figure until the owner approves them. */
export async function getPreviewedImportCount(): Promise<number> {
  const { count, error } = await requireEngine()
    .from("imports").select("id", { count: "exact", head: true })
    .is("voided_at", null).eq("status", "previewed");
  if (error) throw error;
  return count ?? 0;
}
