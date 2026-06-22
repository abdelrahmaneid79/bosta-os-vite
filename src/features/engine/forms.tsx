import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Field, Input, Select } from "@/components/ui";
import { useUI } from "@/store/ui";
import { todayCairo } from "@/core/time";
import { getProducts, getLocations, getChannels } from "@/core/read/common";
import type { Tables } from "@/core/db/tables";
import type { SaleLine } from "@/core/read/sales";
import {
  createProduct, updateProduct, addPurchase, createSale, addSaleItem, editSaleItem,
  type ProductInput,
} from "@/core/db/mutations";

function useWrite(onDone?: () => void) {
  const qc = useQueryClient();
  const { toast } = useUI();
  return {
    ok(msg: string) { qc.invalidateQueries(); toast(msg, "success"); onDone?.(); },
    fail(e: unknown) { toast(e instanceof Error ? e.message : "Save failed", "error"); },
  };
}

const num = (s: string): number | null => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };

/* ─ Product create / edit ──────────────────────────────────────────────── */
export function ProductForm({ product, onDone }: { product?: Tables<"products">; onDone?: () => void }) {
  const w = useWrite(onDone);
  const [nameEn, setNameEn] = useState(product?.name_en ?? "");
  const [nameAr, setNameAr] = useState(product?.name_ar ?? "");
  const [unitType, setUnitType] = useState<"weight" | "count">((product?.unit_type as "weight" | "count") ?? "weight");
  const [baseUnit, setBaseUnit] = useState(product?.base_unit ?? "g");
  const [saleUnit, setSaleUnit] = useState(product?.sale_unit ?? "kg");
  const [price, setPrice] = useState(product?.selling_price != null ? String(product.selling_price) : "");
  const [low, setLow] = useState(product?.low_stock_threshold != null ? String(product.low_stock_threshold) : "");
  const [active, setActive] = useState(product?.active ?? true);

  const m = useMutation({
    mutationFn: () => {
      const input: ProductInput = {
        nameEn, nameAr: nameAr || null, unitType, baseUnit, saleUnit: saleUnit || null,
        sellingPrice: num(price), lowStock: num(low), active,
      };
      return product ? updateProduct(product.id, input).then(() => product.id) : createProduct(input);
    },
    onSuccess: () => w.ok(product ? "Product updated" : "Product added"),
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
        <label className="flex items-center gap-2 pt-7 text-sm text-muted"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
      </div>
      <Button type="submit" disabled={m.isPending} className="w-full">{m.isPending ? "Saving…" : product ? "Save changes" : "Add product"}</Button>
    </form>
  );
}

/* ─ Purchase (stock-in + WAC via verified RPC) ─────────────────────────── */
export function PurchaseForm({ onDone }: { onDone?: () => void }) {
  const w = useWrite(onDone);
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
    onSuccess: () => w.ok("Purchase added · stock & cost updated"),
    onError: w.fail,
  });

  const ready = productId && (num(qty) ?? 0) > 0 && (num(unitCost) ?? 0) >= 0 && loc;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready) m.mutate(); }} className="space-y-3">
      {!loc && <div className="rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">No active location found — set one up in Supabase first.</div>}
      <Field label="Product">
        <Select value={productId} onChange={(e) => setProductId(e.target.value)} required>
          <option value="">Select a product…</option>
          {(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name_en}{p.name_ar ? ` · ${p.name_ar}` : ""}</option>)}
        </Select>
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
      <Button type="submit" disabled={!ready || m.isPending} className="w-full">{m.isPending ? "Saving…" : "Add purchase"}</Button>
    </form>
  );
}

/* ─ Sale: create the day's header ──────────────────────────────────────── */
export function SaleForm({ onDone }: { onDone?: () => void }) {
  const w = useWrite(onDone);
  const locations = useQuery({ queryKey: ["locations"], queryFn: getLocations });
  const channels = useQuery({ queryKey: ["channels"], queryFn: getChannels });
  const [date, setDate] = useState(todayCairo());
  const [total, setTotal] = useState("");
  const loc = locations.data?.[0];
  const ch = channels.data?.[0];
  const m = useMutation({
    mutationFn: () => createSale({ date, total: num(total) ?? 0, locationId: loc!.id, channelId: ch!.id }),
    onSuccess: () => w.ok("Sale day created — add product lines to track stock & profit"),
    onError: w.fail,
  });
  const ready = !!loc && !!ch && !!date && (num(total) ?? -1) >= 0;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready) m.mutate(); }} className="space-y-3">
      {(!loc || !ch) && <div className="rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">No active location/channel found — set one up in Supabase first.</div>}
      <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Day's total sales (EGP, from POS)"><Input type="number" step="any" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="e.g. 4200" /></Field>
      <p className="text-[11px] text-dim">This is the day's grand total (revenue). After saving, open the day to add product lines — those deduct stock and snapshot COGS.</p>
      <Button type="submit" disabled={!ready || m.isPending} className="w-full">{m.isPending ? "Saving…" : "Create sale day"}</Button>
    </form>
  );
}

/* ─ Sale line: add or edit a product line (deducts stock + COGS) ────────── */
export function SaleItemForm({ saleId, item, onDone }: { saleId: string; item?: SaleLine; onDone?: () => void }) {
  const w = useWrite(onDone);
  const products = useQuery({ queryKey: ["products-list"], queryFn: getProducts });
  const [productId, setProductId] = useState(item?.productId ?? "");
  const [qty, setQty] = useState(item ? String(item.qty) : "");
  const [price, setPrice] = useState(item?.unitPrice != null ? String(item.unitPrice) : "");
  const [lineTotal, setLineTotal] = useState(item ? String(item.lineTotal) : "");

  const computed = (num(qty) ?? 0) * (num(price) ?? 0);
  const m = useMutation({
    mutationFn: () => {
      const payload = { productId, qty: num(qty) ?? 0, unitPrice: num(price) ?? 0, lineTotal: num(lineTotal) || computed, notes: null };
      return item ? editSaleItem(item.id, payload) : addSaleItem({ saleId, ...payload });
    },
    onSuccess: () => w.ok(item ? "Line updated · stock reapplied" : "Line added · stock deducted"),
    onError: w.fail,
  });
  const ready = !!productId && (num(qty) ?? 0) > 0;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready) m.mutate(); }} className="space-y-3">
      <Field label="Product">
        <Select value={productId} onChange={(e) => setProductId(e.target.value)} required>
          <option value="">Select a product…</option>
          {(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name_en}{p.name_ar ? ` · ${p.name_ar}` : ""}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity (base units)"><Input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Unit price"><Input type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
      </div>
      <Field label={`Line total (EGP)${computed ? ` · auto ${Math.round(computed)}` : ""}`}>
        <Input type="number" step="any" value={lineTotal} onChange={(e) => setLineTotal(e.target.value)} placeholder={computed ? String(Math.round(computed)) : ""} />
      </Field>
      <Button type="submit" disabled={!ready || m.isPending} className="w-full">{m.isPending ? "Saving…" : item ? "Save line" : "Add line"}</Button>
    </form>
  );
}
