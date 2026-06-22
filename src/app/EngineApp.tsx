/**
 * BostaOS shell — Bosta Bites brand: jet background with pink glow, the peanut
 * mascot mark, and a slim rail of consolidated sections. Each section groups
 * related screens behind sub-tabs (Sales = days + receipts, Inventory = stock +
 * purchases, Money = cash + spend + cheques, Reports = summary + profit,
 * Insights = health + gaps + activity, Settings = general + system + QA).
 */
import { lazy, Suspense, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/core/utils/cn";
import { fmtDate } from "@/core/utils/date";
import { monthBoundsCairo } from "@/core/time";
import { AuthProvider, AuthGate } from "@/features/auth/auth";
import { Toaster, SkeletonRows } from "@/components/feedback";
import { ProductForm, PurchaseForm, SaleForm, ExpenseForm, CashForm } from "@/features/engine/forms";
import { WRITE_BADGE } from "@/core/capabilities";

// Lazy route chunks — split out of the initial bundle.
const screens = () => import("@/features/engine/screens");
const dash = () => import("@/features/engine/dashboard");
const money = () => import("@/features/engine/money");
const more = () => import("@/features/engine/more");
const product = () => import("@/features/engine/product");
const receipts = () => import("@/features/engine/receipts");
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
const QAScreen = L(qa, "QAScreen");
const ProductDetailScreen = L(product, "ProductDetailScreen");

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
} as const;

function Icon({ d, className = "h-5 w-5", w = 1.9 }: { d: string; className?: string; w?: number }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" className={className}><path d={d} /></svg>;
}

interface Tab { to: string; label: string; el: React.ReactNode }
interface Group { id: string; label: string; icon: string; tabs: Tab[] }

const GROUPS: Group[] = [
  { id: "today", label: "Today", icon: I.today, tabs: [{ to: "/dashboard", label: "Today", el: <DashboardScreen /> }] },
  { id: "sales", label: "Sales", icon: I.sales, tabs: [
    { to: "/sales", label: "Sales days", el: <SalesScreen /> },
    { to: "/sales/import", label: "Import & receipts", el: <ReceiptsScreen fixedKind="sales" /> },
  ] },
  { id: "inventory", label: "Inventory", icon: I.inventory, tabs: [
    { to: "/stock", label: "Stock", el: <StockScreen /> },
    { to: "/purchases", label: "Purchases", el: <PurchasesScreen /> },
  ] },
  { id: "money", label: "Money", icon: I.money, tabs: [
    { to: "/money", label: "Cash", el: <MoneyScreen /> },
    { to: "/expenses", label: "Spend", el: <ExpensesScreen /> },
    { to: "/cheques", label: "Cheques", el: <ChequesScreen /> },
    { to: "/expenses/import", label: "Import expenses", el: <ReceiptsScreen fixedKind="expenses" /> },
  ] },
  { id: "reports", label: "Reports", icon: I.reports, tabs: [
    { to: "/reports", label: "Summary", el: <ReportsScreen /> },
    { to: "/reconcile", label: "Profit", el: <ReconcileScreen /> },
  ] },
  { id: "insights", label: "Insights", icon: I.insights, tabs: [
    { to: "/health", label: "Health", el: <HealthScreen /> },
    { to: "/missing", label: "Gaps", el: <MissingScreen /> },
    { to: "/activity", label: "Activity", el: <ActivityScreen /> },
  ] },
];
const SETTINGS: Group = { id: "settings", label: "Settings", icon: I.settings, tabs: [
  { to: "/settings", label: "General", el: <SettingsScreen /> },
  { to: "/system", label: "System", el: <SystemCheckScreen /> },
  { to: "/qa", label: "QA Mode", el: <QAScreen /> },
] };
const ALL_GROUPS = [...GROUPS, SETTINGS];

function groupForPath(pathname: string): Group | undefined {
  return ALL_GROUPS.find((g) => g.tabs.some((t) => t.to === pathname || pathname.startsWith(t.to + "/")));
}

function SectionTabs({ group }: { group: Group }) {
  if (group.tabs.length < 2) return null;
  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {group.tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end
          className={({ isActive }) => cn("rounded-xl px-3.5 py-1.5 font-display text-[13px] font-semibold transition",
            isActive ? "bg-pink text-ink shadow-pink" : "border border-line bg-panel2 text-muted hover:text-text")}>
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
          <button onClick={close} className="flex h-8 w-8 items-center justify-center rounded-lg bg-line2 text-muted hover:text-text">✕</button>
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

function Rail({ onAdd }: { onAdd: () => void }) {
  return (
    <aside className="no-scrollbar sticky top-0 hidden h-screen w-[212px] flex-shrink-0 flex-col overflow-y-auto border-r border-line2 bg-rail md:flex">
      <div className="px-3 pb-3 pt-4">
        <NavLink to="/dashboard" className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-line2 bg-panel2"><img src="/mascot-96.png" alt="Bosta Bites" className="h-7 w-7 object-contain" /></div>
          <div>
            <div className="font-display text-base font-semibold leading-none">BostaOS</div>
            <div className="text-[10px] text-dim">Bosta Bites</div>
          </div>
        </NavLink>
        <button onClick={onAdd} className="lift mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-pink py-2 font-display text-sm font-semibold text-ink shadow-pink">
          <Icon d={I.plus} w={2.6} className="h-4 w-4" /> Quick add
        </button>
      </div>
      <nav className="flex-1 px-2.5 pb-2">{GROUPS.map((g) => <RailGroup key={g.id} group={g} />)}</nav>
      <div className="border-t border-line2 px-2.5 py-2"><RailGroup group={SETTINGS} /></div>
    </aside>
  );
}

function RailGroup({ group }: { group: Group }) {
  const { pathname } = useLocation();
  const isHere = (to: string) => pathname === to || pathname.startsWith(to + "/");
  if (group.tabs.length === 1) {
    const t = group.tabs[0];
    return (
      <NavLink to={t.to} end
        className={cn("relative mb-0.5 flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition", isHere(t.to) ? "bg-panel2 font-semibold text-pink" : "text-muted hover:bg-line2/50 hover:text-text")}>
        {isHere(t.to) && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r bg-pink" />}
        <Icon d={group.icon} className="h-[18px] w-[18px]" /><span className="font-display">{group.label}</span>
      </NavLink>
    );
  }
  return (
    <div className="mb-1.5 mt-0.5">
      <div className="flex items-center gap-2 px-2.5 pb-1 pt-1.5 text-faint">
        <Icon d={group.icon} className="h-[15px] w-[15px]" /><span className="font-mono text-[10px] uppercase tracking-wider">{group.label}</span>
      </div>
      {group.tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end
          className={cn("relative ml-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition", isHere(t.to) ? "font-semibold text-pink" : "text-muted hover:text-text")}>
          {isHere(t.to) && <span className="absolute -left-2 top-1/2 h-4 w-1 -translate-y-1/2 rounded-r bg-pink" />}
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}

function Header({ onAdd }: { onAdd: () => void }) {
  const { pathname } = useLocation();
  const monthLabel = fmtDate(monthBoundsCairo().from, "MMMM yyyy");
  const group = groupForPath(pathname);
  const title = pathname.startsWith("/product/") ? "Product" : group?.label ?? "BostaOS";
  return (
    <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-line2 bg-rail/95 px-4 py-3 backdrop-blur sm:px-7">
      <div>
        <div className="font-display text-xl font-semibold leading-tight sm:text-2xl">{title}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-dim">
          <span>Bosta Bites · {monthLabel}</span>
          <span className="rounded-full bg-good/15 px-2 py-0.5 font-display text-[10px] font-semibold text-good">{WRITE_BADGE}</span>
        </div>
      </div>
      <div className="flex-1" />
      <button onClick={onAdd} className="lift flex h-9 items-center gap-1.5 rounded-xl bg-pink px-3 font-display text-sm font-semibold text-ink shadow-pink sm:hidden"><Icon d={I.plus} className="h-4 w-4" w={2.6} /></button>
      <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-line2 bg-panel2"><img src="/mascot-96.png" alt="" className="h-7 w-7 object-contain" /></div>
    </header>
  );
}

function MobileNav() {
  const { pathname } = useLocation();
  const active = groupForPath(pathname);
  const [open, setOpen] = useState(false);
  const primary = GROUPS.slice(0, 5);
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 items-center border-t border-line2 bg-rail px-1 py-2 md:hidden">
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
              <button onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-line2 text-muted">✕</button></div>
            <div className="space-y-3">
              {[...GROUPS, SETTINGS].map((g) => (
                <div key={g.id}>
                  <div className="mb-1 flex items-center gap-2 text-faint"><Icon d={g.icon} className="h-4 w-4" /><span className="font-mono text-[10px] uppercase tracking-wider">{g.label}</span></div>
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
  return (
    <div className="flex min-h-screen bg-bg text-text" style={{ backgroundImage: "radial-gradient(circle at 82% -8%, rgba(248,104,200,0.12), transparent 42%)" }}>
      <Rail onAdd={() => setAdd(true)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onAdd={() => setAdd(true)} />
        <main className="mx-auto w-full max-w-[1080px] flex-1 px-4 pb-28 pt-6 sm:px-7 md:pb-10">
          <Suspense fallback={<SkeletonRows rows={6} />}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              {ALL_GROUPS.flatMap((g) => g.tabs.map((t) => (
                <Route key={t.to} path={t.to} element={<Page group={g}>{t.el}</Page>} />
              )))}
              <Route path="/imports" element={<Navigate to="/sales/import" replace />} />
              <Route path="/product/:id" element={<ProductDetailScreen />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
      <MobileNav />
      <QuickSheet open={add} onClose={() => setAdd(false)} />
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
