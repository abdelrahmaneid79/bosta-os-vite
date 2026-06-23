/** Command palette (⌘K / Ctrl-K) — the connective tissue that makes BostaOS feel
 *  like one system. Jump to any section, run a quick action, or open any product
 *  by name from anywhere. Keyboard-first. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useUI } from "@/store/ui";
import { isEngineConfigured } from "@/core/db/engine";
import { getProducts } from "@/core/read/common";
import { ALL_SECTIONS } from "@/core/nav";

interface Cmd { id: string; label: string; hint: string; group: string; run: () => void }

export function CommandPalette() {
  const { commandOpen, setCommandOpen } = useUI();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const products = useQuery({ queryKey: ["products-list"], queryFn: getProducts, enabled: isEngineConfigured && commandOpen });

  // global ⌘K / Ctrl-K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCommandOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommandOpen]);

  useEffect(() => { if (commandOpen) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [commandOpen]);

  const go = (to: string) => { setCommandOpen(false); navigate(to); };

  const all: Cmd[] = useMemo(() => {
    const nav: Cmd[] = ALL_SECTIONS.flatMap((s) => s.tabs.map((t) => ({
      id: `nav:${t.to}`, label: `${s.label} · ${t.label}`, hint: "Go to", group: "Navigate", run: () => go(t.to),
    })));
    const actions: Cmd[] = [
      { id: "a:sale", label: "New sale day", hint: "Action", group: "Create", run: () => go("/sales") },
      { id: "a:product", label: "Add product", hint: "Action", group: "Create", run: () => go("/stock") },
      { id: "a:purchase", label: "Add purchase", hint: "Action", group: "Create", run: () => go("/purchases") },
      { id: "a:expense", label: "Add expense", hint: "Action", group: "Create", run: () => go("/expenses") },
      { id: "a:cash", label: "Count cash", hint: "Action", group: "Create", run: () => go("/money") },
      { id: "a:import", label: "Import receipt / sheet", hint: "Action", group: "Create", run: () => go("/sales/import") },
      { id: "a:history", label: "Load my Bosta Bites history", hint: "Action", group: "Create", run: () => go("/settings/history") },
    ];
    const prods: Cmd[] = (products.data ?? []).filter((p) => p.active).map((p) => ({
      id: `p:${p.id}`, label: p.name_en + (p.name_ar ? ` · ${p.name_ar}` : ""), hint: "Product", group: "Products", run: () => go(`/product/${p.id}`),
    }));
    return [...actions, ...nav, ...prods];
  }, [products.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const term = q.trim().toLowerCase();
  const results = (term ? all.filter((c) => c.label.toLowerCase().includes(term)) : all).slice(0, 40);
  useEffect(() => { setSel(0); }, [term]);

  if (!commandOpen) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); results[sel]?.run(); }
    else if (e.key === "Escape") { setCommandOpen(false); }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center bg-black/70 p-4 pt-[12vh]" onClick={() => setCommandOpen(false)}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-panel2 shadow-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-dim" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Search sections, actions, products…" className="flex-1 bg-transparent py-3.5 text-sm text-text placeholder:text-faint focus:outline-none" />
          <kbd className="rounded bg-panel2 px-1.5 py-0.5 font-mono text-[10px] text-dim">esc</kbd>
        </div>
        <div className="max-h-[55vh] overflow-y-auto py-1">
          {results.length === 0 ? <div className="px-4 py-6 text-center text-sm text-dim">No matches.</div> : results.map((c, i) => (
            <button key={c.id} onMouseEnter={() => setSel(i)} onClick={c.run}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${i === sel ? "bg-pink/15" : ""}`}>
              <span className="flex-1 truncate text-sm text-text">{c.label}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-faint">{c.group}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
