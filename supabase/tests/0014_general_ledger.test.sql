-- Control test: double-entry GL — balanced entries, rejection of unbalanced,
-- line immutability, trial-balance equality (migration 0014).
do $$
declare v1 uuid; v_bad text := '?'; v_imm text := '?'; v_d numeric; v_c numeric; v_line uuid;
begin
  v1 := public.gl_post_entry(current_date, 'probe sale', 'test', null,
        '[{"account":"1100","debit":100},{"account":"4000","credit":100}]'::jsonb);
  set constraints all immediate;                       -- balanced entry must pass
  begin
    perform public.gl_post_entry(current_date, 'probe bad', 'test', null,
            '[{"account":"1100","debit":100},{"account":"4000","credit":90}]'::jsonb);
    v_bad := 'NOT REJECTED (FAIL)';
  exception when others then v_bad := 'OK'; end;
  select id into v_line from public.gl_lines where entry_id = v1 limit 1;
  begin update public.gl_lines set debit=999 where id=v_line; v_imm := 'NOT BLOCKED (FAIL)';
  exception when others then v_imm := 'OK'; end;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into v_d, v_c
    from public.gl_lines l join public.gl_entries e on e.id=l.entry_id where e.status='posted';
  if v_bad='OK' and v_imm='OK' and v_d=v_c then
    raise exception 'PASS gl: unbalanced_rejected=% line_immutable=% trial_balance %=% (rolled back)', v_bad, v_imm, v_d, v_c;
  else
    raise exception 'FAIL gl: unbalanced=% immutable=% TB %<>%', v_bad, v_imm, v_d, v_c;
  end if;
end $$;
