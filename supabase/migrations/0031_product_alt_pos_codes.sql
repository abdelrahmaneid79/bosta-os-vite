-- Migration 0031: products.alt_pos_codes — extra POS item codes that map to the
-- SAME product (flavour variants with different barcodes, e.g. Jamy Wafer Biscuit).
-- The day-sales importer indexes these alongside the primary pos_code so any of a
-- product's codes matches it automatically. Additive, non-breaking.
-- Reversal: drop column alt_pos_codes.
alter table products add column if not exists alt_pos_codes text[] not null default '{}';
