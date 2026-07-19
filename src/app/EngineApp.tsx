/**
 * BostaOS shell — Bosta Bites brand: jet background with pink glow, the peanut
 * mascot mark, and a slim rail of consolidated sections. Each section groups
 * related screens behind sub-tabs (Sales = days + receipts, Inventory = stock +
 * purchases, Money = cash + spend + cheques, Reports = summary + profit,
 * Insights = health + gaps + activity, Settings = general + system + QA).
 */
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/core/utils/cn";
import { AuthProvider, AuthGate } from "@/features/auth/auth";
import { Toaster, SkeletonRows } from "@/components/feedback";
import { ProductForm, PurchaseForm, SaleForm, ExpenseForm, CashForm } from "@/features/engine/forms";
import { CommandPalette } from "@/features/engine/CommandPalette";
import { useFocusTrap } from "@/components/ui/useFocusTrap";
import { useScrollLock } from "@/components/ui/useScrollLock";
import { NAV_SECTIONS, SETTINGS_SECTION } from "@/core/nav";
import { usePrefs, useApplyTheme } from "@/store/prefs";
import { useFilters } from "@/store/filters";
import { useUI } from "@/store/ui";
import { isEngineConfigured } from "@/core/db/engine";
import { getAlerts, getDismissedAlertKeys } from "@/core/read/alerts";
import { dismissAlert, restoreAllAlerts, pruneAlertDismissals } from "@/core/db/mutations";
import { partitionAlerts, bellCount, type Alert, type AlertSeverity } from "@/core/alerts/engine";

// Lazy route chunks — split out of the initial bundle.
const screens = () => import("@/features/engine/screens");
const dash = () => import("@/features/engine/dashboard");
const strategist = () => import("@/features/engine/strategist");
const money = () => import("@/features/engine/money");
const more = () => import("@/features/engine/more");
const product = () => import("@/features/engine/product");
const receipts = () => import("@/features/engine/receipts");
const productImport = () => import("@/features/engine/product-import");
const daySalesImport = () => import("@/features/engine/day-sales-import");
const opening = () => import("@/features/engine/opening");
const performance = () => import("@/features/engine/performance");
const bank = () => import("@/features/engine/bank");
const qa = () => import("@/features/qa/QAScreen");
const L = <M, K extends keyof M>(load: () => Promise<M>, key: K) =>
  lazy(() => load().then((m) => ({ default: m[key] as unknown as React.ComponentType })));

const StockScreen = L(screens, "StockScreen");
const SalesScreen = L(screens, "SalesScreen");
const PurchasesScreen = L(screens, "PurchasesScreen");
const DashboardScreen = L(dash, "DashboardScreen");
const StrategistScreen = L(strategist, "StrategistScreen");
const MoneyScreen = L(money, "MoneyScreen");
const ChequesScreen = L(money, "ChequesScreen");
const ExpensesScreen = L(money, "ExpensesScreen");
const SystemCheckScreen = L(more, "SystemCheckScreen");
const SettingsScreen = L(more, "SettingsScreen");
const ReceiptsScreen = lazy(() => receipts().then((m) => ({ default: m.ReceiptsScreen })));
const HistoryImportScreen = lazy(() => import("@/features/engine/history-import").then((m) => ({ default: m.HistoryImportScreen })));
const PerformanceScreen = L(performance, "PerformanceScreen");
const BankScreen = L(bank, "BankScreen");
const QAScreen = L(qa, "QAScreen");
const PreferencesScreen = L(more, "PreferencesScreen");
const ProductDetailScreen = L(product, "ProductDetailScreen");
const ProductLineImportScreen = L(productImport, "ProductLineImportScreen");
const DaySalesPhotoImport = L(daySalesImport, "DaySalesPhotoImport");
const ProductCostImportScreen = L(productImport, "ProductCostImportScreen");
const OpeningBalancesScreen = L(opening, "OpeningBalancesScreen");

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
  "/sales": <SalesScreen />, "/sales/import": <ReceiptsScreen fixedKind="sales" />, "/sales/product-lines": <DaySalesPhotoImport />, "/sales/product-lines/file": <ProductLineImportScreen />,
  "/stock": <StockScreen />, "/purchases": <PurchasesScreen />, "/costs": <ProductCostImportScreen />,
  "/money": <MoneyScreen />, "/expenses": <ExpensesScreen />, "/cheques": <ChequesScreen />, "/bank": <BankScreen />, "/settlements": <ChequesScreen />, "/expenses/import": <ReceiptsScreen fixedKind="expenses" />,
  "/performance": <PerformanceScreen />,
  "/health": <StrategistScreen />,
  "/settings": <SettingsScreen />, "/settings/prefs": <PreferencesScreen />, "/settings/opening": <OpeningBalancesScreen />, "/settings/history": <HistoryImportScreen />, "/system": <SystemCheckScreen />, "/qa": <QAScreen />,
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
    <div className="mb-5 inline-flex flex-wrap gap-1 rounded-2xl border border-white/[0.09] bg-white/[0.04] p-1.5">
      {group.tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end
          className={({ isActive }) => cn("rounded-xl px-4 py-2 text-[13px] font-semibold transition active:scale-95 motion-reduce:active:scale-100",
            isActive ? "bg-gradient-to-br from-pink to-violet text-white shadow-pink" : "text-muted hover:text-text")}>
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}

// Sections whose screens own the full design layout (their own .pagehdr) — the
// wrapper must not add a second header for these.
const DECK_SECTIONS = new Set(["today", "sales"]);

function Page({ group, children }: { group: Group; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const activeTab = group.tabs.find((t) => pathname === t.to || pathname.startsWith(t.to + "/"));
  // The Today screen carries its own ticker/hero header; every other section
  // gets a consistent Command Deck identity header (accent icon tile + title).
  if (group.id === "today") return <>{children}</>;
  if (DECK_SECTIONS.has(group.id)) return <><SectionTabs group={group} />{children}</>;
  return (
    <>
      <div className="mb-5 flex items-center gap-3.5">
        <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-white/[0.08]" style={{ background: `${group.accent}1f`, color: group.accent }}>
          <Icon d={group.icon} className="h-[22px] w-[22px]" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate font-display text-[26px] font-extrabold leading-none tracking-tight text-text">{group.label}</h1>
          {activeTab && group.tabs.length > 1 && <div className="mt-1.5 text-[13px] font-medium text-dim">{activeTab.label}</div>}
        </div>
      </div>
      <SectionTabs group={group} />
      {children}
    </>
  );
}

/** The "+" button opens the picker (open=true, view=null); ⌘K "Create"
 *  commands set `quickAddView` on the UI store directly, jumping straight into
 *  the form instead of just navigating to its screen. Either source opens the
 *  same sheet, so there's exactly one quick-add surface. */
function QuickSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { quickAddView, closeQuickAdd } = useUI();
  const [view, setView] = useState<null | "product" | "purchase" | "sale" | "expense" | "cashcount">(null);
  const navigate = useNavigate();
  const effectiveOpen = open || quickAddView !== null;
  const effectiveView = quickAddView ?? view;
  const close = useCallback(() => { setView(null); closeQuickAdd(); onClose(); }, [closeQuickAdd, onClose]);
  const panelRef = useFocusTrap<HTMLDivElement>(effectiveOpen, close);
  useScrollLock(effectiveOpen);
  if (!effectiveOpen) return null;
  const titles = { product: "Add product", purchase: "Add purchase", sale: "New sale day", expense: "Add expense", cashcount: "Count cash" } as const;
  return (
    <div onClick={close} className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div ref={panelRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={effectiveView ? titles[effectiveView] : "Quick add"} tabIndex={-1}
        className={`max-h-[92vh] w-full ${effectiveView === "sale" ? "max-w-2xl" : "max-w-md"} animate-sheetUp overflow-y-auto overscroll-contain rounded-t-3xl border border-line bg-panel2 p-5 shadow-sheet focus:outline-none sm:rounded-3xl`}>
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-lg font-semibold">{effectiveView ? titles[effectiveView] : "Quick add"}</div>
          <button onClick={close} className="flex h-8 w-8 items-center justify-center rounded-lg bg-panel2 text-muted hover:text-text">✕</button>
        </div>
        {effectiveView === "product" ? <ProductForm onDone={close} />
          : effectiveView === "purchase" ? <PurchaseForm onDone={close} />
          : effectiveView === "sale" ? <SaleForm onDone={close} />
          : effectiveView === "expense" ? <ExpenseForm onDone={close} />
          : effectiveView === "cashcount" ? <CashForm mode="count" onDone={close} />
          : (
          <div className="space-y-2">
            {([["sale", "New sale"], ["purchase", "Add purchase"], ["product", "Add product"], ["expense", "Add expense"], ["cashcount", "Count cash"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} className="lift row-hover flex w-full items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left">
                <span className="font-display text-sm font-semibold text-text">{label}</span>
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

/** The design's topbar pills: Today / Sales / Stock / Money / Insights / Settings
 *  — seven items in one row, like the Command Deck design (no search box,
 *  no avatar). */
const PILL_IDS = ["today", "sales", "inventory", "money", "reports", "insights"] as const;
const PILL_LABEL: Record<string, string> = { inventory: "Stock" };

function TopNav({ onAdd }: { onAdd: () => void }) {
  const { pathname } = useLocation();
  const active = groupForPath(pathname);
  const groups = useVisibleGroups();
  const pills = [...PILL_IDS.map((id) => groups.find((g) => g.id === id)).filter((g): g is Group => !!g), SETTINGS];
  return (
    <div className="topbar">
      <NavLink to="/dashboard" className="wm">
        <div className="wmark"><img src="/bosta-peanut.svg" alt="Bosta Bites" /></div>
        <div className="wmtxt"><b>Bosta<span>OS</span></b><small>BOSTA BITES · CAIRO</small></div>
      </NavLink>
      <nav className="navpill">
        {pills.map((g) => (
          <NavLink key={g.id} to={g.tabs[0].to} className={cn("np", active?.id === g.id && "on")}>
            <Icon d={g.icon} className="h-4 w-4" /><span>{PILL_LABEL[g.id] ?? g.label}</span>
          </NavLink>
        ))}
      </nav>
      <button onClick={onAdd} className="qadd"><Icon d={I.plus} w={2.6} className="h-4 w-4" /><span className="ql">Quick add</span></button>
      <AlertBell />
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
      <button title="Alerts" onClick={() => setOpen((o) => !o)} className="iconbtn">
        <Icon d={I.bell} className="h-[18px] w-[18px]" />
        {count > 0 && <span className="nd">{count > 9 ? "9+" : count}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-[61] mt-2 w-[340px] max-w-[92vw] animate-rise overflow-hidden rounded-3xl border border-line bg-panel shadow-pop">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="font-display text-sm font-bold">Alerts {openAlerts.length > 0 && <span className="text-dim">· {openAlerts.length}</span>}</div>
              <NavLink to="/health" onClick={() => setOpen(false)} className="text-[12px] font-semibold text-pink">Open strategist →</NavLink>
            </div>
            <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
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


function Shell() {
  const [add, setAdd] = useState(false);
  useApplyTheme();
  // Apply the owner's default period once on launch.
  const defaultRange = usePrefs((s) => s.defaultRange);
  const landing = usePrefs((s) => s.landing);
  useEffect(() => { useFilters.getState().setRangeKey(defaultRange); }, [defaultRange]);
  return (
    <div className="cdk min-h-screen text-text">
      {/* Top padding clears the iOS status bar / notch when installed as a PWA
          (translucent status bar + viewport-fit=cover). env() is 0 on desktop,
          so max() keeps the desktop pt-5 (20px) pixel-identical. */}
      <div className="mx-auto w-full max-w-[1400px] px-4 pb-28 sm:px-7 md:pb-12"
        style={{ paddingTop: "max(1.25rem, calc(env(safe-area-inset-top) + 0.5rem))" }}>
        <TopNav onAdd={() => setAdd(true)} />
        <main>
          <Suspense fallback={<SkeletonRows rows={6} />}>
            <Routes>
              <Route path="/" element={<Navigate to={landing} replace />} />
              {ALL_GROUPS.flatMap((g) => g.tabs.map((t) => (
                <Route key={t.to} path={t.to} element={<Page group={g}>{t.el}</Page>} />
              )))}
              <Route path="/imports" element={<Navigate to="/sales/import" replace />} />
              {/* Reports + Gaps + Activity folded into Performance and the Strategist —
                  redirect the old routes so bookmarks and deep links still land. */}
              <Route path="/reports" element={<Navigate to="/performance" replace />} />
              <Route path="/reports/tables" element={<Navigate to="/performance" replace />} />
              <Route path="/reconcile" element={<Navigate to="/performance" replace />} />
              <Route path="/missing" element={<Navigate to="/health" replace />} />
              <Route path="/activity" element={<Navigate to="/performance" replace />} />
              <Route path="/expenses/import" element={<Page group={ALL_GROUPS.find((g) => g.id === "money")!}>{EL["/expenses/import"]}</Page>} />
              <Route path="/sales/product-lines/file" element={<Page group={ALL_GROUPS.find((g) => g.id === "sales")!}>{EL["/sales/product-lines/file"]}</Page>} />
              <Route path="/product/:id" element={<ProductDetailScreen />} />
              <Route path="*" element={<Navigate to={landing} replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
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
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthGate><Shell /></AuthGate>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
