-- =====================================================================
-- BostaOS — Migration 0004: purchase batches (Phase 5, Session 8)
--
-- Introduces the purchase SOURCE-DOCUMENT table. One row per product
-- purchase line; a multi-product invoice is a LOGICAL grouping by
-- (supplier_id, invoice_ref, purchase_date) — there is intentionally NO
-- purchase header table and NO unique constraint on that group (several
-- product lines legitimately share one invoice).
--
-- Quantity is stored in the product BASE UNIT, matching
-- inventory_movements.quantity exactly, so the future Session 8 action can
-- write the linked movement with no conversion.
--
-- Scope: TABLE ONLY. Stock still flows solely through inventory_movements,
-- which the app inserts alongside a batch (Session 8 server action). This
-- migration deliberately does NOT:
--   * create a doc->ledger trigger (DB triggers here are reserved for
--     ledger->cache sync only — see 0003),
--   * compute weighted-average cost or touch products.avg_cost,
--   * create expenses from purchases.
--
-- Additive and safe to re-run (IF NOT EXISTS guards). Run in the Supabase
-- SQL editor.
-- =====================================================================

-- 1) Purchase batches. supplier_id is NULLABLE: historical imports may have
--    missing supplier data. quantity/unit_cost/total_cost are stored as
--    entered; total_cost is kept as the invoice line total (not a generated
--    column) to preserve invoice fidelity, mirroring inventory_movements.
create table if not exists purchase_batches (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id),
  product_id uuid not null references products(id),
  location_id uuid references locations(id),       -- future multi-location
  invoice_ref text,                                -- grouping key (nullable)
  purchase_date date not null default current_date,
  quantity numeric(14,3) not null check (quantity > 0),    -- base unit, positive (stock-in)
  unit_cost numeric(14,4) not null check (unit_cost >= 0), -- per base unit
  total_cost numeric(14,2) not null check (total_cost >= 0), -- as-entered invoice line total
  notes text,
  source_type source_type not null default 'manual',
  verification verification_status not null default 'verified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  voided_at timestamptz,
  void_reason text
);

-- 2) Indexes.
--    a) Multi-product invoice grouping.
create index if not exists idx_purchase_batches_invoice
  on purchase_batches(supplier_id, invoice_ref, purchase_date);
--    b) Per-product purchase history (mirrors idx_inv_mov_product).
create index if not exists idx_purchase_batches_product
  on purchase_batches(product_id, purchase_date)
  where voided_at is null;
--    c) Active purchases, most-recent first.
create index if not exists idx_purchase_batches_active
  on purchase_batches(purchase_date desc)
  where voided_at is null;

-- 3) Keep updated_at fresh (shared helper from 0001). CREATE TRIGGER has no
--    IF NOT EXISTS, so drop-then-create keeps the migration re-runnable.
drop trigger if exists trg_purchase_batches_upd on purchase_batches;
create trigger trg_purchase_batches_upd before update on purchase_batches
  for each row execute function set_updated_at();

-- 4) RLS — single-admin V1, matching every existing table.
alter table purchase_batches enable row level security;
drop policy if exists admin_all on purchase_batches;
create policy admin_all on purchase_batches
  for all to authenticated using (true) with check (true);
