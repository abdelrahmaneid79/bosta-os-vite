/**
 * BostaOS shell — Bosta Bites brand: jet background with pink glow, the peanut
 * mascot mark, and a slim rail of consolidated sections. Each section groups
 * related screens behind sub-tabs (Sales = days + receipts, Inventory = stock +
 * purchases, Money = cash + spend + cheques, Reports = summary + profit,
 * Insights = health + gaps + activity, Settings = general + system + QA).
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/core/utils/cn";
import { fmtDate } from "@/core/utils/date";
import { monthBoundsCairo } from "@/core/time";
import { AuthProvider, AuthGate } from "@/features/auth/auth";
import { Toaster, SkeletonRows } from "@/components/feedback";
import { ProductForm, PurchaseForm, SaleForm, ExpenseForm, CashForm } from "@/features/engine/forms";
import { CommandPalette } from "@/features/engine/CommandPalette";
import { useUI } from "@/store/ui";
import { NAV_SECTIONS, SETTINGS_SECTION } from "@/core/nav";
import { usePrefs, useApplyTheme, type ThemeMode } from "@/store/prefs";
import { useFilters } from "@/store/filters";
import { isEngineConfigured } from "@/core/db/engine";
import { getAlerts, getDismissedAlertKeys } from "@/core/read/alerts";
import { dismissAlert, restoreAllAlerts, pruneAlertDismissals } from "@/core/db/mutations";
import { partitionAlerts, bellCount, type Alert, type AlertSeverity } from "@/core/alerts/engine";

// Lazy route chunks — split out of the initial bundle.
const screens = () => import("@/features/engine/screens");
const dash = () => import("@/features/engine/dashboard");
const money = () => import("@/features/engine/money");
const more = () => import("@/features/engine/more");
const product = () => import("@/features/engine/product");
const receipts = () => import("@/features/engine/receipts");
const analytics = () => import("@/features/engine/analytics");
const qa = () => import("@/features/qa/QAScreen");
const L = <M, K extends keyof M>(load: () => Promise<M>, key: K) =>
  lazy(() => load().then((m) => ({ default: m[key] as unknown as React.ComponentType })));

const StockScreen = L(screens, "StockScreen");
const SalesScreen = L(screens, "SalesScreen");
const PurchasesScreen = L(screens, "PurchasesScreen");
const ReconcileScreen = L(screens, "ReconcileScreen");
const DashboardScreen = L(dash, "DashboardScreen");
const HealthScreen = L(dash, "HealthScreen");
const MissingScreen = L(dash, "MissingScreen");
const ActivityScreen = L(dash, "ActivityScreen");
const MoneyScreen = L(money, "MoneyScreen");
const ChequesScreen = L(money, "ChequesScreen");
const ExpensesScreen = L(money, "ExpensesScreen");
const ReportsScreen = L(more, "ReportsScreen");
const SystemCheckScreen = L(more, "SystemCheckScreen");
const SettingsScreen = L(more, "SettingsScreen");
const ReceiptsScreen = lazy(() => receipts().then((m) => ({ default: m.ReceiptsScreen })));
const HistoryImportScreen = lazy(() => import("@/features/engine/history-import").then((m) => ({ default: m.HistoryImportScreen })));
const AnalyticsScreen = L(analytics, "AnalyticsScreen");
const QAScreen = L(qa, "QAScreen");
const PreferencesScreen = L(more, "PreferencesScreen");
const ProductDetailScreen = L(product, "ProductDetailScreen");
const SettlementDetailScreen = L(money, "SettlementDetailScreen");

const I = {
  today: "M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5",
  sales: "M3 3v18h18M7 14l3-3 3 3 5-6",
  inventory: "M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10",
  money: "M3 7h18v11H3zM3 11h18M7 15h3",
  reports: "M6 2h9l5 5v15H4V2zM9 13h6M9 17h6",
  insights: "M22 12h-4l-3 8L9 4l-3 8H2",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a8 8 0 0 0 .1-3l1.6-1.2-2-3.4-1.8.7a8 8 0 0 0-2.6-1.5L14 1h-4l-.3 1.9a8 8 0 0 0-2.6 1.5l-1.8-.7-2 3.4L4.7 12a8 8 0 0 0 0 3l-1.6 1.2 2 3.4 1.8-.7a8 8 0 0 0 2.6 1.5L10 23h4l.3-1.9a8 8 0 0 0 2.6-1.5l1.8.7 2-3.4z",
  plus: "M12 5v14M5 12h14",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
} as const;

function Icon({ d, className = "h-5 w-5", w = 1.9 }: { d: string; className?: string; w?: number }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" className={className}><path d={d} /></svg>;
}

interface Tab { to: string; label: string; el: React.ReactNode }
interface Group { id: string; label: string; icon: string; accent: string; tabs: Tab[] }

// Map each route to its screen; nav structure/labels/icons come from core/nav.
const EL: Record<string, React.ReactNode> = {
  "/dashboard": <DashboardScreen />,
  "/sales": <SalesScreen />, "/sales/import": <ReceiptsScreen fixedKind="sales" />,
  "/stock": <StockScreen />, "/purchases": <PurchasesScreen />,
  "/money": <MoneyScreen />, "/expenses": <ExpensesScreen />, "/cheques": <ChequesScreen />, "/expenses/import": <ReceiptsScreen fixedKind="expenses" />,
  "/reports": <AnalyticsScreen />, "/reconcile": <ReconcileScreen />, "/reports/tables": <ReportsScreen />,
  "/health": <HealthScreen />, "/missing": <MissingScreen />, "/activity": <ActivityScreen />,
  "/settings": <SettingsScreen />, "/settings/prefs": <PreferencesScreen />, "/settings/history": <HistoryImportScreen />, "/system": <SystemCheckScreen />, "/qa": <QAScreen />,
};
const build = (s: { id: string; label: string; icon: string; accent: string; tabs: { to: string; label: string }[] }): Group =>
  ({ id: s.id, label: s.label, icon: s.icon, accent: s.accent, tabs: s.tabs.map((t) => ({ ...t, el: EL[t.to] })) });
const GROUPS: Group[] = NAV_SECTIONS.map(build);
const SETTINGS: Group = build(SETTINGS_SECTION);
const ALL_GROUPS = [...GROUPS, SETTINGS];

function groupForPath(pathname: string): Group | undefined {
  return ALL_GROUPS.find((g) => g.tabs.some((t) => t.to === pathname || pathname.startsWith(t.to + "/")));
}

function SectionTabs({ group }: { group: Group }) {
  if (group.tabs.length < 2) return null;
  return (
    <div className="mb-5 inline-flex flex-wrap gap-1 rounded-full border border-line bg-panel p-1 shadow-card">
      {group.tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end
          className={({ isActive }) => cn("rounded-full px-4 py-2 text-[13px] font-semibold transition",
            isActive ? "bg-pink text-ink shadow-pink" : "text-muted hover:text-text")}>
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}

function Page({ group, children }: { group: Group; children: React.ReactNode }) {
  return <><SectionTabs group={group} />{children}</>;
}

function QuickSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [view, setView] = useState<null | "product" | "purchase" | "sale" | "expense" | "cashcount">(null);
  const navigate = useNavigate();
  if (!open) return null;
  const close = () => { setView(null); onClose(); };
  const titles = { product: "Add product", purchase: "Add purchase", sale: "New sale day", expense: "Add expense", cashcount: "Count cash" } as const;
  return (
    <div onClick={close} className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-md animate-sheetUp overflow-y-auto rounded-t-3xl border border-line bg-panel2 p-5 shadow-sheet sm:rounded-3xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-lg font-semibold">{view ? titles[view] : "Quick add"}</div>
          <button onClick={close} className="flex h-8 w-8 items-center justify-center rounded-lg bg-panel2 text-muted hover:text-text">✕</button>
        </div>
        {view === "product" ? <ProductForm onDone={close} />
          : view === "purchase" ? <PurchaseForm onDone={close} />
          : view === "sale" ? <SaleForm onDone={close} />
          : view === "expense" ? <ExpenseForm onDone={close} />
          : view === "cashcount" ? <CashForm mode="count" onDone={close} />
          : (
          <div className="space-y-2">
            {([["sale", "New sale"], ["purchase", "Add purchase"], ["product", "Add product"], ["expense", "Add expense"], ["cashcount", "Count cash"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} className="lift row-hover flex w-full items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left">
                <span className="font-display text-sm font-semibold text-text">{label}</span>
                <span className="ml-auto rounded-full bg-good/15 px-2 py-0.5 text-[10px] font-semibold text-good">enabled</span>
              </button>
            ))}
            <button onClick={() => { close(); navigate("/sales/import"); }} className="lift row-hover flex w-full items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left">
              <span className="font-display text-sm font-semibold text-text">Import receipt / screenshot</span>
              <span className="ml-auto rounded-full bg-pink/15 px-2 py-0.5 text-[10px] font-semibold text-pink">CSV · Excel · image</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Visible primary sections, honoring the owner's hidden-section preferences. */
function useVisibleGroups(): Group[] {
  const hidden = usePrefs((s) => s.hiddenSections);
  return GROUPS.filter((g) => !hidden.includes(g.id));
}

function Rail({ onAdd }: { onAdd: () => void }) {
  return (
    <aside className="no-scrollbar sticky top-0 hidden h-screen w-[244px] flex-shrink-0 flex-col overflow-y-auto border-r border-line bg-rail md:flex">
      <div className="px-4 pb-4 pt-5">
        <NavLink to="/dashboard" className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-pink shadow-pink"><img src="/mascot-96.png" alt="Bosta Bites" className="h-7 w-7 object-contain" /></div>
          <div>
            <div className="font-display text-[17px] font-extrabold leading-none tracking-tight">BostaOS</div>
            <div className="mt-1 text-[11px] font-medium text-dim">Bosta Bites</div>
          </div>
        </NavLink>
        <button onClick={onAdd} className="lift mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-pink py-2.5 font-display text-sm font-bold text-ink shadow-pink">
          <Icon d={I.plus} w={2.6} className="h-4 w-4" /> Quick add
        </button>
      </div>
      <nav className="flex-1 px-3 pb-2">{useVisibleGroups().map((g) => <RailGroup key={g.id} group={g} />)}</nav>
      <div className="mt-2 border-t border-line px-3 py-3"><RailGroup group={SETTINGS} /></div>
    </aside>
  );
}

function RailLink({ to, label, icon, accent, depth = 0 }: { to: string; label: string; icon?: string; accent: string; depth?: number }) {
  const { pathname } = useLocation();
  const here = pathname === to || pathname.startsWith(to + "/");
  return (
    <NavLink to={to} end
      className={cn("lift relative mb-0.5 flex items-center gap-2.5 rounded-2xl py-2.5 text-[13.5px] font-semibold transition",
        depth ? "pl-11 pr-3" : "px-3",
        here ? "bg-pink/10 text-pink" : "text-muted hover:bg-panel2 hover:text-text")}>
      {here && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full" style={{ background: accent }} />}
      {icon && <Icon d={icon} className="h-[19px] w-[19px]" />}
      {!icon && depth > 0 && <span className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", here ? "bg-pink" : "bg-line")} />}
      <span>{label}</span>
    </NavLink>
  );
}

function RailGroup({ group }: { group: Group }) {
  if (group.tabs.length === 1) {
    return <RailLink to={group.tabs[0].to} label={group.label} icon={group.icon} accent={group.accent} />;
  }
  return (
    <div className="mb-2 mt-1">
      <div className="flex items-center gap-2 px-3 pb-1.5 pt-2 text-faint">
        <Icon d={group.icon} className="h-[15px] w-[15px]" />
        <span className="text-[10.5px] font-bold uppercase tracking-[0.12em]">{group.label}</span>
      </div>
      {group.tabs.map((t) => <RailLink key={t.to} to={t.to} label={t.label} accent={group.accent} depth={1} />)}
    </div>
  );
}

const SEV_DOT: Record<AlertSeverity, string> = { critical: "bg-bad", warning: "bg-warn", info: "bg-dim" };

function AlertBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["alerts"], queryFn: getAlerts, enabled: isEngineConfigured, staleTime: 60_000, refetchInterval: 300_000 });
  const dq = useQuery({ queryKey: ["alert-dismissals"], queryFn: getDismissedAlertKeys, enabled: isEngineConfigured, staleTime: 60_000 });
  const dismissed = dq.data ?? [];
  const all = q.data ?? [];
  const { open: openAlerts, staleKeys } = partitionAlerts(all, dismissed);
  const refresh = () => qc.invalidateQueries({ queryKey: ["alert-dismissals"] });
  const dismiss = (key: string) => { void dismissAlert(key).then(refresh).catch(() => {}); };
  const restoreAll = () => { void restoreAllAlerts().then(refresh).catch(() => {}); };
  useEffect(() => { if (staleKeys.length) void pruneAlertDismissals(staleKeys).then(refresh).catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [staleKeys.join(",")]);
  const count = bellCount(openAlerts);

  const go = (a: Alert) => { setOpen(false); navigate(a.route); };
  return (
    <div className="relative">
      <button title="Alerts" onClick={() => setOpen((o) => !o)}
        className="lift relative flex h-10 w-10 items-center justify-center rounded-2xl border border-line bg-panel text-muted hover:text-text">
        <Icon d={I.bell} className="h-[18px] w-[18px]" />
        {count > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-pink px-1 text-[10px] font-bold text-ink ring-2 ring-bg">{count > 9 ? "9+" : count}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-[61] mt-2 w-[340px] max-w-[92vw] animate-rise overflow-hidden rounded-3xl border border-line bg-panel shadow-pop">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="font-display text-sm font-bold">Alerts {openAlerts.length > 0 && <span className="text-dim">· {openAlerts.length}</span>}</div>
              <NavLink to="/missing" onClick={() => setOpen(false)} className="text-[12px] font-semibold text-pink">Open center →</NavLink>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {q.isLoading ? <div className="px-4 py-6 text-center text-sm text-dim">Checking…</div>
                : openAlerts.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-good/10 text-good"><Icon d="M5 13l4 4L19 7" className="h-5 w-5" /></div>
                    <div className="text-sm font-semibold text-good">All clear</div>
                    <div className="mt-0.5 text-[12px] text-dim">Nothing needs you right now.</div>
                  </div>
                ) : (
                <div className="divide-y divide-line">
                  {openAlerts.map((a) => (
                    <div key={a.key} className="row-hover px-4 py-3">
                      <div className="flex items-start gap-2.5">
                        <span className={cn("mt-1.5 h-2 w-2 flex-shrink-0 rounded-full", SEV_DOT[a.severity])} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-display text-[13px] font-bold text-text">{a.title}</span>
                            {a.metric && <span className="ml-auto tnum text-[11px] text-dim">{a.metric}</span>}
                          </div>
                          <div className="mt-0.5 text-[12px] leading-snug text-muted">{a.detail}</div>
                          <div className="mt-1.5 flex items-center gap-3">
                            <button onClick={() => go(a)} className="text-[12px] font-semibold text-pink">→ {a.action}</button>
                            <button onClick={() => dismiss(a.key)} className="text-[12px] text-faint hover:text-text">Dismiss</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {dismissed.length > 0 && (
              <div className="border-t border-line px-4 py-2.5 text-center">
                <button onClick={restoreAll} className="text-[12px] font-semibold text-dim hover:text-text">Restore {dismissed.length} dismissed</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ThemeToggle() {
  const theme = usePrefs((s) => s.theme);
  const set = usePrefs((s) => s.set);
  const order: ThemeMode[] = ["light", "dark", "system"];
  const next = order[(order.indexOf(theme) + 1) % order.length];
  const isDark = document.documentElement.classList.contains("dark");
  return (
    <button onClick={() => set({ theme: next })} title={`Theme: ${theme} — switch to ${next}`}
      className="lift flex h-10 w-10 items-center justify-center rounded-2xl border border-line bg-panel text-muted hover:text-text">
      <Icon d={isDark ? I.moon : I.sun} className="h-[18px] w-[18px]" />
    </button>
  );
}

function Header({ onAdd }: { onAdd: () => void }) {
  const { pathname } = useLocation();
  const setCommandOpen = useUI((s) => s.setCommandOpen);
  const monthLabel = fmtDate(monthBoundsCairo().from, "MMMM yyyy");
  const group = groupForPath(pathname);
  const title = pathname.startsWith("/product/") ? "Product" : group?.label ?? "BostaOS";
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-bg/80 px-4 py-3.5 backdrop-blur-xl sm:px-8">
      <div className="min-w-0">
        <div className="truncate font-display text-xl font-extrabold leading-tight tracking-tight sm:text-2xl">{title}</div>
        <div className="text-[12.5px] font-medium text-dim">Bosta Bites · {monthLabel}</div>
      </div>
      <div className="flex-1" />
      <button onClick={() => setCommandOpen(true)} className="lift hidden items-center gap-2 rounded-2xl border border-line bg-panel px-3.5 py-2.5 text-sm text-faint shadow-card hover:text-muted lg:flex">
        <Icon d={I.search} className="h-4 w-4" /> <span className="pr-8">Search…</span>
        <kbd className="rounded-md bg-panel2 px-1.5 py-0.5 text-[10px] font-semibold text-dim">⌘K</kbd>
      </button>
      <button onClick={() => setCommandOpen(true)} className="lift flex h-10 w-10 items-center justify-center rounded-2xl border border-line bg-panel text-muted hover:text-text lg:hidden"><Icon d={I.search} className="h-[18px] w-[18px]" /></button>
      <ThemeToggle />
      <AlertBell />
      <button onClick={onAdd} className="lift flex h-10 items-center gap-1.5 rounded-2xl bg-pink px-3 font-display text-sm font-bold text-ink shadow-pink sm:hidden"><Icon d={I.plus} className="h-4 w-4" w={2.6} /></button>
      <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-line bg-panel2"><img src="/mascot-96.png" alt="" className="h-7 w-7 object-contain" /></div>
    </header>
  );
}

function MobileNav() {
  const { pathname } = useLocation();
  const active = groupForPath(pathname);
  const [open, setOpen] = useState(false);
  const primary = useVisibleGroups().slice(0, 5);
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 items-center border-t border-line bg-rail px-1 py-2 md:hidden">
        {primary.map((g) => (
          <NavLink key={g.id} to={g.tabs[0].to} className={cn("flex flex-col items-center gap-1 rounded-xl px-1 py-1.5", active?.id === g.id ? "text-pink" : "text-faint")}>
            <Icon d={g.icon} className="h-5 w-5" /><span className="text-[9px] font-semibold">{g.label}</span>
          </NavLink>
        ))}
        <button onClick={() => setOpen(true)} className={cn("flex flex-col items-center gap-1 rounded-xl px-1 py-1.5", active && !primary.includes(active) ? "text-pink" : "text-faint")}>
          <Icon d={I.insights} className="h-5 w-5" /><span className="text-[9px] font-semibold">More</span>
        </button>
      </nav>
      {open && (
        <div onClick={() => setOpen(false)} className="fixed inset-0 z-[60] flex items-end bg-black/70 md:hidden">
          <div onClick={(e) => e.stopPropagation()} className="max-h-[80vh] w-full animate-sheetUp overflow-y-auto rounded-t-3xl border border-line bg-panel2 p-5 pb-8 shadow-sheet">
            <div className="mb-3 flex items-center justify-between"><div className="font-display text-lg font-semibold">All sections</div>
              <button onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-panel2 text-muted">✕</button></div>
            <div className="space-y-3">
              {[...GROUPS, SETTINGS].map((g) => (
                <div key={g.id}>
                  <div className="mb-1 flex items-center gap-2 text-faint"><Icon d={g.icon} className="h-4 w-4" /><span className="text-[10px] font-bold uppercase tracking-wider">{g.label}</span></div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.tabs.map((t) => (
                      <NavLink key={t.to} to={t.to} end onClick={() => setOpen(false)}
                        className={({ isActive }) => cn("rounded-lg border px-3 py-1.5 text-[13px]", isActive ? "border-pink bg-pink/15 text-pink" : "border-line bg-panel text-muted")}>
                        {t.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Shell() {
  const [add, setAdd] = useState(false);
  useApplyTheme();
  // Apply the owner's default period once on launch.
  const defaultRange = usePrefs((s) => s.defaultRange);
  const landing = usePrefs((s) => s.landing);
  useEffect(() => { useFilters.getState().setRangeKey(defaultRange); }, [defaultRange]);
  return (
    <div className="flex min-h-screen bg-bg text-text">
      <Rail onAdd={() => setAdd(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onAdd={() => setAdd(true)} />
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 pb-28 pt-6 sm:px-8 md:pb-12">
          <Suspense fallback={<SkeletonRows rows={6} />}>
            <Routes>
              <Route path="/" element={<Navigate to={landing} replace />} />
              {ALL_GROUPS.flatMap((g) => g.tabs.map((t) => (
                <Route key={t.to} path={t.to} element={<Page group={g}>{t.el}</Page>} />
              )))}
              <Route path="/imports" element={<Navigate to="/sales/import" replace />} />
              <Route path="/product/:id" element={<ProductDetailScreen />} />
              <Route path="/settlement/:id" element={<SettlementDetailScreen />} />
              <Route path="*" element={<Navigate to={landing} replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
      <MobileNav />
      <QuickSheet open={add} onClose={() => setAdd(false)} />
      <CommandPalette />
      <Toaster />
    </div>
  );
}

export default function EngineApp() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <BrowserRouter>
          <AuthGate><Shell /></AuthGate>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
