/** Dashboard layout store — persisted per-browser in localStorage so the owner's
 *  Today arrangement sticks. Pure layout math lives in core/dashboardLayout. */
import { create } from "zustand";
import { DEFAULT_LAYOUT, normalizeLayout, moveWidget, toggleWidget, type LayoutItem, type WidgetId } from "@/core/dashboardLayout";

const KEY = "bostaos.dashboard.v1";
function load(): LayoutItem[] {
  try { return normalizeLayout(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { return DEFAULT_LAYOUT.slice(); }
}
function save(layout: LayoutItem[]) {
  try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch { /* ignore */ }
}

interface LayoutState {
  layout: LayoutItem[];
  move: (id: WidgetId, d: "up" | "down") => void;
  toggle: (id: WidgetId) => void;
  reset: () => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  layout: load(),
  move: (id, d) => set((s) => { const layout = moveWidget(s.layout, id, d); save(layout); return { layout }; }),
  toggle: (id) => set((s) => { const layout = toggleWidget(s.layout, id); save(layout); return { layout }; }),
  reset: () => { save(DEFAULT_LAYOUT.slice()); set({ layout: DEFAULT_LAYOUT.slice() }); },
}));
