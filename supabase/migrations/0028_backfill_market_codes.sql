-- =====================================================================
-- BostaOS — Migration 0028: backfill products.market_code (owner-facing 4-digit)
--
-- Data migration. Each market_code = the 4 digits after the "230" prefix of the
-- product's 13-digit barcode (read from the detailed POS photos, sliced by
-- ^230(\d{4})\d+$ in code — never eyeballed). Keyed by the hidden pos_code +
-- guarded with market_code is null so it is idempotent.
--
-- 29 of the 31 coded products get a market_code. TWO are intentionally left null:
--   00021294 (بندق محمص) and 00021172 (ماسك ص) — they appear ONLY in the
--   barcode-less report variant, so no barcode exists to derive their code.
--   They still match/attach by pos_code; the owner can add their code later.
--
-- Reversal: update products set market_code = null where market_code is not null.
-- =====================================================================

update products set market_code = '1606' where pos_code = '00021043' and market_code is null; -- barcode 2301606000004
update products set market_code = '1607' where pos_code = '00021044' and market_code is null; -- barcode 2301607000003
update products set market_code = '1608' where pos_code = '00021045' and market_code is null; -- barcode 2301608000002
update products set market_code = '1610' where pos_code = '00021047' and market_code is null; -- barcode 2301610000007
update products set market_code = '1611' where pos_code = '00021048' and market_code is null; -- barcode 2301611000006
update products set market_code = '1617' where pos_code = '00021287' and market_code is null; -- barcode 2301617000000
update products set market_code = '1618' where pos_code = '00021288' and market_code is null; -- barcode 2301618000009
update products set market_code = '1619' where pos_code = '00021289' and market_code is null; -- barcode 2301619000008
update products set market_code = '1620' where pos_code = '00021290' and market_code is null; -- barcode 2301620000004
update products set market_code = '1621' where pos_code = '00021291' and market_code is null; -- barcode 2301621000003
update products set market_code = '1622' where pos_code = '00021292' and market_code is null; -- barcode 2301622000002
update products set market_code = '1623' where pos_code = '00021293' and market_code is null; -- barcode 2301623000001
update products set market_code = '1625' where pos_code = '00021295' and market_code is null; -- barcode 2301625000009
update products set market_code = '1626' where pos_code = '00021296' and market_code is null; -- barcode 2301626000008
update products set market_code = '1627' where pos_code = '00021297' and market_code is null; -- barcode 2301627000007
update products set market_code = '1631' where pos_code = '00021455' and market_code is null; -- barcode 2301631000000
update products set market_code = '1632' where pos_code = '00021456' and market_code is null; -- barcode 2301632000009
update products set market_code = '1667' where pos_code = '00021747' and market_code is null; -- barcode 2301667000005
update products set market_code = '1668' where pos_code = '00021748' and market_code is null; -- barcode 2301668000004
update products set market_code = '1669' where pos_code = '00021749' and market_code is null; -- barcode 2301669000003
update products set market_code = '1673' where pos_code = '00021901' and market_code is null; -- barcode 2301673000006
update products set market_code = '1674' where pos_code = '00021902' and market_code is null; -- barcode 2301674000005
update products set market_code = '1675' where pos_code = '00021903' and market_code is null; -- barcode 2301675000004
update products set market_code = '1676' where pos_code = '00021909' and market_code is null; -- barcode 2301676000003
update products set market_code = '1680' where pos_code = '00022017' and market_code is null; -- barcode 2301680000006
update products set market_code = '1695' where pos_code = '00022160' and market_code is null; -- barcode 2301695000008
update products set market_code = '1696' where pos_code = '00022207' and market_code is null; -- barcode 2301696000007
update products set market_code = '1705' where pos_code = '00022290' and market_code is null; -- barcode 2301705000004
update products set market_code = '1718' where pos_code = '00023018' and market_code is null; -- barcode 2301718000008
