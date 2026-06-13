-- =============================================================
-- Edge Voting Migration
-- Adds:
--   1. link_votes table (confidence votes on directed edges)
--   2. link_vote_summary view (avg confidence + total per edge)
--   3. node_vote_summary view recreated with avg_confidence + id
--      alias (replaces the minimal version in the initial schema)
--   4. upsert_link_vote(p_link_id, p_value) RPC
--   5. upsert_vote(p_node_id, p_value) RPC (if not already present)
-- =============================================================

-- -----------------------------------------------------------
-- 1. link_votes
-- One row per (link_id, user_id) — UPSERT pattern.
-- value: 1..5 confidence that the connection is valid/relevant.
-- -----------------------------------------------------------
create table if not exists public.link_votes (
  id         bigint      not null primary key generated always as identity,
  link_id    bigint      not null references public.links (id) on delete cascade,
  user_id    uuid        not null references auth.users   (id) on delete cascade,
  value      integer     not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint link_votes_link_id_user_id_key unique (link_id, user_id),
  constraint link_votes_value_check check (value between 1 and 5)
);

alter table public.link_votes enable row level security;

create policy "link_votes: public read"
  on public.link_votes for select using (true);

create policy "link_votes: own insert"
  on public.link_votes for insert with check (auth.uid() = user_id);

create policy "link_votes: own update"
  on public.link_votes for update using (auth.uid() = user_id);

create policy "link_votes: own delete"
  on public.link_votes for delete using (auth.uid() = user_id);

-- -----------------------------------------------------------
-- 2. link_vote_summary view
-- Aggregates per link: avg confidence, total votes, and
-- a synthetic up_votes / down_votes for consistency with
-- the front-end linkVoteByUser / edgeVisuals helpers.
-- "id" alias makes it match the JS pattern: s.id === linkId
-- -----------------------------------------------------------
create or replace view public.link_vote_summary as
select
  link_id                                           as id,
  count(*)                                          as total_votes,
  round(avg(value)::numeric, 2)                     as avg_confidence,
  sum(case when value >= 4 then 1 else 0 end)       as up_votes,
  sum(case when value <= 2 then 1 else 0 end)       as down_votes
from public.link_votes
group by link_id;

-- -----------------------------------------------------------
-- 3. node_vote_summary — recreate with avg_confidence + id
-- PostgreSQL does not allow CREATE OR REPLACE VIEW to drop
-- columns (error 42P16), so we DROP first then CREATE fresh.
-- The original view exposed: node_id, avg_value.
-- The JS in app.js expects: id, total_votes, up_votes,
-- down_votes, avg_confidence.
-- -----------------------------------------------------------

-- Widen the votes.value constraint to 1..5
alter table public.votes drop constraint if exists votes_value_check;
alter table public.votes add  constraint votes_value_check check (value between 1 and 5);

-- DROP first (avoids 42P16 — cannot drop columns from view)
drop view if exists public.node_vote_summary;

create view public.node_vote_summary as
select
  node_id                                           as id,
  count(*)                                          as total_votes,
  sum(case when value >= 4 then 1 else 0 end)       as up_votes,
  sum(case when value <= 2 then 1 else 0 end)       as down_votes,
  round(coalesce(avg(value), 0)::numeric, 2)        as avg_confidence
from public.votes
group by node_id;

-- -----------------------------------------------------------
-- 4. upsert_link_vote RPC
-- Called by app.js: sb.rpc('upsert_link_vote', { p_link_id, p_value })
-- Inserts a new vote or updates the existing one.
-- Returns the current avg_confidence and total_votes for
-- the edge so the caller can update the UI without a full reload.
-- -----------------------------------------------------------
create or replace function public.upsert_link_vote(
  p_link_id bigint,
  p_value   integer
)
returns json
language plpgsql
security definer
as $$
declare
  v_user_id  uuid := auth.uid();
  v_avg      numeric;
  v_total    bigint;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_value < 1 or p_value > 5 then
    raise exception 'Vote value must be between 1 and 5';
  end if;

  insert into public.link_votes (link_id, user_id, value, updated_at)
  values (p_link_id, v_user_id, p_value, now())
  on conflict (link_id, user_id)
  do update set value = excluded.value, updated_at = now();

  select
    round(avg(value)::numeric, 2),
    count(*)
  into v_avg, v_total
  from public.link_votes
  where link_id = p_link_id;

  return json_build_object(
    'avg_confidence', v_avg,
    'total_votes',    v_total
  );
end;
$$;

-- Grant execute to authenticated role
grant execute on function public.upsert_link_vote(bigint, integer) to authenticated;

-- -----------------------------------------------------------
-- 5. upsert_vote RPC (node credibility votes)
-- app.js calls: sb.rpc('upsert_vote', { p_node_id, p_value })
-- DROP first required — PostgreSQL 42P13 prevents CREATE OR REPLACE
-- from changing the return type of an existing function.
-- -----------------------------------------------------------
drop function if exists public.upsert_vote(text, integer);

create function public.upsert_vote(
  p_node_id text,
  p_value   integer
)
returns void
language plpgsql
security definer
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_value < 1 or p_value > 5 then
    raise exception 'Vote value must be between 1 and 5';
  end if;

  insert into public.votes (node_id, user_id, value, updated_at)
  values (p_node_id, v_user_id, p_value, now())
  on conflict (node_id, user_id)
  do update set value = excluded.value, updated_at = now();
end;
$$;

grant execute on function public.upsert_vote(text, integer) to authenticated;
