/** Dashboard layout — which Today widgets show and in what order. Pure helpers
 *  so the customization logic is unit-tested; the store persists it per-browser.
 *  normalizeLayout keeps saved layouts forward-compatible as widgets change. */
export type WidgetId = "kpis" | "trend" | "spend" | "attention" | "risks" | "activity" | "health";

export interface LayoutItem { id: WidgetId; on: boolean }

export const WIDGET_TITLES: Record<WidgetId, string> = {
  kpis: "Key numbers",
  trend: "Today + sales trend",
  spend: "Where money goes",
  attention: "Needs attention",
  risks: "Risks & signals",
  activity: "Recent activity",
  health: "Business health",
};

export const ALL_WIDGETS: WidgetId[] = ["kpis", "trend", "spend", "attention", "activity", "health", "risks"];

export const DEFAULT_LAYOUT: LayoutItem[] = ALL_WIDGETS.map((id) => ({ id, on: true }));

export function toggleWidget(layout: LayoutItem[], id: WidgetId): LayoutItem[] {
  return layout.map((x) => (x.id === id ? { ...x, on: !x.on } : x));
}

/** Move `fromId` to the position of `toId` (drag-and-drop reorder). */
export function reorderWidget(layout: LayoutItem[], fromId: WidgetId, toId: WidgetId): LayoutItem[] {
  const from = layout.findIndex((x) => x.id === fromId);
  const to = layout.findIndex((x) => x.id === toId);
  if (from < 0 || to < 0 || from === to) return layout;
  const next = layout.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Merge a saved layout with the current widget set: keep saved order/visibility,
 *  append new widgets (on by default), drop ones that no longer exist. */
export function normalizeLayout(saved: unknown): LayoutItem[] {
  if (!Array.isArray(saved)) return DEFAULT_LAYOUT.slice();
  const known = new Set(ALL_WIDGETS);
  const seen = new Set<WidgetId>();
  const out: LayoutItem[] = [];
  for (const item of saved) {
    const id = (item as LayoutItem)?.id;
    if (known.has(id) && !seen.has(id)) { out.push({ id, on: (item as LayoutItem).on !== false }); seen.add(id); }
  }
  for (const id of ALL_WIDGETS) if (!seen.has(id)) out.push({ id, on: true });
  return out;
}
