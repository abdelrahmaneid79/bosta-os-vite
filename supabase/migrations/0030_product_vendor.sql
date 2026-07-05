-- =====================================================================
-- BostaOS — Migration 0030: products.vendor (the supplier a product is bought from)
--
-- Additive + non-breaking. Adds products.vendor: the supplier/distributor the
-- owner buys each product from (e.g. "Nut Man", "Gamy", "Bebeto"). A display +
-- filter attribute only — NOT a matching key, so no constraint/index.
--
-- Owner-coded via cell fill colour in the July 2026 price list; backfilled by a
-- reversible data update after this column exists (matched on pos_code/barcode).
-- Products with no vendor stay NULL ("Unassigned" in the UI).
--
-- Safe to re-run. Reversal: drop column vendor.
-- =====================================================================

alter table products
  add column if not exists vendor text;
