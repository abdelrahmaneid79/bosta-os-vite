-- =====================================================================
-- BostaOS — Migration 0026: backfill products.pos_code (harvested from POS photos)
--
-- Data migration. Writes the POS item code (كود الصنف, 8-digit zero-padded) onto
-- each product it was harvested for. Codes were read from 20 daily POS product
-- reports (Oct 2024 – Jan 2025) with a vision model, each code confirmed across
-- multiple documents, then matched to products by EXACT Arabic-name equality —
-- EXCEPT بونبون وزن, whose report name carries a "تيكا" brand prefix ("تيكا بونبون
-- وزن"); it is matched by code + corroborating avg price (184.99 ≈ 185.73) and is
-- the only non-exact-name row here.
--
-- Keyed by name_ar (unique in this catalogue) + guarded with `pos_code is null`
-- so it is idempotent and never clobbers a code set another way. 31 of 56
-- products get a code; the remaining 25 never appeared in the sampled reports and
-- stay uncoded (the importer queues any unmatched code for the owner at import).
--
-- Reversal (down): `update products set pos_code = null where pos_code in (...)`
-- — or simply drop the column (0025). No other table is touched.
-- =====================================================================

update products set pos_code = '00021043' where name_ar = 'جامى طوفى فواكه وزن'   and pos_code is null;
update products set pos_code = '00021044' where name_ar = 'جامى طوفى اكلير وزن'    and pos_code is null;
update products set pos_code = '00021045' where name_ar = 'جامى جيلى كاندى وزن'    and pos_code is null;
update products set pos_code = '00021047' where name_ar = 'جامى ملبس روك وزن'      and pos_code is null;
update products set pos_code = '00021048' where name_ar = 'جامى شوكوبون وزن'       and pos_code is null;
update products set pos_code = '00021172' where name_ar = 'ماسك ص'                 and pos_code is null;
update products set pos_code = '00021287' where name_ar = 'كونو مقرمشات وزن'       and pos_code is null;
update products set pos_code = '00021288' where name_ar = 'ذره محمصه اسبانى'       and pos_code is null;
update products set pos_code = '00021289' where name_ar = 'بريتزل ملح'             and pos_code is null;
update products set pos_code = '00021290' where name_ar = 'بريتزل جبنه'            and pos_code is null;
update products set pos_code = '00021291' where name_ar = 'بريتزل كاتشب'           and pos_code is null;
update products set pos_code = '00021292' where name_ar = 'بريتزل باربكيو'         and pos_code is null;
update products set pos_code = '00021293' where name_ar = 'فستق امريكى'            and pos_code is null;
update products set pos_code = '00021294' where name_ar = 'بندق محمص'              and pos_code is null;
update products set pos_code = '00021295' where name_ar = 'لوز محمص'               and pos_code is null;
update products set pos_code = '00021296' where name_ar = 'كاجو محمص'              and pos_code is null;
update products set pos_code = '00021297' where name_ar = 'عين جمل امريكى'         and pos_code is null;
update products set pos_code = '00021455' where name_ar = 'تيكا مارشيملو وزن'      and pos_code is null;
update products set pos_code = '00021456' where name_ar = 'بونبون وزن'             and pos_code is null;  -- doc: "تيكا بونبون وزن"
update products set pos_code = '00021747' where name_ar = 'لب مقشر'                and pos_code is null;
update products set pos_code = '00021748' where name_ar = 'لب سورى'                and pos_code is null;
update products set pos_code = '00021749' where name_ar = 'فول اسوانى'             and pos_code is null;
update products set pos_code = '00021901' where name_ar = 'كناكر وزن'              and pos_code is null;
update products set pos_code = '00021902' where name_ar = 'لب ابيض مصرى'           and pos_code is null;
update products set pos_code = '00021903' where name_ar = 'لب ابيض قرع'            and pos_code is null;
update products set pos_code = '00021909' where name_ar = 'سودانى شيكولاته'        and pos_code is null;
update products set pos_code = '00022017' where name_ar = 'مقرمشات صينى وزن'       and pos_code is null;
update products set pos_code = '00022160' where name_ar = 'كابوكى فلسطينى وزن'     and pos_code is null;
update products set pos_code = '00022207' where name_ar = 'لب سوبر وزن'            and pos_code is null;
update products set pos_code = '00022290' where name_ar = 'ستيكس اطعمه'            and pos_code is null;
update products set pos_code = '00023018' where name_ar = 'جيلى ساور زون'          and pos_code is null;
