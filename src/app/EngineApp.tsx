/**
 * BostaOS v2 shell — matches the Claude Design reference: slim pink-accented
 * rail, central + quick-add (write-gated), big Fredoka header, jet bg with pink
 * glow. Read-only over the verified Supabase engine.
 */
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { cn } from "@/core/utils/cn";
import { fmtDate } from "@/core/utils/date";
import { monthBoundsCairo } from "@/core/time";
import { AuthProvider, AuthGate } from "@/features/auth/auth";
import { GatedButton } from "@/components/ui";
import { Toaster } from "@/components/feedback";
import { ProductForm, PurchaseForm, SaleForm, ExpenseForm, CashForm } from "@/features/engine/forms";
import { WRITE_BADGE } from "@/core/capabilities";
import { StockScreen, SalesScreen, PurchasesScreen, ReconcileScreen } from "@/features/engine/screens";
import { DashboardScreen, HealthScreen, MissingScreen } from "@/features/engine/dashboard";
import { MoneyScreen, ChequesScreen, ExpensesScreen } from "@/features/engine/money";
import { ReportsScreen, SystemCheckScreen, ImportsScreen, SettingsScreen } from "@/features/engine/more";

const I = {
  today: "M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5",
  sales: "M3 3v18h18M7 14l3-3 3 3 5-6",
  goods: "M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10",
  buy: "M6 6h15l-1.6 9H7.6zM6 6 5 3H2M9 20.5a.9.9 0 1 0 0-.01M18 20.5a.9.9 0 1 0 0-.01",
  cash: "M3 7h18v11H3zM3 11h18M7 15h3",
  spend: "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  cheques: "M2 7h20v10H2zM2 11h20M6 15h4",
  profit: "M5 21V10M12 21V4M19 21v-7",
  reports: "M6 2h9l5 5v15H4V2zM9 13h6M9 17h6",
  health: "M22 12h-4l-3 8L9 4l-3 8H2",
  gaps: "M12 2 2 22h20zM12 9v5M12 18h.01",
  system: "M9 12l2 2 4-4M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a8 8 0 0 0 .1-3l1.6-1.2-2-3.4-1.8.7a8 8 0 0 0-2.6-1.5L14 1h-4l-.3 1.9a8 8 0 0 0-2.6 1.5l-1.8-.7-2 3.4L4.7 12a8 8 0 0 0 0 3l-1.6 1.2 2 3.4 1.8-.7a8 8 0 0 0 2.6 1.5L10 23h4l.3-1.9a8 8 0 0 0 2.6-1.5l1.8.7 2-3.4z",
  plus: "M12 5v14M5 12h14",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
} as const;

function Icon({ d, className = "h-5 w-5", w = 1.9 }: { d: string; className?: string; w?: number }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" className={className}><path d={d} /></svg>;
}

interface Item { to: string; label: string; icon: string; el: React.ReactNode; }
const NAV: Item[] = [
  { to: "/dashboard", label: "Today", icon: I.today, el: <DashboardScreen /> },
  { to: "/sales", label: "Sales", icon: I.sales, el: <SalesScreen /> },
  { to: "/stock", label: "Goods", icon: I.goods, el: <StockScreen /> },
  { to: "/purchases", label: "Buy", icon: I.buy, el: <PurchasesScreen /> },
  { to: "/money", label: "Cash", icon: I.cash, el: <MoneyScreen /> },
  { to: "/expenses", label: "Spend", icon: I.spend, el: <ExpensesScreen /> },
  { to: "/cheques", label: "Cheques", icon: I.cheques, el: <ChequesScreen /> },
  { to: "/reconcile", label: "Profit", icon: I.profit, el: <ReconcileScreen /> },
  { to: "/reports", label: "Reports", icon: I.reports, el: <ReportsScreen /> },
  { to: "/health", label: "Health", icon: I.health, el: <HealthScreen /> },
  { to: "/missing", label: "Gaps", icon: I.gaps, el: <MissingScreen /> },
];
const FOOT: Item[] = [
  { to: "/imports", label: "Imports", icon: I.reports, el: <ImportsScreen /> },
  { to: "/system", label: "System", icon: I.system, el: <SystemCheckScreen /> },
  { to: "/settings", label: "Settings", icon: I.settings, el: <SettingsScreen /> },
];
const ALL = [...NAV, ...FOOT];
const FULLTITLE: Record<string, string> = {
  "/dashboard": "Today", "/sales": "Sales", "/stock": "Goods", "/purchases": "Purchases",
  "/money": "Cash", "/expenses": "Expenses", "/cheques": "Cheques & Settlement", "/reconcile": "Profit", "/reports": "Reports",
  "/health": "Business Health", "/missing": "Missing Data", "/imports": "Imports", "/system": "System Check", "/settings": "Settings",
};

function QuickSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [view, setView] = useState<null | "product" | "purchase" | "sale" | "expense" | "cashcount">(null);
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
            <div className="pt-2 font-mono text-[10px] uppercase tracking-wider text-dim">Coming soon</div>
            {["Upload screenshot"].map((a) => <GatedButton key={a}>{a}</GatedButton>)}
          </div>
        )}
      </div>
    </div>
  );
}

function Rail({ onAdd }: { onAdd: () => void }) {
  return (
    <aside className="no-scrollbar sticky top-0 hidden h-screen w-[76px] flex-shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-line2 bg-rail py-4 md:flex">
      <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-xl bg-pink"><div className="mascot h-5 w-4" style={{ background: "#160910" }} /></div>
      <button onClick={onAdd} className="lift my-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-pink text-ink shadow-pink" aria-label="Quick add"><Icon d={I.plus} w={2.6} /></button>
      {NAV.map((n) => <RailLink key={n.to} {...n} />)}
      <div className="mt-auto flex flex-col items-center gap-1">{FOOT.map((n) => <RailLink key={n.to} {...n} />)}</div>
    </aside>
  );
}
function RailLink({ to, label, icon }: Item) {
  return (
    <NavLink to={to} className={({ isActive }) => cn("navbtn flex w-[62px] flex-col items-center gap-1 rounded-xl py-2 transition", isActive ? "text-pink" : "text-faint hover:text-muted")}>
      <Icon d={icon} /><span className="text-[8.5px] font-semibold">{label}</span>
    </NavLink>
  );
}

function Header({ onAdd }: { onAdd: () => void }) {
  const { pathname } = useLocation();
  const monthLabel = fmtDate(monthBoundsCairo().from, "MMMM yyyy");
  return (
    <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-line2 bg-rail/95 px-4 py-3 backdrop-blur sm:px-7">
      <div>
        <div className="font-display text-xl font-semibold leading-tight sm:text-2xl">{FULLTITLE[pathname] ?? "BostaOS"}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-dim">
          <span>Bosta Bites · {monthLabel}</span>
          <span className="rounded-full bg-good/15 px-2 py-0.5 font-display text-[10px] font-semibold text-good">{WRITE_BADGE}</span>
        </div>
      </div>
      <div className="flex-1" />
      <div className="hidden items-center gap-2 rounded-xl border border-line bg-panel2 px-3 py-2 text-sm text-faint sm:flex">
        <Icon d={I.search} className="h-4 w-4" /> Search…
      </div>
      <button onClick={onAdd} className="lift flex h-9 items-center gap-1.5 rounded-xl bg-pink px-3 font-display text-sm font-semibold text-ink shadow-pink sm:hidden"><Icon d={I.plus} className="h-4 w-4" w={2.6} /></button>
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-pink to-berry font-display text-sm font-semibold text-white">B</div>
    </header>
  );
}

function MobileNav() {
  return (
    <nav className="no-scrollbar fixed inset-x-0 bottom-0 z-40 flex items-center gap-1 overflow-x-auto border-t border-line2 bg-rail px-2 py-2 md:hidden">
      {ALL.map((n) => (
        <NavLink key={n.to} to={n.to} className={({ isActive }) => cn("flex min-w-[56px] flex-shrink-0 flex-col items-center gap-1 rounded-xl px-2 py-1.5", isActive ? "text-pink" : "text-faint")}>
          <Icon d={n.icon} className="h-5 w-5" /><span className="text-[9px] font-semibold">{n.label}</span>
        </NavLink>
      ))}
    </nav>
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
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            {ALL.map((n) => <Route key={n.to} path={n.to} element={n.el} />)}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
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
