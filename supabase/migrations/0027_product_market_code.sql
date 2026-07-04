-- =====================================================================
-- BostaOS — Migration 0027: products.market_code (the owner-facing 4-digit code)
--
-- Additive + non-breaking. Adds products.market_code: the friendly 4-digit code
-- the owner actually uses (e.g. 1606). It is the 4 digits after the "230" prefix
-- of the product's 13-digit barcode (2301606000004 → 1606) — a pattern the owner
-- confirmed always holds.
--
-- This becomes the ONLY product code shown in the UI. The 8-digit pos_code
-- (migration 0025) stays as a hidden internal key — the daily POS documents print
-- it, so the importer must keep matching on it — but it is never displayed.
--
-- Stored as TEXT, UNIQUE among ACTIVE products (partial index; unlimited nulls so
-- uncoded products don't collide). No data written here — codes are backfilled by
-- the reversible migration 0028 after being derived from the barcodes.
--
-- Safe to re-run. Reversal: drop column market_code.
-- =====================================================================

alter table products
  add column if not exists market_code text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_market_code_format_check') then
    alter table products add constraint products_market_code_format_check
      check (market_code is null or market_code ~ '^[0-9]{4}$');
  end if;
end $$;

create unique index if not exists uq_products_market_code_active
  on products (market_code)
  where market_code is not null and active;
