-- 0041_owner_confirmed_product_costs.sql
-- Owner-confirmed unit costs (2026-07-18) + the discontinued list, recorded so the
-- decisions survive a restore. Before this, ~5.1% of all revenue with product detail
-- (EGP 141,438 across 1,258 lines, in EVERY month since Oct 2024) carried no
-- cogs_at_sale, because the products behind those lines had no cost on file at all.
-- Gross profit therefore never finalised for any period.
--
-- The July price list the owner supplied matches products.pos_code exactly (43 rows,
-- zero differences) but its cost column is genuinely BLANK for 9 rows — that blank,
-- not an import bug, is where the whole gap came from.
--
-- Idempotent: costs are only set where still absent, and the COGS backfill only
-- touches lines that have none. Safe to re-run.
--
-- NOTE ON PRECEDENCE: cogs_at_sale = qty × base_units_per_sale_unit × (avg_cost when
-- > 0, else reference_cost) — mirrors post_sale_item() in 0020. Only reference_cost is
-- written here; avg_cost belongs to the inventory-ledger replay (ADR-001 / 0006) and is
-- wiped by the next recompute if application code touches it.

-- ── 1. costs confirmed by the owner ──────────────────────────────────────────
-- كناكر / Flavoured Peanuts — 145/kg. 540 lines, EGP 84,693, lands at 29.1% margin,
-- consistent with his other weighted lines. Was the single largest gap.
update products set reference_cost = 145
 where name_en = 'Flavoured Peanuts' and coalesce(reference_cost, 0) = 0;

-- ويفر مغطى شيكولاته / Chocolate-Covered Wafer Flutes — 175/kg → 30.9% margin, in line
-- with his other chocolate lines (Jamy Wafer 40%, Elite Fingers 35%, Choc Peanuts 34.5%).
-- Provenance: his last actual receipt, 10 Mar 2026. He believes the price has since risen
-- (possibly to 225) but has no invoice. 74% of all volume sold on/before that date, so 175
-- is the verified figure for most of it. Deliberately NOT the 175/225 midpoint he first
-- suggested: 200 would match neither real price and would plant an invented number in two
-- years of books. Known exposure if it did rise to 225: ~1,600 EGP overstated profit
-- (0.06% of lifetime revenue). Revisit when a newer invoice appears.
update products set reference_cost = 175
 where name_en = 'Chocolate-Covered Wafer Flutes' and coalesce(reference_cost, 0) = 0;

-- حلوه فكه / Candy Change — 0.2985 per PIECE (quantity on this SKU is pieces, not kg).
-- Not a purchased product: the cashier opens a tub of Jamy fruit toffee or eclair and
-- hands out ONE wrapped piece instead of coin change. Cost = blend of those two lines'
-- real ledger costs ((78.90 + 120.10)/2 = 99.50/kg) × 3 g per piece.
-- The 3 g is a photo-derived estimate — no carton in the stand photos prints a piece
-- weight — cross-checked three ways: scale-label width anchor, toffee density ~1.3 g/cm³,
-- and a pack-fill check (~130 pieces in a 400 g clamshell ⇒ 3.1 g each). To make it exact,
-- weigh 10 pieces on the stand scale; 3 g vs 5 g moves lifetime profit by only ~690 EGP.
update products set reference_cost = 0.2985
 where name_en = 'Candy Change' and coalesce(reference_cost, 0) = 0;

-- ── 2. discontinued lines ────────────────────────────────────────────────────
-- Owner-confirmed inactive. History is retained; they simply leave the pickers, the
-- strategist's advice surface and the "worth fixing" list. Their sale lines stay
-- uncosted permanently and that is accepted (EGP 13,902 ≈ 0.50% of lined revenue).
--
-- Chocolate Pretzels is ARCHIVED, NOT DELETED. The owner asked to "delete it and all
-- traces", but its 3 sales (16 Aug 2025, 9 Sep 2025, 1 May 2026 = EGP 187) reconcile
-- EXACTLY to their day totals. Destroying them would leave those three days' product
-- breakdown permanently short of the recorded day header — a phantom hole in the books.
-- Deactivating achieves what he wanted (invisible in the app) without breaking the ledger.
update products set active = false
 where active is distinct from false
   and name_en in (
     'Pumpkin Seeds', 'Bonbons', 'Flavoured Wafer Roll', 'Licorice',
     'Bawla Caramel Peanut bar', 'Mask', 'Mustache Glasses', 'Perfume (100ml)',
     'Chocolate Pretzels',
     -- legacy single-unit variants of products already sold by weight (4 lines, EGP 57)
     'Marshmallow piece', 'El Shanawany Nougat (piece)', 'Jamy Wafer Biscuit (piece)'
   );

-- ── 3. backfill the COGS snapshots ───────────────────────────────────────────
-- Covers both the newly-costed products above AND ~175 older lines on products that
-- already had a cost but were imported before it was set.
update sale_items i
   set cogs_at_sale = round(
         (i.quantity
          * coalesce(p.base_units_per_sale_unit, 1)
          * case when coalesce(p.avg_cost, 0) > 0 then p.avg_cost else p.reference_cost end
         )::numeric, 4)
  from products p, sales s
 where p.id = i.product_id
   and s.id = i.sale_id
   and i.voided_at is null
   and s.voided_at is null
   and i.cogs_at_sale is null
   and (coalesce(p.avg_cost, 0) > 0 or coalesce(p.reference_cost, 0) > 0);

-- Result: uncosted revenue 141,438 → 13,902 (5.1% → 0.50%), all of the remainder on
-- inactive products. June 2026 closes with ZERO gaps at 38.4% gross margin; the real
-- blended margin for 2026 is 38–41%, not the ~30% that partial data had implied.
-- July 2026 remains open for a different reason: its 14 days are day-totals with no
-- product breakdown yet (awaiting POS day-report photos), which no cost data can fix.
