-- =============================================================
-- Fix: node_vote_summary view column mismatch
-- The previous migration (20260613140000_edge_voting) failed at
-- statement 9 because CREATE OR REPLACE VIEW cannot drop columns
-- (PG error 42P16). The original view has avg_value; we need
-- id, total_votes, up_votes, down_votes, avg_confidence.
-- Solution: DROP first, then CREATE fresh.
-- =============================================================

-- Widen the votes.value constraint to 1..5 (idempotent — safe to
-- re-run if the previous migration already applied it)
alter table public.votes drop constraint if exists votes_value_check;
alter table public.votes add  constraint votes_value_check
  check (value between 1 and 5);

-- Drop the old view (no cascade needed — nothing depends on it)
drop view if exists public.node_vote_summary;

-- Recreate with the column names the JS expects:
--   id, total_votes, up_votes, down_votes, avg_confidence
create view public.node_vote_summary as
select
  node_id                                                as id,
  count(*)                                               as total_votes,
  sum(case when value >= 4 then 1 else 0 end)            as up_votes,
  sum(case when value <= 2 then 1 else 0 end)            as down_votes,
  round(coalesce(avg(value), 0)::numeric, 2)             as avg_confidence
from public.votes
group by node_id;
