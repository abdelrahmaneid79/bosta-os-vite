import { describe, it, expect } from "vitest";
import { normalize, buildIndex, searchProducts, autoMatch, type SearchableProduct } from "@/core/products/match";

const prods: SearchableProduct[] = [
  { id: "1", nameEn: "Roasted cashew", nameAr: "كاجو محمص", aliases: ["2301626000008", "كاجو"] },
  { id: "2", nameEn: "American pistachio", nameAr: "فستق امريكى", aliases: ["2301623000001"] },
  { id: "3", nameEn: "Roasted almonds", nameAr: "لوز محمص", aliases: [] },
];
const index = buildIndex(prods);

describe("normalize", () => {
  it("folds arabic alef/ya/ta variants, diacritics, tatweel, case + spaces", () => {
    expect(normalize("  أحمد ")).toBe("احمد");
    expect(normalize("امريكى")).toBe(normalize("امريكي"));
    expect(normalize("محمَّـص")).toBe("محمص");
    expect(normalize("Roasted   CASHEW")).toBe("roasted cashew");
  });
});

describe("searchProducts", () => {
  it("matches by english name", () => {
    expect(searchProducts("cashew", index).map((p) => p.id)).toContain("1");
  });
  it("matches by arabic POS name (normalized)", () => {
    expect(searchProducts("امريكي", index)[0].id).toBe("2"); // ى vs ي
  });
  it("matches by alias / barcode", () => {
    expect(searchProducts("2301626000008", index)[0].id).toBe("1");
  });
  it("ranks exact over partial", () => {
    const r = searchProducts("كاجو", index);
    expect(r[0].id).toBe("1");
  });
  it("empty query returns the list (capped)", () => {
    expect(searchProducts("", index, 2)).toHaveLength(2);
  });
  it("no match returns empty", () => {
    expect(searchProducts("zzzzz", index)).toEqual([]);
  });
});

describe("autoMatch", () => {
  it("resolves a confident single match", () => {
    expect(autoMatch("كاجو محمص", index)?.id).toBe("1");
  });
  it("returns null when nothing matches (queue as unmapped)", () => {
    expect(autoMatch("chocolate bar", index)).toBeNull();
  });
});
