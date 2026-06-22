/** App-wide preferences — the owner customizes how BostaOS opens and what it
 *  shows. Persisted per-browser. Pure defaults + normalize for forward-compat. */
import { create } from "zustand";
import type { RangeKey } from "@/core/range";

export interface Prefs {
  landing: string;            // route to open on launch
  defaultRange: RangeKey;     // global period applied on launch
  hiddenSections: string[];   // nav section ids hidden from the rail/mobile nav
}

export const DEFAULT_PREFS: Prefs = { landing: "/dashboard", defaultRange: "month", hiddenSections: [] };

const KEY = "bostaos.prefs.v1";
function load(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!p || typeof p !== "object") return { ...DEFAULT_PREFS };
    return {
      landing: typeof p.landing === "string" ? p.landing : DEFAULT_PREFS.landing,
      defaultRange: p.defaultRange ?? DEFAULT_PREFS.defaultRange,
      hiddenSections: Array.isArray(p.hiddenSections) ? p.hiddenSections : [],
    };
  } catch { return { ...DEFAULT_PREFS }; }
}
function save(p: Prefs) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } }

interface PrefsState extends Prefs {
  set: (patch: Partial<Prefs>) => void;
  toggleSection: (id: string) => void;
  reset: () => void;
}

export const usePrefs = create<PrefsState>((set) => ({
  ...load(),
  set: (patch) => set((s) => { const next = { ...s, ...patch }; save(next); return next; }),
  toggleSection: (id) => set((s) => {
    const hiddenSections = s.hiddenSections.includes(id) ? s.hiddenSections.filter((x) => x !== id) : [...s.hiddenSections, id];
    const next = { ...s, hiddenSections }; save(next); return next;
  }),
  reset: () => { save(DEFAULT_PREFS); set({ ...DEFAULT_PREFS }); },
}));
