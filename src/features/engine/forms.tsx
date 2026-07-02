import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Field, Input, Select } from "@/components/ui";
import { useUI } from "@/store/ui";
import { todayCairo } from "@/core/time";
import { egp } from "@/core/utils/format";
import { getProducts, getLocations, getChannels } from "@/core/read/common";
import { getExpenseCategories } from "@/core/read/expenses";
import { getMoneyAccounts } from "@/core/read/money";
import { ProductPicker } from "@/components/ProductPicker";
import type { Tables, Enums } from "@/core/db/tables";
import type { SaleLine } from "@/core/read/sales";
import {
  createProduct, updateProduct, deleteProduct, addPurchase, createSale, addSaleItem, editSaleItem,
  addExpense, ensureExpenseCategory, createMovement, recordWithdrawal, recordCashCount, recordCheque,
  openSettlementPeriod, type ProductInput,
} from "@/core/db/mutations";

/** Write helper bound to a context label, so successes/errors are logged to the
 *  in-app diagnostics feed with what changed and copyable error details. */
function useWrite(context: string, onDone?: () => void) {
  const qc = useQueryClient();
  const { reportSuccess, reportError } = useUI();
  return {
    ok(msg: string) { qc.invalidateQueries(); reportSuccess(context, msg); onDone?.(); },
    fail(e: unknown) { reportError(context, e); },
  };
}

const num = (s: string): number | null => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };
const r2 = (n: number) => Math.round(n * 100) / 100;

/* ─ Product create / edit ──────────────────────────────────────────────── */
export function ProductForm({ product, onDone }: { product?: Tables<"products">; onDone?: () => void }) {
  const w = useWrite(product ? "Edit product" : "Add product", onDone);
  const [nameEn, setNameEn] = useState(product?.name_en ?? "");
  const [nameAr, setNameAr] = useState(product?.name_ar ?? "");
  const [unitType, setUnitType] = useState<"weight" | "count">((product?.unit_type as "weight" | "count") ?? "weight");
  const [baseUnit, setBaseUnit] = useState(product?.base_unit ?? "g");
  const [saleUnit, setSaleUnit] = useState(product?.sale_unit ?? "kg");
  const [price, setPrice] = useState(product?.selling_price != null ? String(product.selling_price) : "");
  const [low, setLow] = useState(product?.low_stock_threshold != null ? String(product.low_stock_threshold) : "");
  const [refCost, setRefCost] = useState(product?.reference_cost != null ? String(product.reference_cost) : "");
  const [active, setActive] = useState(product?.active ?? true);

  const [confirmDel, setConfirmDel] = useState(false);
  const m = useMutation({
    mutationFn: () => {
      const input: ProductInput = {
        nameEn, nameAr: nameAr || null, unitType, baseUnit, saleUnit: saleUnit || null,
        sellingPrice: num(price), lowStock: num(low), active, referenceCost: num(refCost),
      };
      return product ? updateProduct(product.id, input).then(() => product.id) : createProduct(input);
    },
    onSuccess: () => w.ok(product ? `Updated "${nameEn.trim()}"` : `Added "${nameEn.trim()}" to Goods`),
    onError: w.fail,
  });
  const del = useMutation({
    mutationFn: () => deleteProduct(product!.id),
    onSuccess: () => w.ok(`Deleted "${product!.name_en}"`),
    onError: w.fail,
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!nameEn.trim()) return; m.mutate(); }} className="space-y-3">
      <Field label="Name (English)"><Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="Mixed nuts" required /></Field>
      <Field label="Name (Arabic / POS)"><Input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="مكسرات مشكلة" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Sold by"><Select value={unitType} onChange={(e) => setUnitType(e.target.value as "weight" | "count")}><option value="weight">Weight</option><option value="count">Count</option></Select></Field>
        <Field label="Sale unit"><Input value={saleUnit} onChange={(e) => setSaleUnit(e.target.value)} placeholder={unitType === "weight" ? "kg" : "piece"} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Base unit"><Input value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)} placeholder={unitType === "weight" ? "g" : "piece"} /></Field>
        <Field label="Sale price (EGP)"><Input type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Low-stock alert (base units)"><Input type="number" step="any" value={low} onChange={(e) => setLow(e.target.value)} /></Field>
        <Field label="Unit cost (EGP, COGS)"><Input type="number" step="any" value={refCost} onChange={(e) => setRefCost(e.target.value)} placeholder="cost / unit" /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
      <Button type="submit" disabled={m.isPending} className="w-full">{m.isPending ? "Saving…" : product ? "Save changes" : "Add product"}</Button>
      {product && (
        confirmDel ? (
          <div className="rounded-xl border border-bad/40 bg-bad/5 p-3 text-center">
            <div className="text-[13px] text-bad">Delete "{product.name_en}" permanently?</div>
            <div className="mt-1 text-[11px] text-dim">Only works if it has no purchase/sale history. Otherwise untick Active to retire it.</div>
            <div className="mt-2 flex gap-2">
              <Button type="button" variant="ghost" className="flex-1" onClick={() => setConfirmDel(false)}>Cancel</Button>
              <button type="button" disabled={del.isPending} onClick={() => del.mutate()} className="flex-1 rounded-xl bg-bad px-3 py-2 font-display text-sm font-semibold text-white disabled:opacity-60">{del.isPending ? "Deleting…" : "Delete"}</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDel(true)} className="w-full text-center text-xs text-bad hover:underline">Delete this product</button>
        )
      )}
    </form>
  );
}

/* ─ Purchase (stock-in + WAC via verified RPC) ─────────────────────────── */
export function PurchaseForm({ onDone }: { onDone?: () => void }) {
  const w = useWrite("Add purchase", onDone);
  const products = useQuery({ queryKey: ["products-list"], queryFn: getProducts });
  const locations = useQuery({ queryKey: ["locations"], queryFn: getLocations });
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState(todayCairo());

  const loc = locations.data?.[0];
  const m = useMutation({
    mutationFn: () => addPurchase({
      productId, quantity: num(qty) ?? 0, unitCost: num(unitCost) ?? 0,
      vendor: vendor || null, invoiceRef: vendor || null, date, locationId: loc!.id,
    }),
    onSuccess: () => {
      const unit = (products.data ?? []).find((p) => p.id === productId)?.base_unit ?? "units";
      w.ok(`Stock +${num(qty) ?? 0} ${unit} · weighted-average cost updated`);
    },
    onError: w.fail,
  });

  const ready = productId && (num(qty) ?? 0) > 0 && (num(unitCost) ?? 0) >= 0 && loc;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready) m.mutate(); }} className="space-y-3">
      {!loc && <div className="rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">No active location found — set one up in Supabase first.</div>}
      <Field label="Product">
        <ProductPicker value={productId} onChange={setProductId} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity (base units)"><Input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 5000 g" /></Field>
        <Field label="Unit cost (EGP / base unit)"><Input type="number" step="any" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Supplier / note"><Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Bebeto" /></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <p className="text-[11px] text-dim">Quantity is in base units ({(products.data ?? []).find((p) => p.id === productId)?.base_unit ?? "g"}). This increases stock and recomputes weighted-average cost.</p>
      {date < todayCairo() && <p className="rounded-lg bg-warn/10 px-3 py-2 text-[11px] text-warn">Backdated purchase — sales recorded <b>after</b> this date already captured their cost at the time and won't change. Going forward, weighted-average cost reflects this batch.</p>}
      <Button type="submit" disabled={!ready || m.isPending} className="w-full">{m.isPending ? "Saving…" : "Add purchase"}</Button>
    </form>
  );
}

/* ─ Sale: product-first day entry — pick items, price & totals auto-fill ── */
interface SaleLineDraft { key: number; productId: string; qty: string; price: string }
export function SaleForm({ onDone }: { onDone?: () => void }) {
  const w = useWrite("New sale day", onDone);
  const locations = useQuery({ queryKey: ["locations"], queryFn: getLocations });
  const channels = useQuery({ queryKey: ["channels"], queryFn: getChannels });
  const products = useQuery({ queryKey: ["products-list"], queryFn: getProducts });
  const priceOf = (id: string) => products.data?.find((p) => p.id === id)?.selling_price ?? null;

  const [date, setDate] = useState(todayCairo());
  const [lines, setLines] = useState<SaleLineDraft[]>([{ key: 1, productId: "", qty: "", price: "" }]);
  const [other, setOther] = useState(""); // sales not tied to a catalog product
  const nextKey = useRef(2);

  const loc = locations.data?.[0];
  const ch = channels.data?.[0];

  const setLine = (key: number, patch: Partial<SaleLineDraft>) => setLines((ls) => ls.map((l) => l.key === key ? { ...l, ...patch } : l));
  // picking a product seeds its sale price (only if the owner hasn't typed one)
  const pickProduct = (key: number, id: string) => {
    const p = priceOf(id);
    setLines((ls) => ls.map((l) => l.key === key ? { ...l, productId: id, price: l.price || (p != null ? String(p) : "") } : l));
  };
  const addLine = () => setLines((ls) => [...ls, { key: nextKey.current++, productId: "", qty: "", price: "" }]);
  const removeLine = (key: number) => setLines((ls) => ls.length > 1 ? ls.filter((l) => l.key !== key) : ls);

  const lineTotal = (l: SaleLineDraft) => (num(l.qty) ?? 0) * (num(l.price) ?? 0);
  const validLines = lines.filter((l) => l.productId && (num(l.qty) ?? 0) > 0);
  const otherNum = num(other) ?? 0;
  const dayTotal = Math.round((validLines.reduce((s, l) => s + lineTotal(l), 0) + otherNum) * 100) / 100;

  const m = useMutation({
    mutationFn: async () => {
      if (!loc || !ch) throw new Error("No active location/channel.");
      const saleId = await createSale({ date, total: dayTotal, locationId: loc.id, channelId: ch.id });
      let added = 0, failed = 0;
      for (const l of validLines) {
        try {
          await addSaleItem({ saleId, productId: l.productId, qty: num(l.qty) ?? 0, unitPrice: num(l.price) ?? 0, lineTotal: Math.round(lineTotal(l) * 100) / 100, notes: null });
          added++;
        } catch { failed++; }
      }
      return { added, failed };
    },
    onSuccess: (res) => w.ok(`Sale day saved · ${egp(dayTotal)} · ${res.added} product line${res.added === 1 ? "" : "s"}${res.failed ? ` · ${res.failed} failed` : ""}`),
    onError: w.fail,
  });

  const ready = !!loc && !!ch && !!date && (validLines.length > 0 || otherNum > 0);
  const cellInput = "w-full rounded-lg border border-transparent bg-transparent px-2 py-2 text-right text-sm tnum text-text outline-none transition placeholder:text-faint focus:border-pink/40 focus:bg-white/[0.04]";
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready) m.mutate(); }} className="space-y-4">
      {(!loc || !ch) && <div className="rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">No active location/channel found — set one up in Supabase first.</div>}

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-dim">Date</div>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="!w-48" />
        </div>
        <div className="ml-auto text-right">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-dim">Day total</div>
          <div className="tnum font-display text-2xl font-extrabold text-text">{egp(dayTotal)}</div>
        </div>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-dim">Products sold</div>
        <div className="rounded-2xl border border-line">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line text-[10.5px] uppercase tracking-wider text-dim">
                <th className="px-3 py-2.5 text-left font-bold">Product</th>
                <th className="w-[84px] px-2 py-2.5 text-right font-bold">Qty</th>
                <th className="w-[110px] px-2 py-2.5 text-right font-bold">Unit price</th>
                <th className="w-[120px] px-3 py-2.5 text-right font-bold">Line total</th>
                <th className="w-9" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className="border-b border-line/50 last:border-0">
                  <td className="px-1.5 py-1"><ProductPicker bare value={l.productId} onChange={(id) => pickProduct(l.key, id)} /></td>
                  <td className="px-1 py-1"><input inputMode="decimal" placeholder="0" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} className={cellInput} /></td>
                  <td className="px-1 py-1"><input inputMode="decimal" placeholder="0" value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} className={cellInput} /></td>
                  <td className="px-3 py-1 text-right tnum text-sm font-semibold text-text">{lineTotal(l) > 0 ? egp(lineTotal(l)) : <span className="text-faint">—</span>}</td>
                  <td className="px-1 py-1 text-center">
                    {lines.length > 1 && <button type="button" onClick={() => removeLine(l.key)} className="text-dim transition hover:text-bad" title="Remove row">✕</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={addLine} className="row-hover flex w-full items-center gap-2 rounded-b-2xl border-t border-line px-3 py-2.5 text-left text-[13px] font-semibold text-pink">
            <span className="text-base leading-none">＋</span> Add product row
          </button>
        </div>
      </div>

      <Field label="Other / untracked sales (optional)"><Input inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value)} placeholder="lump EGP for items not in your catalog" /></Field>

      <p className="text-[11px] text-dim">Pick a product, type quantity — price auto-fills and totals add up. Each row deducts stock and captures cost (COGS).</p>
      <Button type="submit" disabled={!ready || m.isPending} className="w-full">{m.isPending ? "Saving…" : `Save sale day · ${egp(dayTotal)}`}</Button>
    </form>
  );
}

/* ─ Sale line: add or edit a product line (deducts stock + COGS) ────────── */
export function SaleItemForm({ saleId, item, onDone }: { saleId: string; item?: SaleLine; onDone?: () => void }) {
  const w = useWrite(item ? "Edit sale line" : "Add sale line", onDone);
  const products = useQuery({ queryKey: ["products-list"], queryFn: getProducts });
  const [productId, setProductId] = useState(item?.productId ?? "");
  const [qty, setQty] = useState(item ? String(item.qty) : "");
  const [price, setPrice] = useState(item?.unitPrice != null ? String(item.unitPrice) : "");
  const [lineTotal, setLineTotal] = useState(item ? String(item.lineTotal) : "");
  // seed sale price from the product when none was typed yet
  const onPickProduct = (id: string) => {
    setProductId(id);
    if (!price) { const p = products.data?.find((x) => x.id === id)?.selling_price; if (p != null) setPrice(String(p)); }
  };

  const computed = (num(qty) ?? 0) * (num(price) ?? 0);
  const m = useMutation({
    mutationFn: () => {
      const payload = { productId, qty: num(qty) ?? 0, unitPrice: num(price) ?? 0, lineTotal: num(lineTotal) ?? r2(computed), notes: null };
      return item ? editSaleItem(item.id, payload) : addSaleItem({ saleId, ...payload });
    },
    onSuccess: () => w.ok(item
      ? `Line updated to ${num(qty) ?? 0} units · stock reversed & reapplied · COGS recaptured`
      : `Stock −${num(qty) ?? 0} units · COGS captured at current cost`),
    onError: w.fail,
  });
  const ready = !!productId && (num(qty) ?? 0) > 0;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready) m.mutate(); }} className="space-y-3">
      <Field label="Product">
        <ProductPicker value={productId} onChange={onPickProduct} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity (base units)"><Input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Unit price"><Input type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
      </div>
      <Field label={`Line total (EGP)${computed ? ` · auto ${r2(computed).toFixed(2)}` : ""}`}>
        <Input type="number" step="any" value={lineTotal} onChange={(e) => setLineTotal(e.target.value)} placeholder={computed ? r2(computed).toFixed(2) : ""} />
      </Field>
      <Button type="submit" disabled={!ready || m.isPending} className="w-full">{m.isPending ? "Saving…" : item ? "Save line" : "Add line"}</Button>
    </form>
  );
}

/* ─ Expense (operating ledger; withdrawals are NOT expenses) ────────────── */
const PAYMENTS: Enums<"payment_method">[] = ["cash", "cheque", "card", "transfer", "credit", "unknown"];
export function ExpenseForm({ onDone }: { onDone?: () => void }) {
  const w = useWrite("Add expense", onDone);
  const cats = useQuery({ queryKey: ["expense-cats"], queryFn: getExpenseCategories });
  const locations = useQuery({ queryKey: ["locations"], queryFn: getLocations });
  const [date, setDate] = useState(todayCairo());
  const [categoryId, setCategoryId] = useState("");
  const [newCat, setNewCat] = useState("");
  const [newCatOperating, setNewCatOperating] = useState(true); // false = inventory / cost-of-goods
  const [amount, setAmount] = useState("");
  const [pay, setPay] = useState<Enums<"payment_method">>("cash");
  const [notes, setNotes] = useState("");
  const loc = locations.data?.[0];
  const m = useMutation({
    mutationFn: async () => {
      const catId = categoryId || (newCat.trim() ? await ensureExpenseCategory(newCat, newCatOperating) : "");
      if (!catId) throw new Error("Pick or name a category.");
      return addExpense({ date, categoryId: catId, amount: num(amount) ?? 0, paymentMethod: pay, notes: notes || null, locationId: loc!.id });
    },
    onSuccess: () => w.ok(`Expense ${egp(num(amount) ?? 0)} recorded · reduces profit (not cash)`), onError: w.fail,
  });
  const ready = !!loc && !!date && (num(amount) ?? 0) > 0 && (categoryId || newCat.trim());
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready) m.mutate(); }} className="space-y-3">
      {!loc && <div className="rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">No active location found.</div>}
      <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Category">
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">{cats.data?.length ? "Select…" : "No categories yet"}</option>
          {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      {!categoryId && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="…or new category"><Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Rent" /></Field>
          <Field label="Type"><Select value={newCatOperating ? "op" : "inv"} onChange={(e) => setNewCatOperating(e.target.value === "op")}><option value="op">Operating cost</option><option value="inv">Inventory (cost of goods)</option></Select></Field>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (EGP)"><Input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Payment"><Select value={pay} onChange={(e) => setPay(e.target.value as Enums<"payment_method">)}>{PAYMENTS.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
      </div>
      <Field label="Note"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
      <p className="text-[11px] text-dim">Operating expense. For owner cash taken out, use <b>Withdraw</b> on the Cash screen — that's a cash movement, never an expense.</p>
      <Button type="submit" disabled={!ready || m.isPending} className="w-full">{m.isPending ? "Saving…" : "Add expense"}</Button>
    </form>
  );
}

/* ─ Cash: movement (in / out / withdraw) and physical count ────────────── */
type CashMode = "in" | "out" | "withdraw" | "count";
export function CashForm({ mode, onDone }: { mode: CashMode; onDone?: () => void }) {
  const ctx = mode === "count" ? "Cash count" : mode === "withdraw" ? "Withdrawal" : mode === "in" ? "Cash in" : "Cash out";
  const w = useWrite(ctx, onDone);
  const accounts = useQuery({ queryKey: ["money-accounts"], queryFn: getMoneyAccounts });
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayCairo());
  const [notes, setNotes] = useState("");
  const acc = accounts.data?.[0];
  const m = useMutation({
    mutationFn: async () => {
      const amt = num(amount) ?? 0;
      if (mode === "count") return recordCashCount(acc!.id, amt, date, notes || null); // returns difference
      if (mode === "withdraw") { await recordWithdrawal(acc!.id, amt, date, notes || null); return null; }
      await createMovement({ accountId: acc!.id, type: mode === "in" ? "owner_injection" : "cash_expense", amount: amt, date, notes: notes || null });
      return null;
    },
    onSuccess: (diff) => {
      const amt = num(amount) ?? 0;
      if (mode === "count") w.ok(diff === 0 ? "Cash count matched expected · balance confirmed" : `Cash count saved · adjustment ${egp(diff ?? 0)} posted to match reality`);
      else if (mode === "withdraw") w.ok(`Cash −${egp(amt)} · balance recalculated · profit unaffected (not an expense)`);
      else if (mode === "in") w.ok(`Cash +${egp(amt)} · balance recalculated · profit unaffected`);
      else w.ok(`Cash −${egp(amt)} · balance recalculated · profit unaffected`);
    },
    onError: w.fail,
  });
  const label = mode === "count" ? "Counted cash (actual)" : mode === "in" ? "Cash in — amount (EGP)" : mode === "out" ? "Cash out — amount (EGP)" : "Withdrawal — amount (EGP)";
  const ready = !!acc && (num(amount) ?? -1) >= 0 && (mode === "count" || (num(amount) ?? 0) > 0);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready) m.mutate(); }} className="space-y-3">
      {!acc && <div className="rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">No cash account found.</div>}
      <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label={label}><Input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Note"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
      {mode === "in" && <p className="text-[11px] text-dim">Cash entering the drawer (owner top-up, change float). Affects cash only — never counted as revenue.</p>}
      {mode === "out" && <p className="rounded-lg bg-warn/10 px-3 py-2 text-[11px] text-warn">Cash leaving the drawer <b>only</b> — a deposit, transfer, or change. This does <b>not</b> affect profit. To record a business cost that should reduce profit, use <b>Spend → Add expense</b> instead.</p>}
      {mode === "withdraw" && <p className="rounded-lg bg-warn/10 px-3 py-2 text-[11px] text-warn">Owner taking cash out. Reduces cash <b>only</b> — never counted against profit and never an expense.</p>}
      {mode === "count" && <p className="text-[11px] text-dim">We compare to the expected balance and post a voidable adjustment for any difference.</p>}
      <Button type="submit" disabled={!ready || m.isPending} className="w-full">{m.isPending ? "Saving…" : mode === "count" ? "Save count" : "Save"}</Button>
    </form>
  );
}

/* ─ Cheque: record a received cheque — closes the running sales tab, counts as
 *  cash in. No "period" to pick: it's auto-matched to its month + cross-
 *  referenced to your sales for coverage. ── */
export function ChequeForm({ onDone }: { onDone?: () => void }) {
  const w = useWrite("Record cheque", onDone);
  const locations = useQuery({ queryKey: ["locations"], queryFn: getLocations });
  const [date, setDate] = useState(todayCairo());
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const m = useMutation({
    mutationFn: async () => {
      const loc = locations.data?.[0];
      if (!loc) throw new Error("No active location.");
      const monthStart = date.slice(0, 8) + "01";
      // idempotent: creates (or finds) the month's period and returns its id
      const periodId = await openSettlementPeriod(loc.id, monthStart);
      const amt = num(amount) ?? 0;
      return recordCheque({ periodId, expected: amt, received: amt, receivedDate: date, status: "reconciled", notes: notes || null });
    },
    onSuccess: () => w.ok(`Cheque recorded · ${egp(num(amount) ?? 0)} cashed · sales tab closed`), onError: w.fail,
  });
  const ready = (num(amount) ?? 0) > 0 && !!date && !!locations.data?.length;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready) m.mutate(); }} className="space-y-3">
      <Field label="Date received"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Amount cashed (EGP)"><Input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 65000" /></Field>
      <Field label="Note"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
      <p className="text-[11px] text-dim">Closes the open sales tab up to this date and counts as cash in. Coverage is matched to your sales automatically.</p>
      <Button type="submit" disabled={!ready || m.isPending} className="w-full">{m.isPending ? "Saving…" : "Record cheque"}</Button>
    </form>
  );
}
