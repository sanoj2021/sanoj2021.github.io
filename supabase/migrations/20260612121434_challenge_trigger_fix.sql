-- Fix challenge trigger to use target_id / target_type schema
-- Safe to re-run because it uses CREATE OR REPLACE and DROP TRIGGER IF EXISTS.

create or replace function public.fn_update_node_status_from_challenge()
returns trigger
language plpgsql
security definer
as $$
declare
  v_node_id        text;
  v_target_type    text;
  v_total          int;
  v_valid          int;
  v_valid_pct      numeric;
  v_current_status text;
  c_min_votes      constant int     := 5;
  c_retire_pct     constant numeric := 0.60;
  c_restore_pct    constant numeric := 0.40;
begin
  v_node_id := coalesce(NEW.target_id, OLD.target_id);
  v_target_type := coalesce(NEW.target_type, OLD.target_type);

  if v_target_type <> 'node' then
    return coalesce(NEW, OLD);
  end if;

  select total_votes, valid_votes
    into v_total, v_valid
    from public.challenge_vote_summary
   where target_id = v_node_id
     and target_type = 'node';

  if v_total is null then
    return coalesce(NEW, OLD);
  end if;

  v_valid_pct := v_valid::numeric / nullif(v_total, 0);

  select status
    into v_current_status
    from public.nodes
   where id::text = v_node_id;

  if v_valid > 0 and v_current_status not in ('challenged', 'retired') then
    update public.nodes
       set status = 'challenged'
     where id::text = v_node_id;
    return coalesce(NEW, OLD);
  end if;

  if v_total >= c_min_votes and v_valid_pct >= c_retire_pct
     and v_current_status <> 'retired' then
    update public.nodes
       set status = 'retired'
     where id::text = v_node_id;
    return coalesce(NEW, OLD);
  end if;

  if v_total >= c_min_votes and v_valid_pct < c_restore_pct
     and v_current_status = 'challenged' then
    update public.nodes
       set status = 'open'
     where id::text = v_node_id;
    return coalesce(NEW, OLD);
  end if;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_challenge_votes_update_status
on public.challenge_votes;

create trigger trg_challenge_votes_update_status
after insert or update or delete
on public.challenge_votes
for each row
execute function public.fn_update_node_status_from_challenge();

do $$
declare
  r record;
begin
  for r in
    select
      cvs.target_id as node_id,
      cvs.total_votes,
      cvs.valid_votes,
      cvs.valid_votes::numeric / nullif(cvs.total_votes, 0) as valid_pct,
      n.status
    from public.challenge_vote_summary cvs
    join public.nodes n
      on n.id::text = cvs.target_id
   where cvs.target_type = 'node'
  loop
    if r.total_votes >= 5 and r.valid_pct >= 0.60 and r.status <> 'retired' then
      update public.nodes set status = 'retired' where id::text = r.node_id;
    elsif r.total_votes >= 5 and r.valid_pct < 0.40 and r.status = 'challenged' then
      update public.nodes set status = 'open' where id::text = r.node_id;
    elsif r.valid_votes > 0 and r.status not in ('challenged', 'retired') then
      update public.nodes set status = 'challenged' where id::text = r.node_id;
    end if;
  end loop;
end;
$$;
