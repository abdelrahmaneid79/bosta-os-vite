/** Searchable product picker — typeahead over English + Arabic POS names and
 *  aliases/barcodes (pure matcher in core/products/match.ts). Used by the sale
 *  line form for fast entry. Keyboard + click; shows on-hand so the owner can
 *  see stock while picking. */
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/core/utils/cn";
import { getSearchableProducts } from "@/core/read/products";
import { buildIndex, searchProducts } from "@/core/products/match";

export function ProductPicker({ value, onChange, autoFocus }: { value: string; onChange: (id: string) => void; autoFocus?: boolean }) {
  const q = useQuery({ queryKey: ["searchable-products"], queryFn: getSearchableProducts });
  const products = q.data ?? [];
  const index = useMemo(() => buildIndex(products), [products]);
  const selected = products.find((p) => p.id === value) ?? null;
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const results = useMemo(() => searchProducts(term, index, 8), [term, index]);
  const label = (p: { nameEn: string; nameAr: string | null }) => p.nameEn + (p.nameAr ? ` · ${p.nameAr}` : "");

  const pick = (id: string) => { onChange(id); setOpen(false); setTerm(""); };

  return (
    <div ref={ref} className="relative">
      <input
        autoFocus={autoFocus}
        value={open ? term : selected ? label(selected) : term}
        placeholder={q.isLoading ? "Loading products…" : "Search product, Arabic name, or barcode…"}
        onFocus={() => { setOpen(true); setTerm(""); }}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        dir="auto"
        className="w-full rounded-2xl border border-line bg-panel2 px-3.5 py-2.5 text-sm text-text outline-none transition placeholder:text-faint focus:border-pink/60 focus:ring-2 focus:ring-pink/15"
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-2xl border border-line bg-panel shadow-pop">
          {results.length === 0 ? (
            <div className="px-3.5 py-3 text-sm text-dim">No match. Add the product in Goods first.</div>
          ) : results.map((p) => (
            <button key={p.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(p.id); }}
              className={cn("flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm hover:bg-panel2", p.id === value && "bg-pink/10")}>
              <span dir="auto" className="min-w-0 flex-1 truncate text-text">{label(p)}</span>
              {p.aliases[0] && <span className="tnum text-[11px] text-faint">{p.aliases[0]}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
