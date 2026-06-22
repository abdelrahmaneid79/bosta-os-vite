-- =====================================================================
-- BostaOS — Migration 0006: weighted-average cost (Phase 5, Session 9)
--
-- Activates products.avg_cost as a DERIVED cache, recomputed from the
-- inventory_movements ledger alongside current_stock (ADR-001: ledger -> cache
-- only, never cache -> ledger). avg_cost is never written by application code;
-- only the recompute below writes it.
--
-- FUNCTIONS + TRIGGER WIRING ONLY. No new tables or columns — products.avg_cost,
-- products.current_stock and inventory_movements.unit_cost/total_cost already
-- exist (0001 / 0003 / 0005). This migration deliberately does NOT touch
-- sale_items.cogs_at_sale, does NOT deduct stock from sales (Session 10), and
-- does NOT compute profitability (Session 11).
--
-- Costing model (weighted average, locked by the Session 9 audit):
--   * current_stock = signed sum of all non-voided movement.quantity.
--   * avg_cost changes ONLY on a "costed inflow": quantity > 0 AND
--     unit_cost IS NOT NULL. Outflows and costless inflows (e.g. opening or
--     adjustments with NULL unit_cost) leave avg_cost unchanged (cost-neutral).
--   * Negative-inventory rule (Approach B / clamp-to-zero): on a costed inflow,
--     if the PRE-inflow running quantity <= 0, avg_cost RESETS to the incoming
--     unit_cost (the negative backlog carries no cost basis); otherwise the
--     standard weighted average applies. current_stock is unaffected by this —
--     it is always the true signed sum.
--   * Opening stock: a costed opening movement seeds avg_cost; a NULL-cost
--     opening movement is cost-neutral.
--   * Replay is chronological by (movement_date, created_at, id) so voids,
--     edits and backdated entries are always handled correctly by recompute.
--
-- Safe to re-run (create or replace; idempotent grants). Run in the Supabase
-- SQL editor.
-- =====================================================================

-- 1) The replay recompute. Walks the product's non-voided ledger in order and
--    writes BOTH derived caches. Final running qty equals current_stock by
--    construction (a built-in consistency check against the ledger).
create or replace function recompute_product_costs(p_product_id uuid)
returns void language plpgsql as $$
declare
  r   record;
  v_qty numeric := 0;   -- running quantity (signed, base unit)
  v_avg numeric := 0;   -- running weighted-average cost
begin
  for r in
    select quantity, unit_cost
      from inventory_movements
      where product_id = p_product_id
        and voided_at is null
      order by movement_date asc, created_at asc, id asc
  loop
    -- avg moves only on a costed inflow; everything else is cost-neutral.
    if r.quantity > 0 and r.unit_cost is not null then
      if v_qty <= 0 then
        -- Negative/zero pre-inflow stock: re-base to the incoming cost.
        v_avg := r.unit_cost;
      else
        v_avg := ((v_qty * v_avg) + (r.quantity * r.unit_cost))
                 / (v_qty + r.quantity);
      end if;
    end if;

    v_qty := v_qty + r.quantity;  -- signed; outflows reduce, may go negative
  end loop;

  update products
    set current_stock = v_qty,
        avg_cost = v_avg,
        updated_at = now()
    where id = p_product_id;
end;
$$;

-- 2) Keep the existing public RPC name working and now cost-aware. The app's
--    reconcile path calls recompute_product_stock(...) — delegating means it
--    refreshes BOTH caches with no application change.
create or replace function recompute_product_stock(p_product_id uuid)
returns void language plpgsql as $$
begin
  perform recompute_product_costs(p_product_id);
end;
$$;

-- 3) Re-wire the in-transaction sync trigger function (from 0003) to recompute
--    costs instead of stock-only, then (re)create the trigger explicitly so the
--    migration is self-contained — not relying on the wiring already being
--    correct. AFTER insert/update/delete so the replay sees the FINAL ledger
--    state. The trigger name matches the one created in 0003.
create or replace function inventory_movements_sync_stock()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform recompute_product_costs(old.product_id);
    return old;
  end if;
  perform recompute_product_costs(new.product_id);
  if tg_op = 'UPDATE' and new.product_id is distinct from old.product_id then
    perform recompute_product_costs(old.product_id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_inv_mov_sync_stock on inventory_movements;

create trigger trg_inv_mov_sync_stock
  after insert or update or delete on inventory_movements
  for each row execute function inventory_movements_sync_stock();

-- 4) Manual / audit helper: recompute every product (also the backfill below).
create or replace function recompute_all_product_costs()
returns void language plpgsql as $$
declare r record;
begin
  for r in select id from products loop
    perform recompute_product_costs(r.id);
  end loop;
end;
$$;

-- 5) Grants — single-admin V1 (SECURITY INVOKER default; RLS still governs the
--    products write via the admin_all policy).
grant execute on function recompute_product_costs(uuid) to authenticated;
grant execute on function recompute_all_product_costs() to authenticated;
-- recompute_product_stock(uuid) was already granted in 0003; re-granting is safe.
grant execute on function recompute_product_stock(uuid) to authenticated;

-- 6) One-time backfill: derive current_stock + avg_cost for all existing
--    products from the ledger so avg_cost reflects historical purchases.
select recompute_all_product_costs();
