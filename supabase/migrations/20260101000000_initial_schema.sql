-- =============================================================
-- 001 Initial Schema
-- Baseline for ScienceDB: all tables, constraints, views,
-- and RLS policies that exist in production as of 2026-06-12.
-- Safe to re-run: uses CREATE TABLE IF NOT EXISTS and
-- CREATE OR REPLACE VIEW everywhere.
-- =============================================================

-- -----------------------------------------------------------
-- profiles
-- Mirrors auth.users; populated via trigger on sign-up.
-- -----------------------------------------------------------
create table if not exists public.profiles (
  id          uuid        not null primary key references auth.users (id) on delete cascade,
  username    text        not null unique,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: public read"
  on public.profiles for select using (true);

create policy "profiles: own insert"
  on public.profiles for insert with check (auth.uid() = id);

create policy "profiles: own update"
  on public.profiles for update using (auth.uid() = id);

-- -----------------------------------------------------------
-- nodes
-- Core knowledge entries (facts, claims, questions).
-- -----------------------------------------------------------
create table if not exists public.nodes (
  id           text        not null primary key,
  title        text        not null,
  summary      text        not null default '',
  type         text        not null,
  status       text        not null default 'open',
  confidence   numeric     not null default 3.0,
  votes_count  integer     not null default 0,
  created_by   uuid        references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint nodes_type_check    check (type   in ('fact', 'claim', 'question')),
  constraint nodes_status_check  check (status in ('new', 'open', 'challenged', 'retired')),
  constraint nodes_confidence_check check (confidence between 0 and 5)
);

alter table public.nodes enable row level security;

create policy "nodes: public read"
  on public.nodes for select using (true);

create policy "nodes: authenticated insert"
  on public.nodes for insert with check (auth.role() = 'authenticated');

create policy "nodes: author update"
  on public.nodes for update using (auth.uid() = created_by);

-- -----------------------------------------------------------
-- sources
-- External references that back up nodes.
-- -----------------------------------------------------------
create table if not exists public.sources (
  id          text        not null primary key,
  title       text        not null,
  kind        text        not null,
  quality     text        not null,
  note        text        not null default '',
  created_by  uuid        references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.sources enable row level security;

create policy "sources: public read"
  on public.sources for select using (true);

create policy "sources: authenticated insert"
  on public.sources for insert with check (auth.role() = 'authenticated');

-- -----------------------------------------------------------
-- node_sources  (junction: nodes ↔ sources)
-- -----------------------------------------------------------
create table if not exists public.node_sources (
  node_id    text not null references public.nodes   (id) on delete cascade,
  source_id  text not null references public.sources (id) on delete cascade,
  primary key (node_id, source_id)
);

alter table public.node_sources enable row level security;

create policy "node_sources: public read"
  on public.node_sources for select using (true);

create policy "node_sources: authenticated insert"
  on public.node_sources for insert with check (auth.role() = 'authenticated');

-- -----------------------------------------------------------
-- links  (directed edges between nodes)
-- kind: supports | depends | conflicts
-- Unique constraint prevents duplicate (from, to, kind) triples.
-- -----------------------------------------------------------
create table if not exists public.links (
  id          bigint      not null primary key generated always as identity,
  from_id     text        not null references public.nodes (id) on delete cascade,
  to_id       text        not null references public.nodes (id) on delete cascade,
  kind        text        not null,
  created_by  uuid        references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint links_kind_check check (kind in ('supports', 'depends', 'conflicts')),
  constraint links_from_id_to_id_kind_key unique (from_id, to_id, kind)
);

alter table public.links enable row level security;

create policy "links: public read"
  on public.links for select using (true);

create policy "links: authenticated insert"
  on public.links for insert with check (auth.role() = 'authenticated');

create policy "links: author delete"
  on public.links for delete using (auth.uid() = created_by);

-- -----------------------------------------------------------
-- votes  (node credibility votes — the original vote table)
-- value: integer credibility rating per user per node.
-- -----------------------------------------------------------
create table if not exists public.votes (
  id          bigint      not null primary key generated always as identity,
  node_id     text        not null references public.nodes (id) on delete cascade,
  user_id     uuid        not null references auth.users  (id) on delete cascade,
  value       integer     not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint votes_node_id_user_id_key unique (node_id, user_id),
  constraint votes_value_check check (value between -1 and 1)
);

alter table public.votes enable row level security;

create policy "votes: public read"
  on public.votes for select using (true);

create policy "votes: own insert"
  on public.votes for insert with check (auth.uid() = user_id);

create policy "votes: own update"
  on public.votes for update using (auth.uid() = user_id);

create policy "votes: own delete"
  on public.votes for delete using (auth.uid() = user_id);

-- -----------------------------------------------------------
-- node_vote_summary  (view — drives node colour in D3 graph)
-- -----------------------------------------------------------
create or replace view public.node_vote_summary as
select
  node_id,
  count(*)                                          as total_votes,
  sum(case when value  > 0 then 1 else 0 end)       as up_votes,
  sum(case when value  < 0 then 1 else 0 end)       as down_votes,
  coalesce(avg(value), 0)                           as avg_value
from public.votes
group by node_id;

-- -----------------------------------------------------------
-- challenges  (a challenge record — one per challenge event)
-- target_type: 'node' | 'source' | 'link'
-- -----------------------------------------------------------
create table if not exists public.challenges (
  id              text        not null primary key,
  target_id       text        not null,
  target_type     text        not null,
  challenge_type  text        not null,
  reason          text        not null,
  user_id         uuid        not null references auth.users (id) on delete cascade,
  status          text        not null default 'pending',
  created_at      timestamptz not null default now(),
  constraint challenges_target_type_check check (target_type in ('node', 'source', 'link'))
);

alter table public.challenges enable row level security;

create policy "challenges: public read"
  on public.challenges for select using (true);

create policy "challenges: authenticated insert"
  on public.challenges for insert with check (auth.role() = 'authenticated');

-- -----------------------------------------------------------
-- challenge_votes  (votes on individual challenges)
-- Each row = one user voting on one challenge.
-- valid = true means the user agrees the challenge is valid.
-- -----------------------------------------------------------
create table if not exists public.challenge_votes (
  id            bigint      not null primary key generated always as identity,
  challenge_id  text        not null references public.challenges (id) on delete cascade,
  target_id     text        not null,
  target_type   text        not null,
  reason        text        not null default '',
  user_id       uuid        not null references auth.users (id) on delete cascade,
  valid         boolean     not null,
  created_at    timestamptz not null default now(),
  constraint challenge_votes_challenge_id_user_id_key unique (challenge_id, user_id)
);

alter table public.challenge_votes enable row level security;

create policy "challenge_votes: public read"
  on public.challenge_votes for select using (true);

create policy "challenge_votes: own insert"
  on public.challenge_votes for insert with check (auth.uid() = user_id);

create policy "challenge_votes: own update"
  on public.challenge_votes for update using (auth.uid() = user_id);

create policy "challenge_votes: own delete"
  on public.challenge_votes for delete using (auth.uid() = user_id);

-- -----------------------------------------------------------
-- challenge_vote_summary  (view — drives Ⓒ badge darkness
--   and feeds the challenge trigger)
-- -----------------------------------------------------------
create or replace view public.challenge_vote_summary as
select
  challenge_id,
  target_id,
  target_type,
  reason,
  created_at,
  count(*)                                               as total_votes,
  sum(case when valid = true  then 1 else 0 end)         as valid_votes,
  sum(case when valid = false then 1 else 0 end)         as invalid_votes
from public.challenge_votes
group by challenge_id, target_id, target_type, reason, created_at;

-- -----------------------------------------------------------
-- submissions  (proposed new or edited nodes awaiting review)
-- -----------------------------------------------------------
create table if not exists public.submissions (
  id          text        not null primary key,
  node_id     text        references public.nodes (id) on delete set null,
  title       text        not null,
  summary     text        not null default '',
  type        text        not null,
  links_json  jsonb       not null default '{}',
  user_id     uuid        not null references auth.users (id) on delete cascade,
  status      text        not null default 'pending',
  created_at  timestamptz not null default now(),
  constraint submissions_type_check check (type in ('fact', 'claim', 'question'))
);

alter table public.submissions enable row level security;

create policy "submissions: public read"
  on public.submissions for select using (true);

create policy "submissions: authenticated insert"
  on public.submissions for insert with check (auth.role() = 'authenticated');

create policy "submissions: own update"
  on public.submissions for update using (auth.uid() = user_id);
