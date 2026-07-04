-- =====================================================================
-- BostaOS — Migration 0025: products.pos_code (POS item-code foundation)
--
-- Additive + non-breaking. Adds products.pos_code: the 4-digit item code
-- (كود الصنف) printed on every POS daily-sales report. This is the ONE stable
-- key on the documents — the daily-sales importer matches each read line to a
-- product by pos_code (exact), replacing the old barcode/Arabic-name matching
-- that failed because products carry no reliable barcode and Arabic names drift.
--
-- The printed code is an 8-digit ZERO-PADDED string (e.g. "00021043") — NOT the
-- 4 digits assumed at charter time. Stored verbatim as TEXT so leading zeros are
-- preserved; the importer's matcher folds leading zeros on both sides so a code
-- read as "21043" still resolves. Codes are UNIQUE
-- among ACTIVE products only — an inactive/retired product may keep a code that
-- a later active product reuses, and NULL means "not yet coded" (many rows may
-- be null; a partial unique index permits unlimited nulls).
--
-- No data is written here. Codes are backfilled by a SEPARATE reversible
-- migration (0026) only after the owner approves the harvested code→product map.
--
-- Safe to re-run (add ... if not exists, guarded constraint + index). Run in the
-- Supabase SQL editor / via apply_migration.
-- =====================================================================

alter table products
  add column if not exists pos_code text;

-- Digit string (3–12), or null. The real POS code is 8-digit zero-padded
-- ("00021043"); the range stays generous so a shorter/longer future code isn't a
-- hard error. Format only — canonicalisation (leading-zero folding) is the
-- matcher's job, not the column's.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_pos_code_format_check') then
    alter table products add constraint products_pos_code_format_check
      check (pos_code is null or pos_code ~ '^[0-9]{3,12}$');
  end if;
end $$;

-- Unique among active products; unlimited nulls; retired products don't collide.
create unique index if not exists uq_products_pos_code_active
  on products (pos_code)
  where pos_code is not null and active;
