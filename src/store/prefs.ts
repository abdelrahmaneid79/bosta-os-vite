/** App-wide preferences — the owner customizes how BostaOS opens and what it
 *  shows. Persisted per-browser. Pure defaults + normalize for forward-compat. */
import { create } from "zustand";
import { useEffect } from "react";
import type { RangeKey } from "@/core/range";

export type ThemeMode = "light" | "dark" | "system";

export interface Prefs {
  landing: string;            // route to open on launch
  defaultRange: RangeKey;     // global period applied on launch
  hiddenSections: string[];   // nav section ids hidden from the rail/mobile nav
  accountingStart: string;    // bookkeeping start; before it, profit is revenue-only
  theme: ThemeMode;           // light (default) / dark / follow system
}

export const DEFAULT_PREFS: Prefs = { landing: "/dashboard", defaultRange: "all", hiddenSections: [], accountingStart: "2026-07-01", theme: "dark" };

const KEY = "bostaos.prefs.v1";
function load(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!p || typeof p !== "object") return { ...DEFAULT_PREFS };
    return {
      landing: typeof p.landing === "string" ? p.landing : DEFAULT_PREFS.landing,
      defaultRange: p.defaultRange ?? DEFAULT_PREFS.defaultRange,
      hiddenSections: Array.isArray(p.hiddenSections) ? p.hiddenSections : [],
      accountingStart: typeof p.accountingStart === "string" ? p.accountingStart : DEFAULT_PREFS.accountingStart,
      theme: p.theme === "dark" || p.theme === "system" || p.theme === "light" ? p.theme : DEFAULT_PREFS.theme,
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

/** Resolve "system" against the OS preference. */
function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return mode;
}

/** Apply the chosen theme to <html> and keep it in sync with OS changes when
 *  the owner picks "system". Mount once near the app root. */
export function useApplyTheme(): void {
  const theme = usePrefs((s) => s.theme);
  useEffect(() => {
    const apply = () => document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
    apply();
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}
