-- Control test: a locked accounting period rejects dated writes; open months
-- are unaffected (migration 0015).
do $$
declare v_locked text := '?'; v_open text := '?';
begin
  perform public.lock_period(date '2099-01-15');
  begin perform public.assert_period_open(date '2099-01-20'); v_locked := 'NOT BLOCKED (FAIL)';
  exception when others then v_locked := 'OK'; end;
  begin perform public.assert_period_open(date '2098-06-10'); v_open := 'OK';
  exception when others then v_open := 'BLOCKED (FAIL)'; end;
  if v_locked='OK' and v_open='OK' then
    raise exception 'PASS period: locked_blocked=% open_allowed=% (rolled back)', v_locked, v_open;
  else
    raise exception 'FAIL period: locked=% open=%', v_locked, v_open;
  end if;
end $$;
