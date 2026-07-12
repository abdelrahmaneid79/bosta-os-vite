/**
 * Stock / Sales / Purchases / Reconcile screens, driven entirely by live
 * Supabase reads through the verified engine's caches, with full write actions
 * (create/edit/void) on Goods, Sales and Purchases. No mock data: when the
 * connection isn't configured a Connect panel shows instead of fake numbers.
 */
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, Eyebrow, Badge, Select } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { Confirm } from "@/components/ui/Confirm";
import { EmptyState, SkeletonRows, ErrorState, PartialNote } from "@/components/feedback";
import { DateRangePicker } from "@/components/DateRangePicker";
import { useBooksStartDate } from "@/store/books";
import { egp, num, pct } from "@/core/utils/format";
import { fmtDate } from "@/core/utils/date";
import { isEngineConfigured } from "@/core/db/engine";
import { useActiveRange } from "@/store/filters";
import { rangeLabel } from "@/core/range";
import { useFilters } from "@/store/filters";
import { getStockSummary } from "@/core/read/stock";
import { getProducts } from "@/core/read/common";
import { getRecentSales, getSaleItems, daySignal, DAY_SIGNAL_LABEL, type DaySignal, type SaleRow as SaleRowVM, type SaleLine } from "@/core/read/sales";
import { getPurchases, getInventoryPurchases } from "@/core/read/purchases";
import { getProfitReadout } from "@/core/read/profit";
import { ProductForm, PurchaseForm, SaleForm, SaleItemForm } from "./forms";
import { ProductDetailScreen } from "./product";
import { PageHdr, Stat, DeckTile, TileHead } from "./deck";
import { BarChart } from "@/components/charts";
import { todayCairo } from "@/core/time";
import { voidSaleItem, voidSale, setProductActive, deleteProduct } from "@/core/db/mutations";
import { useUI } from "@/store/ui";
import { useQueryClient } from "@tanstack/react-query";
import type { Tables } from "@/core/db/tables";

function Guarded({ q, children, empty }: { q: { isLoading: boolean; isError: boolean; error: unknown }; children: React.ReactNode; empty?: boolean }) {
  if (!isEngineConfigured) return <ConnectPanel />;
  if (q.isLoading) return <SkeletonRows rows={6} />;
  if (q.isError) return <ErrorState message={String((q.error as Error)?.message ?? "Read failed")} />;
  if (empty) return <EmptyState title="No data in range" hint="Nothing recorded for this period yet — add an entry to get started." />;
  return <>{children}</>;
}

export function ConnectPanel() {
  return (
    <Card>
      <Eyebrow>Not connected</Eyebrow>
      <p className="mt-1 text-sm text-muted">
        Add <span className="font-mono text-pink">VITE_SUPABASE_URL</span> and{" "}
        <span className="font-mono text-pink">VITE_SUPABASE_ANON_KEY</span> to a <span className="font-mono">.env</span> file to
        load your real data, then sign in. All actions run under your authenticated session.
      </p>
    </Card>
  );
}

// ── Stock / Goods (operational: create + edit) ───────────────────────────────
export function StockScreen() {
  const q = useQuery({ queryKey: ["stock"], queryFn: getStockSummary, enabled: isEngineConfigured });
  const prods = useQuery({ queryKey: ["products-list"], queryFn: getProducts, enabled: isEngineConfigured });
  const [search, setSearch] = useState("");
  const [vendor, setVendor] = useState<string>("All");
  const [modal, setModal] = useState<null | { mode: "add" } | { mode: "edit"; product: Tables<"products"> }>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const s = q.data;
  const byId = new Map((prods.data ?? []).map((p) => [p.id, p]));
  const term = search.trim().toLowerCase();
  const vendors = useMemo(() => Array.from(new Set((s?.positions ?? []).map((p) => p.vendor).filter((v): v is string => !!v))).sort(), [s]);
  const hasUnassigned = (s?.positions ?? []).some((p) => !p.vendor);
  const positions = (s?.positions ?? []).filter((p) =>
    (!term || p.nameEn.toLowerCase().includes(term) || (byId.get(p.id)?.name_ar ?? "").toLowerCase().includes(term))
    && (vendor === "All" || (vendor === "Unassigned" ? !p.vendor : p.vendor === vendor)),
  );
  const counted = (s?.positions ?? []).filter((p) => p.onHand !== 0).length;
  return (
    <div>
      <div className="statgrid">
        <Stat label="Products" color="var(--mag)" value={s ? s.positions.length : "—"} onClick={() => setManageOpen(true)} sub={<div style={{ fontSize: 11, color: "var(--mag)", fontWeight: 700, marginTop: 8 }}>Manage full list ↗</div>} />
        <Stat label="Total stock value" color="rgb(var(--violet))" value={s ? egp(s.totalValue) : "—"} sub={s && s.totalValue === 0 ? <div style={{ fontSize: 11, color: "rgb(var(--dim))", fontWeight: 600, marginTop: 8 }}>count stock to set →</div> : undefined} />
        <Stat label="Counted / uncounted" color="rgb(var(--cyan))" value={s ? `${counted} / ${s.positions.length - counted}` : "—"} />
        <Stat label="Missing cost" color="var(--amber)" value={s ? s.missingCostCount : "—"} />
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <input className="input" style={{ flex: 1 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search stock…" />
        <button className="addbtn" onClick={() => setManageOpen(true)}>Products</button>
        <button className="qadd" style={{ height: "auto" }} onClick={() => setModal({ mode: "add" })}><span>+ Add product</span></button>
      </div>
      {vendors.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          {["All", ...vendors, ...(hasUnassigned ? ["Unassigned"] : [])].map((v) => {
            const on = vendor === v;
            const count = v === "All" ? (s?.positions ?? []).length : v === "Unassigned" ? (s?.positions ?? []).filter((p) => !p.vendor).length : (s?.positions ?? []).filter((p) => p.vendor === v).length;
            return (
              <button key={v} onClick={() => setVendor(v)} style={{
                padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                border: on ? "1px solid var(--mag)" : "1px solid rgb(var(--line))",
                background: on ? "var(--mag)" : "transparent", color: on ? "#fff" : "rgb(var(--muted))",
              }}>{v} <span style={{ opacity: 0.7 }}>· {count}</span></button>
            );
          })}
        </div>
      )}
      <Guarded q={q} empty={!!s && s.positions.length === 0}>
        <DeckTile style={{ padding: 0 }}>
          <div className="scroll">
            <table className="tbl">
              <thead><tr><th>Product</th><th className="r">On hand</th><th className="r">Stock value</th></tr></thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.id} className="prodcell" onClick={() => setDetailId(p.id)}>
                    <td style={{ fontSize: 14 }}>{p.marketCode && <span className="tnum" style={{ color: "rgb(var(--faint))", fontSize: 12, marginRight: 6 }}>#{p.marketCode}</span>}{p.nameEn}{p.vendor && <span style={{ marginLeft: 6, fontSize: 11, color: "rgb(var(--dim))", border: "1px solid rgb(var(--line))", borderRadius: 6, padding: "1px 6px", whiteSpace: "nowrap" }}>{p.vendor}</span>}{!p.active && <span style={{ color: "rgb(var(--faint))" }}> · inactive</span>}</td>
                    <td className="r" style={{ color: p.isNegative ? "var(--red)" : p.onHand === 0 ? "rgb(var(--faint))" : undefined }}>
                      {p.onHand === 0 ? "—" : num(p.onHand)} <span style={{ color: "rgb(var(--dim))", fontWeight: 400, fontSize: 12 }}>{p.baseUnit}</span>
                    </td>
                    <td className="r">{p.hasCost && p.onHand !== 0 ? egp(p.stockValue) : <span style={{ color: "rgb(var(--faint))", fontFamily: "Satoshi", fontWeight: 500 }}>{p.hasCost ? "—" : "add cost"}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DeckTile>
      </Guarded>
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.mode === "edit" ? "Edit product" : "Add product"}>
        <ProductForm product={modal?.mode === "edit" ? modal.product : undefined} onDone={() => setModal(null)} />
      </Modal>
      <Modal open={!!detailId} onClose={() => setDetailId(null)} wide>
        {detailId && <ProductDetailScreen id={detailId} onClose={() => setDetailId(null)} />}
      </Modal>
      <Modal open={manageOpen} onClose={() => setManageOpen(false)} wide title="All products">
        <ManageProducts />
      </Modal>
    </div>
  );
}

/** Manage-products popup — the design's catalog manager: every product with its
 *  selling price, edit / activate / remove, plus quick add. */
function ManageProducts() {
  const qc = useQueryClient();
  const { reportSuccess, reportError } = useUI();
  const prods = useQuery({ queryKey: ["products-list"], queryFn: getProducts, enabled: isEngineConfigured });
  const [edit, setEdit] = useState<Tables<"products"> | null>(null);
  const [add, setAdd] = useState(false);
  const [del, setDel] = useState<Tables<"products"> | null>(null);
  const remove = useMutation({ mutationFn: (id: string) => deleteProduct(id), onSuccess: () => { reportSuccess("Remove product", "Removed from catalog · sales history kept"); setDel(null); qc.invalidateQueries(); }, onError: (e) => reportError("Remove product", e) });
  const toggle = useMutation({ mutationFn: (v: { id: string; active: boolean }) => setProductActive(v.id, v.active), onSuccess: () => qc.invalidateQueries(), onError: (e) => reportError("Update product", e) });
  const list = prods.data ?? [];
  return (
    <div>
      <div style={{ fontSize: 13, color: "rgb(var(--muted))", marginBottom: 14 }}>{list.length} products · edit prices, activate/deactivate, or remove.</div>
      {prods.isLoading ? <SkeletonRows rows={5} /> : (
        <div className="scroll" style={{ maxHeight: "52vh" }}>
          <table className="etbl">
            <thead><tr><th>Product</th><th className="r">Selling price</th><th className="r">Status</th><th style={{ width: 92 }} /></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td>{p.name_en}{p.name_ar ? <span className="ar" style={{ color: "rgb(var(--dim))", fontSize: 12 }}> · {p.name_ar}</span> : null}</td>
                  <td className="r">{p.selling_price != null ? egp(p.selling_price) : "—"}</td>
                  <td className="r"><button onClick={() => toggle.mutate({ id: p.id, active: !p.active })} className="pill2" style={{ cursor: "pointer", color: p.active ? "var(--green)" : "rgb(var(--faint))" }}>{p.active ? "active" : "off"}</button></td>
                  <td className="r" style={{ whiteSpace: "nowrap" }}>
                    <button className="addbtn" style={{ padding: "6px 10px" }} onClick={() => setEdit(p)}>Edit</button>
                    <button onClick={() => setDel(p)} title="Remove" style={{ marginLeft: 6, color: "rgb(var(--faint))", background: "none", border: "none", cursor: "pointer", fontSize: 13 }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 14 }}><button className="btn" onClick={() => setAdd(true)}>+ Add product</button></div>
      {(edit || add) && (
        <Modal open onClose={() => { setEdit(null); setAdd(false); }} title={edit ? "Edit product" : "Add product"}>
          <ProductForm product={edit ?? undefined} onDone={() => { setEdit(null); setAdd(false); qc.invalidateQueries(); }} />
        </Modal>
      )}
      <Confirm open={!!del} title="Remove this product?" danger busy={remove.isPending}
        message="It's removed from the catalog. Sales history that referenced it is kept." confirmLabel="Remove"
        onConfirm={() => del && remove.mutate(del.id)} onClose={() => setDel(null)} />
    </div>
  );
}

// ── Sales — Command Deck layout (identical to the design), all-time ──────────
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

const SIGCOLOR: Record<DaySignal, string> = { green: "var(--green)", yellow: "var(--amber)", red: "var(--red)" };
function DayDot({ sig }: { sig: DaySignal }) {
  return <span title={DAY_SIGNAL_LABEL[sig]} style={{ display: "inline-block", width: 8, height: 8, borderRadius: 99, marginRight: 9, verticalAlign: "middle", background: SIGCOLOR[sig], flexShrink: 0 }} />;
}

export function SalesScreen() {
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<SaleRowVM | null>(null);
  const all = useQuery({ queryKey: ["salesAll"], queryFn: () => getRecentSales(3000, { from: "2024-01-01", to: todayCairo() }), enabled: isEngineConfigured });
  const rows = all.data ?? [];

  const d = useMemo(() => {
    const lifetime = rows.reduce((s, r) => s + r.total, 0);
    const days = rows.length;
    const bucket = new Map<string, number>();
    for (const r of rows) bucket.set(r.date.slice(0, 7), (bucket.get(r.date.slice(0, 7)) ?? 0) + r.total);
    const monthly = [...bucket.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([m, v]) => ({ label: MONTHS[Number(m.slice(5, 7)) - 1].slice(0, 3), full: mName(m), value: v }));
    const best = [...bucket.entries()].reduce((b, e) => (e[1] > b[1] ? e : b), ["", 0] as [string, number]);
    const wsum = [0, 0, 0, 0, 0, 0, 0], wcnt = [0, 0, 0, 0, 0, 0, 0];
    for (const r of rows) { const w = new Date(r.date + "T00:00:00").getDay(); wsum[w] += r.total; wcnt[w]++; }
    const weekday = wsum.map((s, i) => ({ label: WD[i], full: `${WD[i]} average`, value: wcnt[i] ? Math.round(s / wcnt[i]) : 0 }));
    return { lifetime, days, avgDay: days ? lifetime / days : 0, monthly, best, weekday, span: rows.length ? `${mName(rows[rows.length - 1].date.slice(0, 7))} – ${mName(rows[0].date.slice(0, 7))}` : "" };
  }, [rows]);

  return (
    <div>
      <PageHdr title="Sales" sub={`Revenue = sum of daily totals (canonical)${d.span ? ` · ${d.span}` : ""}`}
        right={<>
          <button className="addbtn" onClick={() => navigate("/sales/import")}>Import receipt</button>
          <button className="qadd" style={{ height: 38 }} onClick={() => setAddOpen(true)}><span>+ New sale</span></button>
        </>} />

      {!isEngineConfigured ? <ConnectPanel /> : all.isError ? <ErrorState message={String((all.error as Error)?.message ?? "Read failed")} /> : all.isLoading ? <SkeletonRows rows={6} /> : (
        <>
          <div className="statgrid">
            <Stat label="Lifetime revenue" value={egp(d.lifetime)} color="var(--mag)" />
            <Stat label="Trading days" value={d.days} color="rgb(var(--violet))" />
            <Stat label="Avg / day" value={egp(d.avgDay)} color="rgb(var(--cyan))" />
            <Stat label="Best month" value={egp(d.best[1])} color="var(--green)" />
          </div>

          <div className="row2">
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <DeckTile><TileHead name="Monthly revenue" right={`${d.monthly.length} months`} /><div style={{ marginTop: 12 }}><BarChart data={d.monthly} height={210} /></div></DeckTile>
              <DeckTile><TileHead name="Average revenue by weekday" right="all-time" /><div style={{ marginTop: 12 }}><BarChart data={d.weekday} height={170} color="rgb(var(--good))" /></div></DeckTile>
            </div>
            <DeckTile style={{ padding: 0 }}>
              <div style={{ padding: "22px 24px 6px", display: "flex", alignItems: "center", gap: 8 }}>
                <span className="tname">Daily sales</span>
                <button className="addbtn" style={{ marginLeft: "auto" }} onClick={() => setAddOpen(true)}>+ New sale</button>
              </div>
              <div style={{ padding: "0 24px 12px", display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, color: "rgb(var(--dim))" }}>
                <span><DayDot sig="green" />complete</span>
                <span><DayDot sig="yellow" />total only</span>
                <span><DayDot sig="red" />doesn’t reconcile</span>
              </div>
              <div className="scroll" style={{ maxHeight: 590 }}>
                <table className="tbl">
                  <thead><tr><th>Date</th><th className="r">Revenue</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="daycell" onClick={() => setDetail(r)}>
                        <td><DayDot sig={daySignal(r)} />{fmtDate(r.date, "EEE d MMM yyyy")}</td>
                        <td className="r">{egp(r.total)}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={2} style={{ textAlign: "center", color: "rgb(var(--faint))", padding: 28 }}>No sales recorded yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </DeckTile>
          </div>
        </>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="New sale day" wide><SaleForm onDone={() => setAddOpen(false)} /></Modal>
      {detail && <Modal open onClose={() => setDetail(null)} title={`Sale · ${fmtDate(detail.date)}`}><SaleDetail sale={detail} onClose={() => setDetail(null)} /></Modal>}
    </div>
  );
}

function SaleDetail({ sale, onClose }: { sale: SaleRowVM; onClose: () => void }) {
  const { reportSuccess, reportError } = useUI();
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ["saleItems", sale.id], queryFn: () => getSaleItems(sale.id), enabled: isEngineConfigured });
  const [addLine, setAddLine] = useState(false);
  const [editItem, setEditItem] = useState<SaleLine | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "line"; item: SaleLine } | { kind: "day" }>(null);

  const refresh = () => { qc.invalidateQueries(); items.refetch(); };
  const voidLine = useMutation({ mutationFn: (id: string) => voidSaleItem(id), onSuccess: () => { reportSuccess("Void sale line", "Line voided · stock restored"); setConfirm(null); refresh(); }, onError: (e) => reportError("Void sale line", e) });
  const voidDay = useMutation({ mutationFn: () => voidSale(sale.id), onSuccess: () => { reportSuccess("Void sale day", "Sale day voided · all stock movements reversed · revenue removed"); setConfirm(null); onClose(); qc.invalidateQueries(); }, onError: (e) => reportError("Void sale day", e) });

  const lineSum = (items.data ?? []).reduce((a, l) => a + l.lineTotal, 0);
  const missingCogs = (items.data ?? []).filter((l) => l.productId && !l.hasCogs).length;
  const diff = sale.total - lineSum;
  const ok = Math.abs(diff) < 1;
  const lines = items.data ?? [];

  return (
    <div className="space-y-4">
      {/* summary + reconciliation */}
      <div style={{ display: "flex", alignItems: "center", gap: 26, flexWrap: "wrap" }}>
        <div><div style={{ fontSize: 11, color: "rgb(var(--dim))", fontWeight: 600 }}>Day total</div><div className="disp" style={{ fontWeight: 700, fontSize: 22, letterSpacing: "-.01em" }}>{egp(sale.total)}</div></div>
        <div><div style={{ fontSize: 11, color: "rgb(var(--dim))", fontWeight: 600 }}>Breakdown</div><div className="disp" style={{ fontWeight: 700, fontSize: 22, letterSpacing: "-.01em" }}>{egp(lineSum)}</div></div>
        <span className="recon" style={{ marginLeft: "auto", color: ok ? "var(--green)" : "var(--amber)", background: ok ? "rgba(66,226,154,.13)" : "rgba(255,177,62,.12)" }}>
          {ok ? "reconciled" : diff > 0 ? `${egp(diff)} unallocated` : `${egp(-diff)} over`}
        </span>
      </div>
      {missingCogs > 0 && <div className="note" style={{ fontSize: 12.5 }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg><div>{missingCogs} line(s) have no cost yet — add a purchase for those products so profit is exact.</div></div>}

      {/* editable product table */}
      {items.isLoading ? <SkeletonRows rows={3} /> : (
        <div className="scroll" style={{ overflowX: "auto" }}>
        <table className="etbl">
          <thead><tr><th>Product</th><th className="r">Qty sold</th><th className="r">Unit price</th><th className="r">Amount</th><th style={{ width: 74 }} /></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td>{l.name}{!l.hasCogs && <span style={{ color: "var(--amber)", fontSize: 11 }}> · no cost</span>}</td>
                <td className="r">{num(l.qty)}</td>
                <td className="r">{egp(l.unitPrice ?? 0)}</td>
                <td className="r">{egp(l.lineTotal)}</td>
                <td className="r" style={{ whiteSpace: "nowrap" }}>
                  <button onClick={() => setEditItem(l)} title="Edit" style={{ color: "rgb(var(--dim))", background: "none", border: "none", cursor: "pointer", fontSize: 13 }}>✎</button>
                  <button onClick={() => setConfirm({ kind: "line", item: l })} title="Void" style={{ color: "rgb(var(--faint))", background: "none", border: "none", cursor: "pointer", fontSize: 13, marginLeft: 6 }}>✕</button>
                </td>
              </tr>
            ))}
            {lines.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "rgb(var(--dim))", padding: "22px 12px" }}>No product lines yet — add what sold below to deduct stock &amp; track profit.</td></tr>}
          </tbody>
        </table>
        </div>
      )}

      {/* add line */}
      {addLine ? (
        <div style={{ border: "1px solid var(--stroke)", borderRadius: 14, padding: 16, background: "rgba(255,255,255,.02)" }}><SaleItemForm saleId={sale.id} onDone={() => { setAddLine(false); refresh(); }} /></div>
      ) : (
        <button className="addbtn" style={{ width: "100%", justifyContent: "center", padding: "12px" }} onClick={() => setAddLine(true)}>+ Add product line</button>
      )}

      <div style={{ borderTop: "1px solid var(--stroke2)", paddingTop: 12, textAlign: "center" }}>
        <button onClick={() => setConfirm({ kind: "day" })} style={{ fontSize: 12, color: "var(--red)", background: "none", border: "none", cursor: "pointer" }}>Void this whole sale day</button>
      </div>

      {editItem && <Modal open onClose={() => setEditItem(null)} title="Edit line"><SaleItemForm saleId={sale.id} item={editItem} onDone={() => { setEditItem(null); refresh(); }} /></Modal>}
      <Confirm open={confirm?.kind === "line"} title="Void this line?" danger busy={voidLine.isPending}
        message="This restores the product's stock and removes the line. The day's revenue total is unchanged." confirmLabel="Void line"
        onConfirm={() => confirm?.kind === "line" && voidLine.mutate(confirm.item.id)} onClose={() => setConfirm(null)} />
      <Confirm open={confirm?.kind === "day"} title="Void the whole sale day?" danger busy={voidDay.isPending}
        message="This voids the day's sale and reverses every inventory movement it created. It's reversible only by re-entering the day." confirmLabel="Void day"
        onConfirm={() => voidDay.mutate()} onClose={() => setConfirm(null)} />
    </div>
  );
}

// ── Purchases ─────────────────────────────────────────────────────────────────
export function PurchasesScreen() {
  const range = useActiveRange();
  const [addOpen, setAddOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const prods = useQuery({ queryKey: ["products-list"], queryFn: getProducts, enabled: isEngineConfigured });
  const q = useQuery({ queryKey: ["purchases", range], queryFn: () => getPurchases(range), enabled: isEngineConfigured });
  const inv = useQuery({ queryKey: ["inv-purchases", range], queryFn: () => getInventoryPurchases(range), enabled: isEngineConfigured });
  const rows = (q.data ?? []).filter((r) => !productId || r.productId === productId);
  // lump historical stock buys (no per-product detail) only show in the unfiltered view
  const lump = productId ? [] : (inv.data ?? []);
  const filteredTotal = rows.reduce((s, r) => s + r.totalCost, 0) + lump.reduce((s, r) => s + r.totalCost, 0);
  const entries = rows.length + lump.length;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <DateRangePicker />
        <Select value={productId} onChange={(e) => setProductId(e.target.value)} className="max-w-xs">
          <option value="">All products</option>
          {(prods.data ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name_en}</option>)}
        </Select>
        {productId && <button className="addbtn" onClick={() => setProductId("")}>Clear</button>}
        <div style={{ flex: 1 }} />
        <button className="qadd" style={{ height: 38 }} onClick={() => setAddOpen(true)}><span>+ Add purchase</span></button>
      </div>
      <div className="statgrid c3">
        <Stat label={productId ? "Spend · filtered" : "Stock spend · range"} color="var(--amber)" value={egp(filteredTotal)} />
        <Stat label="Entries" color="rgb(var(--cyan))" value={entries} sub={lump.length ? <div style={{ fontSize: 11, color: "rgb(var(--dim))", fontWeight: 600, marginTop: 8 }}>{lump.length} historical</div> : undefined} />
        <Stat label="Avg / entry" color="rgb(var(--violet))" value={entries ? egp(filteredTotal / entries) : "—"} />
      </div>
      <Guarded q={q} empty={entries === 0}>
        <DeckTile style={{ padding: 0 }}>
          <div className="scroll">
            <table className="tbl">
              <thead><tr><th>Product</th><th>Date</th><th className="r">Qty × cost</th><th className="r">Total</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="prodcell" onClick={() => setDetailId(r.productId)}>
                    <td>{r.productName}</td>
                    <td>{fmtDate(r.date, "d MMM yyyy")}</td>
                    <td className="r">{num(r.quantity)} × {egp(r.unitCost)}</td>
                    <td className="r">{egp(r.totalCost)}</td>
                  </tr>
                ))}
                {lump.map((r) => (
                  <tr key={r.id}>
                    <td>{r.note}</td>
                    <td>{fmtDate(r.date, "d MMM yyyy")}</td>
                    <td className="r" style={{ color: "rgb(var(--dim))" }}>no breakdown</td>
                    <td className="r">{egp(r.totalCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DeckTile>
      </Guarded>
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add purchase"><PurchaseForm onDone={() => setAddOpen(false)} /></Modal>
      <Modal open={!!detailId} onClose={() => setDetailId(null)} wide>{detailId && <ProductDetailScreen id={detailId} onClose={() => setDetailId(null)} />}</Modal>
    </div>
  );
}

// ── Reconcile / P&L (read-derived) ────────────────────────────────────────────
export function ReconcileScreen() {
  const range = useActiveRange();
  const key = useFilters((s) => s.rangeKey);
  const accStart = useBooksStartDate();
  const q = useQuery({ queryKey: ["profit", range, accStart], queryFn: () => getProfitReadout(range, accStart), enabled: isEngineConfigured });
  const p = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>Profit · {rangeLabel(key, range)}</Eyebrow>
        <DateRangePicker />
      </div>
      {p?.partialBefore && <PartialNote since={p.partialBefore} />}
      {!isEngineConfigured ? <ConnectPanel /> : q.isError ? <ErrorState message={String((q.error as Error)?.message)} /> : (
        <>
          <Card glow>
            <Eyebrow>Net profit · after costs &amp; expenses</Eyebrow>
            <div className="mt-1 flex flex-wrap items-end gap-3">
              <div className="tnum font-display text-5xl font-extrabold leading-none text-text">
                {p ? (p.netProfit == null ? "unknown" : egp(p.netProfit)) : "—"}
              </div>
              {p && p.netMargin != null && <Badge tone={p.netMargin >= 0 ? "good" : "bad"}>{pct(p.netMargin)} net margin</Badge>}
            </div>
            <div className="mt-6 space-y-3">
              <Bar label="Revenue" amount={p ? egp(p.revenue) : "—"} pctWidth={100} tone="bg-good" />
              <Bar label="− Cost of goods" amount={p ? egp(p.cogs) : "—"} pctWidth={p && p.revenue > 0 ? (p.cogs / p.revenue) * 100 : 0} tone="bg-bad/70" />
              <Bar label="= Gross profit" amount={p ? (p.grossProfit == null ? "unknown" : egp(p.grossProfit)) : "—"}
                pctWidth={p && p.revenue > 0 && p.grossProfit != null ? Math.max(0, (p.grossProfit / p.revenue) * 100) : 0} tone="bg-pink/60" />
              <Bar label="− Operating expenses" amount={p ? egp(p.operatingExpenses) : "—"} pctWidth={p && p.revenue > 0 ? (p.operatingExpenses / p.revenue) * 100 : 0} tone="bg-warn/70" />
              <Bar label="= Net profit" amount={p ? (p.netProfit == null ? "unknown" : egp(p.netProfit)) : "—"}
                pctWidth={p && p.revenue > 0 && p.netProfit != null ? Math.max(0, (p.netProfit / p.revenue) * 100) : 0} tone="bg-pink" strong />
            </div>
            {p && p.grossProfit != null && (
              <div className="mt-4 text-[11px] text-dim">
                Gross margin {p.margin != null ? pct(p.margin) : "—"} · personal withdrawals are tracked as cash, never counted as expenses here.
              </div>
            )}
          </Card>
          {p && !p.complete && (
            <Card>
              <div className="space-y-1 text-sm text-warn">
                <div>⚠ Whole-period profit withheld — revenue is exact, but COGS is incomplete, so we show “unknown” rather than a wrong number.</div>
                {p.missingCostLines > 0 && <div>· {p.missingCostLines} of {p.soldLines} sold lines have no recorded cost.</div>}
                {p.uncoveredRevenue >= 1 && (
                  <div>· {egp(p.uncoveredRevenue)} of revenue ({p.coveredPct != null ? pct(100 - p.coveredPct) : "—"}) sits on days with no product-line detail — its cost is unknowable until those days are imported.</div>
                )}
                {p.margin != null && <div className="text-dim">Measured gross margin on the {p.coveredPct != null ? pct(p.coveredPct) : "—"} of revenue with detail: {pct(p.margin)}.</div>}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Bar({ label, amount, pctWidth, tone, strong }: { label: string; amount: string; pctWidth: number; tone: string; strong?: boolean }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className={`text-xs ${strong ? "font-display font-semibold text-text" : "text-muted"}`}>{label}</span>
        <span className={`font-display text-sm font-semibold ${strong ? "text-pink" : "text-text"}`}>{amount}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-panel2">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, pctWidth))}%`, transition: "width .5s ease" }} />
      </div>
    </div>
  );
}
