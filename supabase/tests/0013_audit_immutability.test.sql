-- Control test: audit_log is append-only + hash-chained (migration 0013).
do $$
declare v_chain boolean; v_n bigint; v_upd text := '?'; v_del text := '?';
begin
  insert into public.audit_log(action, entity_type) values ('probe1','test');
  insert into public.audit_log(action, entity_type) values ('probe2','test');
  select ok, checked into v_chain, v_n from public.verify_audit_chain();
  begin update public.audit_log set action='x' where action='probe1'; v_upd := 'NOT BLOCKED (FAIL)';
  exception when others then v_upd := 'OK'; end;
  begin delete from public.audit_log where action='probe2'; v_del := 'NOT BLOCKED (FAIL)';
  exception when others then v_del := 'OK'; end;
  if v_chain and v_upd='OK' and v_del='OK' then
    raise exception 'PASS audit: chain_ok=% rows=% update_blocked=% delete_blocked=% (rolled back)', v_chain, v_n, v_upd, v_del;
  else
    raise exception 'FAIL audit: chain_ok=% update=% delete=%', v_chain, v_upd, v_del;
  end if;
end $$;
