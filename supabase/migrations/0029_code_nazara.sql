-- =====================================================================
-- BostaOS — Migration 0029: code نظاره بشنب (owner-confirmed one-off product)
-- Sets the hidden pos_code from the POS document's item code (00021173) so the
-- daily-sales importer can match its lines. It only ever appears in the
-- barcode-less report variant, so there is no barcode → no market_code (stays
-- null; the product simply shows no 4-digit code). Reversible: set pos_code=null.
-- =====================================================================
update products set pos_code = '00021173'
where name_ar = 'نظاره بشنب' and pos_code is null;
