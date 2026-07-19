/** Navigation metadata — the single source of truth for sections, their tabs,
 *  routes and icons. EngineApp attaches the screen components by route; the
 *  Preferences screen uses it for landing-page and visible-section options. Pure
 *  data, no components, so both can import it without cycles. */
export interface NavTab { to: string; label: string }
export interface NavSection { id: string; label: string; icon: string; accent: string; tabs: NavTab[] }

export const NAV_SECTIONS: NavSection[] = [
  { id: "today", label: "Today", icon: "M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5", accent: "#ff4dbb", tabs: [
    { to: "/dashboard", label: "Today" },
  ] },
  { id: "sales", label: "Sales", icon: "M3 3v18h18M7 14l3-3 3 3 5-6", accent: "#2BD4C4", tabs: [
    { to: "/sales", label: "Sales days" },
    { to: "/sales/product-lines", label: "Import" },
  ] },
  { id: "inventory", label: "Inventory", icon: "M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10", accent: "#5C8DFF", tabs: [
    { to: "/stock", label: "Stock" },
    { to: "/purchases", label: "Purchases" },
    { to: "/costs", label: "Product costs" },
  ] },
  { id: "money", label: "Money", icon: "M3 7h18v11H3zM3 11h18M7 15h3", accent: "#F7A23B", tabs: [
    { to: "/money", label: "Cash" },
    { to: "/expenses", label: "Expenses" },
    { to: "/cheques", label: "Cheques" },
    { to: "/bank", label: "Bank card" },
  ] },
  { id: "insights", label: "Insights", icon: "M22 12h-4l-3 8L9 4l-3 8H2", accent: "#54D69A", tabs: [
    { to: "/health", label: "Strategist" },
    { to: "/performance", label: "Performance" },
  ] },
];

export const SETTINGS_SECTION: NavSection = {
  id: "settings", label: "Settings", accent: "#9d6bff",
  icon: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.128.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.004.827c-.292.24-.437.613-.43.992a6.7 6.7 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.955.26 1.43l-1.297 2.247a1.125 1.125 0 0 1-1.37.491l-1.216-.456c-.356-.133-.751-.072-1.076.124a6.5 6.5 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.28c-.062-.375-.312-.687-.644-.87a6.5 6.5 0 0 1-.22-.128c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a7 7 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  tabs: [
    { to: "/settings", label: "General" },
    { to: "/settings/prefs", label: "Preferences" },
    { to: "/settings/opening", label: "Opening balances" },
    { to: "/settings/history", label: "Load history" },
    { to: "/system", label: "System" },
    { to: "/qa", label: "QA checklist" },
  ],
};

export const ALL_SECTIONS = [...NAV_SECTIONS, SETTINGS_SECTION];
/** Options for the "default landing page" preference. */
export const LANDING_OPTIONS = ALL_SECTIONS.flatMap((s) => s.tabs.map((t) => ({ value: t.to, label: `${s.label} · ${t.label}` })));
/** Sections the owner may hide from navigation (Today and Settings always stay). */
export const HIDEABLE_SECTIONS = NAV_SECTIONS.filter((s) => s.id !== "today");
