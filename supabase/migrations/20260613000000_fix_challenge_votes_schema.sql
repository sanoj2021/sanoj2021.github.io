-- =============================================================
-- Fix challenge_votes schema to match what app.js inserts.
--
-- The original table had `valid` (boolean) but the JS was sending
-- `is_valid`. Also removes `target_id`, `target_type`, and `reason`
-- from challenge_votes because that data is already on the parent
-- `challenges` row (reachable via challenge_id FK).
--
-- Keeps the unique constraint (challenge_id, user_id) and all RLS
-- policies, just renames the column and trims the redundant ones.
-- Safe to re-run: each step is guarded.
-- =============================================================

-- 1. Rename `valid` → `is_valid` if not already done
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'challenge_votes'
      and column_name  = 'valid'
  ) then
    alter table public.challenge_votes rename column valid to is_valid;
  end if;
 end $$;

-- 2. Drop redundant columns that are already on the parent `challenges` row.
--    Use IF EXISTS so the migration is idempotent.
alter table public.challenge_votes
  drop column if exists target_id,
  drop column if exists target_type,
  drop column if exists reason;

-- 3. Rebuild challenge_vote_summary view (no longer groups on dropped cols).
create or replace view public.challenge_vote_summary as
select
  cv.challenge_id,
  c.target_id,
  c.target_type,
  count(*)                                                   as total_votes,
  sum(case when cv.is_valid = true  then 1 else 0 end)       as valid_votes,
  sum(case when cv.is_valid = false then 1 else 0 end)       as invalid_votes
from public.challenge_votes cv
join public.challenges c on c.id = cv.challenge_id
group by cv.challenge_id, c.target_id, c.target_type;

-- 4. Update the trigger function to read target_id/target_type from
--    the parent challenges row, not from NEW (which no longer has those cols).
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
  -- Resolve which challenge_id we are dealing with
  select c.target_id, c.target_type
    into v_node_id, v_target_type
    from public.challenges c
   where c.id = coalesce(NEW.challenge_id, OLD.challenge_id);

  if v_target_type is null or v_target_type <> 'node' then
    return coalesce(NEW, OLD);
  end if;

  select total_votes, valid_votes
    into v_total, v_valid
    from public.challenge_vote_summary
   where challenge_id = coalesce(NEW.challenge_id, OLD.challenge_id);

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

-- Re-attach trigger (DROP + CREATE so the definition picks up the new function body)
drop trigger if exists trg_challenge_votes_update_status
  on public.challenge_votes;

create trigger trg_challenge_votes_update_status
after insert or update or delete
on public.challenge_votes
for each row
execute function public.fn_update_node_status_from_challenge();
