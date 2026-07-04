/**
 * PRODUCT MATCHING / SEARCH (pure)
 * --------------------------------
 * Ranks products against a free-text query across English name, Arabic POS name,
 * and aliases (barcodes / alternate POS spellings). Arabic is normalized
 * (diacritics, tatweel, alef/ya/ta-marbuta variants) so "كاجو" matches "كاجو
 * محمص" and POS spelling drift still resolves. Deterministic + unit-tested; used
 * by the sale-line product picker and the product-line importer's auto-match.
 */
export interface SearchableProduct {
  id: string;
  nameEn: string;
  nameAr: string | null;
  aliases: string[];
  marketCode?: string | null; // owner-facing 4-digit code (shown in pickers/lists)
}

/** Lowercase, collapse whitespace, and fold common Arabic variants. */
export function normalize(s: string): string {
  return (s ?? "")
    .toString()
    .replace(/[ً-ٰٟـ]/g, "") // diacritics + tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

interface IndexEntry { p: SearchableProduct; terms: string[] }
export function buildIndex(products: SearchableProduct[]): IndexEntry[] {
  return products.map((p) => ({
    p,
    terms: [p.nameEn, p.nameAr ?? "", ...p.aliases].filter(Boolean).map(normalize),
  }));
}

/** Score a single product against a normalized query. Higher = better; 0 = no match. */
function scoreEntry(e: IndexEntry, q: string): number {
  let best = 0;
  for (const t of e.terms) {
    if (!t) continue;
    if (t === q) best = Math.max(best, 100);
    else if (t.startsWith(q)) best = Math.max(best, 70);
    else if (t.includes(q)) best = Math.max(best, 45);
    // token-level startsWith (e.g. query matches a later word)
    else if (t.split(" ").some((w) => w.startsWith(q))) best = Math.max(best, 35);
  }
  return best;
}

export function searchProducts(query: string, index: IndexEntry[], limit = 8): SearchableProduct[] {
  const q = normalize(query);
  if (!q) return index.slice(0, limit).map((e) => e.p);
  const scored = index
    .map((e) => ({ p: e.p, s: scoreEntry(e, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.p.nameEn.localeCompare(b.p.nameEn));
  return scored.slice(0, limit).map((x) => x.p);
}

/** Auto-match a raw imported product name to exactly one product, or null when
 *  ambiguous / no confident match (caller queues it as "unmapped"). */
export function autoMatch(rawName: string, index: IndexEntry[]): SearchableProduct | null {
  const q = normalize(rawName);
  if (!q) return null;
  const exact = index.filter((e) => e.terms.includes(q));
  if (exact.length === 1) return exact[0].p;
  if (exact.length > 1) return null; // ambiguous
  const hits = searchProducts(rawName, index, 2);
  // accept a single strong (startsWith/contains) hit only
  if (hits.length === 1) return hits[0];
  return null;
}
