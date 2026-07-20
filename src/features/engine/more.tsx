import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, Eyebrow, Button, Field, Input, Select } from "@/components/ui";
import { Confirm } from "@/components/ui/Confirm";
import { EmptyState } from "@/components/feedback";
import { usePrefs } from "@/store/prefs";
import { LANDING_OPTIONS, HIDEABLE_SECTIONS } from "@/core/nav";
import { RANGE_PRESETS } from "@/core/range";
import { isEngineConfigured, sb } from "@/core/db/engine";
import { useAuth, SignOutButton } from "@/features/auth/auth";
import { todayCairo } from "@/core/time";
import { getCostUpliftPct } from "@/core/read/products";
import { getTargets } from "@/core/read/budgets";
import { getSettings } from "@/core/read/expenses";
import { getLocations } from "@/core/read/common";
import { setAppSetting, setLocationTerm, setCostUplift } from "@/core/db/mutations";
import { useUI } from "@/store/ui";

const en = isEngineConfigured;

// ── System Check ──────────────────────────────────────────────────────────
type Chk = { name: string; ok: boolean | null; detail: string };
export function SystemCheckScreen() {
  const { session, email } = useAuth();
  const [tables, setTables] = useState<Chk[]>([]);
  useEffect(() => {
    let on = true;
    (async () => {
      if (!sb) return;
      const names = ["products", "sales", "sale_items", "purchase_batches", "inventory_movements", "money_accounts", "settlement_periods", "cheques"];
      const out: Chk[] = [];
      for (const t of names) {
        const { count, error } = await sb.from(t as "products").select("id", { count: "exact", head: true });
        out.push({ name: `read ${t}`, ok: !error, detail: error ? error.message : `${count ?? 0} rows` });
      }
      if (on) setTables(out);
    })();
    return () => { on = false; };
  }, []);
  const env: Chk[] = [
    { name: "Supabase configured", ok: isEngineConfigured, detail: isEngineConfigured ? "URL + anon key present" : "missing env" },
    { name: "Authenticated session", ok: !!session, detail: session ? (email ?? "signed in") : "not signed in" },
  ];
  return (
    <div className="space-y-4">
      <Group title="Connection & auth" checks={env} />
      <Group title="Table reads (under your session / RLS)" checks={tables} />
    </div>
  );
}
function Group({ title, checks }: { title: string; checks: Chk[] }) {
  return (
    <Card className="!p-0">
      <div className="border-b border-line px-4 py-3 font-display text-sm font-semibold">{title}</div>
      <div className="divide-y divide-line">
        {checks.length === 0 && <div className="px-4 py-3 text-sm text-dim">{isEngineConfigured ? "Checking…" : "Supabase not configured — checks skipped."}</div>}
        {checks.map((c) => (
          <div key={c.name} className="flex items-center gap-3 px-4 py-3">
            <span className="flex-1 text-sm text-text">{c.name}</span>
            <span className="text-[12px] tabular-nums text-dim">{c.detail}</span>
            <span className={`chipx ${c.ok == null ? "mute" : c.ok ? "good" : "bad"}`}>{c.ok == null ? "…" : c.ok ? "ok" : "failed"}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Targets & budgets (owner-editable monthly goals → app_settings.budgets) ──
function TargetsCard() {
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const t = useQuery({ queryKey: ["targets"], queryFn: getTargets, enabled: en });
  const [rev, setRev] = useState("");
  const [prof, setProf] = useState("");
  const [exp, setExp] = useState("");
  useEffect(() => {
    const d = t.data; if (!d) return;
    setRev(d.monthlyRevenue != null ? String(d.monthlyRevenue) : "");
    setProf(d.monthlyProfit != null ? String(d.monthlyProfit) : "");
    setExp(d.monthlyExpenseBudget != null ? String(d.monthlyExpenseBudget) : "");
  }, [t.data]);
  const numOrNull = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const save = useMutation({
    mutationFn: () => setAppSetting("budgets", {
      monthlyRevenue: numOrNull(rev), monthlyProfit: numOrNull(prof), monthlyExpenseBudget: numOrNull(exp),
      categoryBudgets: t.data?.categoryBudgets ?? {},
    }),
    onSuccess: () => { reportSuccess("Targets", "Monthly targets saved"); qc.invalidateQueries(); },
    onError: (e) => reportError("Targets", e),
  });
  return (
    <Card>
      <Eyebrow>Monthly targets & budgets</Eyebrow>
      <p className="mt-1 text-[12px] text-dim">Set monthly goals. Leave blank to disable one.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Revenue target (EGP)"><Input type="number" step="any" value={rev} onChange={(e) => setRev(e.target.value)} placeholder="150000" /></Field>
        <Field label="Profit target (EGP)"><Input type="number" step="any" value={prof} onChange={(e) => setProf(e.target.value)} placeholder="40000" /></Field>
        <Field label="Expense budget (EGP)"><Input type="number" step="any" value={exp} onChange={(e) => setExp(e.target.value)} placeholder="30000" /></Field>
      </div>
      <div className="mt-3"><Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save targets"}</Button></div>
    </Card>
  );
}

// ── Costing (roasting + packaging uplift on raw nut/seed costs) ──────────────
function CostingCard() {
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cost-uplift"], queryFn: getCostUpliftPct, enabled: en });
  const [pct, setPct] = useState("");
  useEffect(() => { if (q.data != null) setPct(String(q.data)); }, [q.data]);
  const save = useMutation({
    mutationFn: () => setCostUplift(Math.max(0, parseFloat(pct) || 0)),
    onSuccess: () => { reportSuccess("Costing", "Uplift saved · estimate product costs recomputed"); qc.invalidateQueries(); },
    onError: (e) => reportError("Costing", e),
  });
  return (
    <Card>
      <Eyebrow>Cost uplift for roasting + packaging</Eyebrow>
      <p className="mt-1 text-[12px] text-dim">Adds a % onto raw nut/seed cost to cover roasting loss and packaging. Ready-made goods (jelly, pretzels…) aren&rsquo;t touched.</p>
      <div className="mt-2 flex items-end gap-2">
        <Field label="Uplift % on raw costs"><Input type="number" step="any" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="15" /></Field>
        <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</Button>
      </div>
    </Card>
  );
}

// ── Settings (editable: tracking start, low-stock default, rent, revenue share)
export function SettingsScreen() {
  const { email } = useAuth();
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings, enabled: en });
  const locations = useQuery({ queryKey: ["locations"], queryFn: getLocations, enabled: en });

  const [tracking, setTracking] = useState("");
  const [lowDefault, setLowDefault] = useState("");
  const [rent, setRent] = useState("");
  const [share, setShare] = useState("");
  const [confirm, setConfirm] = useState<null | "rent" | "share">(null);
  useEffect(() => {
    const s = settings.data; if (!s) return;
    if (typeof s["inventory_tracking_start_date"] === "string") setTracking(s["inventory_tracking_start_date"] as string);
    if (s["low_stock_default"] != null) setLowDefault(String(s["low_stock_default"]));
  }, [settings.data]);

  const loc = locations.data?.[0];
  const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const save = useMutation({
    mutationFn: async (what: "tracking" | "low" | "rent" | "share") => {
      if (what === "tracking") return setAppSetting("inventory_tracking_start_date", tracking);
      if (what === "low") return setAppSetting("low_stock_default", num(lowDefault) ?? 0);
      if (!loc) throw new Error("No location.");
      if (what === "rent") return setLocationTerm(loc.id, "rent", num(rent) ?? 0, todayCairo());
      return setLocationTerm(loc.id, "revenue_charge", (num(share) ?? 0) / 100, todayCairo()); // % → rate
    },
    onSuccess: (_d, what) => { reportSuccess("Settings", `${what === "rent" ? "Monthly rent" : what === "share" ? "Revenue share" : what === "tracking" ? "Tracking start" : "Low-stock default"} saved`); setConfirm(null); qc.invalidateQueries(); },
    onError: (e) => reportError("Settings", e),
  });

  if (!en) return <EmptyState title="Sign in to manage settings" />;
  return (
    <div className="max-w-2xl space-y-4">
      <Link to="/settings/history" className="lift block rounded-2xl border border-pink/40 bg-pink/[0.06] p-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-display text-sm font-semibold text-text">Load my Bosta Bites history</div>
            <div className="text-[12px] text-dim">Import real sales, expenses, buys, cheques and products as editable entries.</div>
          </div>
          <span className="font-display text-sm font-semibold text-pink">Open →</span>
        </div>
      </Link>

      <Card>
        <Eyebrow>Account</Eyebrow>
        <Row label="Signed in" value={email ?? "—"} />
        <Row label="Data" value="Live · your account only" last />
        <div className="mt-3"><SignOutButton /></div>
      </Card>

      <TargetsCard />
      <CostingCard />

      <Card>
        <Eyebrow>Tracking & stock</Eyebrow>
        <div className="mt-2 space-y-3">
          <div className="flex items-end gap-2">
            <Field label="Inventory tracking start"><Input type="date" value={tracking} onChange={(e) => setTracking(e.target.value)} /></Field>
            <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate("tracking")}>Save</Button>
          </div>
          <div className="flex items-end gap-2">
            <Field label="Default low-stock alert (base units)"><Input type="number" step="any" value={lowDefault} onChange={(e) => setLowDefault(e.target.value)} /></Field>
            <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate("low")}>Save</Button>
          </div>
        </div>
      </Card>

      <Card>
        <Eyebrow>Settlement terms (new effective from today)</Eyebrow>
        <p className="mb-2 text-[12px] text-dim">New term applies from today. Past periods unchanged.</p>
        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <Field label="Monthly rent (EGP, flat)"><Input type="number" step="any" value={rent} onChange={(e) => setRent(e.target.value)} placeholder="15000" /></Field>
            <Button variant="outline" disabled={!loc || save.isPending || num(rent) == null} onClick={() => setConfirm("rent")}>Save</Button>
          </div>
          <div className="flex items-end gap-2">
            <Field label="Revenue share (%)"><Input type="number" step="any" value={share} onChange={(e) => setShare(e.target.value)} placeholder="3" /></Field>
            <Button variant="outline" disabled={!loc || save.isPending || num(share) == null} onClick={() => setConfirm("share")}>Save</Button>
          </div>
        </div>
      </Card>

      <Confirm open={confirm === "rent"} title="Change monthly rent?" busy={save.isPending}
        message={`New rent of ${num(rent) ?? 0} EGP/month, effective today. Future settlements use it; past periods unchanged. Affects what you're owed.`}
        confirmLabel="Set rent" onConfirm={() => save.mutate("rent")} onClose={() => setConfirm(null)} />
      <Confirm open={confirm === "share"} title="Change revenue share?" busy={save.isPending}
        message={`New revenue share of ${num(share) ?? 0}%, effective today. Future settlements deduct it from revenue; past periods unchanged.`}
        confirmLabel="Set share" onConfirm={() => save.mutate("share")} onClose={() => setConfirm(null)} />
    </div>
  );
}
function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return <div className={`flex items-center justify-between py-2.5 ${last ? "" : "border-b border-line"}`}><span className="text-sm text-muted">{label}</span><span className="text-sm text-text">{value}</span></div>;
}

// ── Preferences (app-wide customization) ─────────────────────────────────────
export function PreferencesScreen() {
  const { landing, defaultRange, hiddenSections, accountingStart, set, toggleSection, reset } = usePrefs();
  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <Eyebrow>How BostaOS opens</Eyebrow>
        <div className="mt-2 space-y-3">
          <Field label="Default landing page">
            <Select value={landing} onChange={(e) => set({ landing: e.target.value })}>
              {LANDING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label="Default period (global date range)">
            <Select value={defaultRange} onChange={(e) => set({ defaultRange: e.target.value as typeof defaultRange })}>
              {RANGE_PRESETS.filter((p) => p.key !== "custom").map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </Select>
          </Field>
        </div>
        <p className="mt-2 text-[11px] text-dim">Applied on open. Saved in this browser.</p>
      </Card>

      <Card>
        <Eyebrow>Bookkeeping start</Eyebrow>
        <p className="mt-1 text-[12px] text-dim">Costs before this date are incomplete. Earlier revenue still shows, but <b>profit is only calculated from this date onward</b> (with a “partial before” note). Set it to when accurate accounting begins.</p>
        <div className="mt-2 flex items-end gap-2">
          <Field label="Accounting start date"><Input type="date" value={accountingStart} onChange={(e) => set({ accountingStart: e.target.value })} /></Field>
        </div>
      </Card>

      <Card>
        <Eyebrow>Visible sections</Eyebrow>
        <p className="mt-1 text-[12px] text-dim">Hide sections from nav. Still reachable by link — nothing deleted.</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {HIDEABLE_SECTIONS.map((s) => {
            const visible = !hiddenSections.includes(s.id);
            return (
              <button key={s.id} onClick={() => toggleSection(s.id)}
                className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm ${visible ? "border-pink/40 bg-pink/10 text-text" : "border-line bg-panel2 text-dim"}`}>
                <span className="font-display font-semibold">{s.label}</span>
                <span className={`text-[11px] ${visible ? "text-pink" : "text-faint"}`}>{visible ? "shown" : "hidden"}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="flex justify-end"><Button variant="ghost" onClick={reset}>Reset preferences</Button></div>
    </div>
  );
}
