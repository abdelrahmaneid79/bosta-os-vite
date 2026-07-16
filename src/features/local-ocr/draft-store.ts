/**
 * Device-local persistence for the day-sales importer (IndexedDB, no server):
 *  - the in-progress review DRAFT, so closing the tab mid-review never loses it;
 *  - the set of already-imported image HASHES, to catch re-importing the exact
 *    same photo (a second line of defence beyond the date+total duplicate check).
 * All calls fail soft.
 */
import { idbGet, idbSet, idbDel } from "@/core/db/idb";
import type { RawDayLine } from "@/core/import/day-sales";

const DRAFT_KEY = "day-sales-import";

export interface DraftLineMeta { conf: number; warnings: string[] }
export interface DayImportDraft {
  lines: RawDayLine[];
  meta: DraftLineMeta[];
  branchTotal: number | null;
  dayDate: string;
  assign: Record<number, string>;
  imageBlob?: Blob;
  savedAt: number;
}

export const saveDraft = (d: DayImportDraft): Promise<unknown> => idbSet("drafts", DRAFT_KEY, d);
export const loadDraft = (): Promise<DayImportDraft | null> => idbGet<DayImportDraft>("drafts", DRAFT_KEY);
export const clearDraft = (): Promise<unknown> => idbDel("drafts", DRAFT_KEY);

/** SHA-256 hex of an image's bytes — its content fingerprint. */
export async function hashImage(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ImportedMark { date: string; at: number }
export const markImageImported = (hash: string, mark: ImportedMark): Promise<unknown> => idbSet("imageHashes", hash, mark);
export const findImportedImage = (hash: string): Promise<ImportedMark | null> => idbGet<ImportedMark>("imageHashes", hash);
