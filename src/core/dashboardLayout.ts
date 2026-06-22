/** Dashboard layout — which Today widgets show and in what order. Pure helpers
 *  so the customization logic is unit-tested; the store persists it per-browser.
 *  normalizeLayout keeps saved layouts forward-compatible as widgets are added
 *  or removed. */
export type WidgetId = "ask" | "today" | "kpis" | "attention" | "risks" | "activity" | "health" | "quick";

export interface LayoutItem { id: WidgetId; on: boolean }

export const WIDGET_TITLES: Record<WidgetId, string> = {
  ask: "Ask Bosta",
  today: "Today + 14-day trend",
  kpis: "Key numbers",
  attention: "Needs attention",
  risks: "Risks & signals",
  activity: "Recent activity",
  health: "Business health",
  quick: "Quick actions",
};

export const ALL_WIDGETS: WidgetId[] = ["ask", "today", "kpis", "attention", "risks", "activity", "health", "quick"];

export const DEFAULT_LAYOUT: LayoutItem[] = ALL_WIDGETS.map((id) => ({ id, on: true }));

const dir = (d: "up" | "down") => (d === "up" ? -1 : 1);
export function moveWidget(layout: LayoutItem[], id: WidgetId, d: "up" | "down"): LayoutItem[] {
  const i = layout.findIndex((x) => x.id === id);
  const j = i + dir(d);
  if (i < 0 || j < 0 || j >= layout.length) return layout;
  const next = layout.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
export function toggleWidget(layout: LayoutItem[], id: WidgetId): LayoutItem[] {
  return layout.map((x) => (x.id === id ? { ...x, on: !x.on } : x));
}

/** Merge a saved layout with the current widget set: keep saved order/visibility,
 *  append any new widgets (on by default), drop any that no longer exist. */
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
