/** Navigation metadata — the single source of truth for sections, their tabs,
 *  routes and icons. EngineApp attaches the screen components by route; the
 *  Preferences screen uses it for landing-page and visible-section options. Pure
 *  data, no components, so both can import it without cycles. */
export interface NavTab { to: string; label: string }
export interface NavSection { id: string; label: string; icon: string; accent: string; tabs: NavTab[] }

export const NAV_SECTIONS: NavSection[] = [
  { id: "today", label: "Today", icon: "M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5", accent: "#F868C8", tabs: [
    { to: "/dashboard", label: "Today" },
  ] },
  { id: "sales", label: "Sales", icon: "M3 3v18h18M7 14l3-3 3 3 5-6", accent: "#2BD4C4", tabs: [
    { to: "/sales", label: "Sales days" },
    { to: "/sales/product-lines", label: "Product lines" },
    { to: "/sales/import", label: "Import & receipts" },
  ] },
  { id: "inventory", label: "Inventory", icon: "M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10", accent: "#5C8DFF", tabs: [
    { to: "/stock", label: "Stock" },
    { to: "/purchases", label: "Purchases" },
  ] },
  { id: "money", label: "Money", icon: "M3 7h18v11H3zM3 11h18M7 15h3", accent: "#F7A23B", tabs: [
    { to: "/money", label: "Cash" },
    { to: "/expenses", label: "Expenses" },
    { to: "/cheques", label: "Cheques" },
  ] },
  { id: "reports", label: "Reports", icon: "M6 2h9l5 5v15H4V2zM9 13h6M9 17h6", accent: "#9B6CFF", tabs: [
    { to: "/reports", label: "Overview" },
    { to: "/reconcile", label: "Profit" },
    { to: "/reports/tables", label: "Tables & export" },
  ] },
  { id: "insights", label: "Insights", icon: "M22 12h-4l-3 8L9 4l-3 8H2", accent: "#54D69A", tabs: [
    { to: "/health", label: "Health" },
    { to: "/missing", label: "Gaps" },
    { to: "/activity", label: "Activity" },
  ] },
];

export const SETTINGS_SECTION: NavSection = {
  id: "settings", label: "Settings", accent: "#A87C95",
  icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a8 8 0 0 0 .1-3l1.6-1.2-2-3.4-1.8.7a8 8 0 0 0-2.6-1.5L14 1h-4l-.3 1.9a8 8 0 0 0-2.6 1.5l-1.8-.7-2 3.4L4.7 12a8 8 0 0 0 0 3l-1.6 1.2 2 3.4 1.8-.7a8 8 0 0 0 2.6 1.5L10 23h4l.3-1.9a8 8 0 0 0 2.6-1.5l1.8.7 2-3.4z",
  tabs: [
    { to: "/settings", label: "General" },
    { to: "/settings/prefs", label: "Preferences" },
    { to: "/settings/history", label: "Load history" },
    { to: "/system", label: "System" },
    { to: "/qa", label: "QA Mode" },
  ],
};

export const ALL_SECTIONS = [...NAV_SECTIONS, SETTINGS_SECTION];
/** Options for the "default landing page" preference. */
export const LANDING_OPTIONS = ALL_SECTIONS.flatMap((s) => s.tabs.map((t) => ({ value: t.to, label: `${s.label} · ${t.label}` })));
/** Sections the owner may hide from navigation (Today and Settings always stay). */
export const HIDEABLE_SECTIONS = NAV_SECTIONS.filter((s) => s.id !== "today");
