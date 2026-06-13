# ScienceDB — Next Steps

## ✅ Done
- Supabase self-hosted on `teatreestudio.hopto.org`
- Auth via GitHub Pages (`sanoj2021.github.io`)
- Node graph with D3 force layout
- `votes` table + `node_vote_summary` view (drives node color)
- `challenge_votes` table + `challenge_vote_summary` view (drives Ⓒ badge darkness)
- RLS on `challenge_votes` (users own only their rows)
- `nodes.status` constraint: `new | open | challenged | retired`
- Add fact modal → direct insert to `nodes` with `status = 'new'`
- Challenge modal on selected node
- Challenge vote panel in detail sidebar
- ✅ Challenge trigger deployed (`fn_update_node_status_from_challenge`)
  — auto-flips `nodes.status` based on challenge vote ratio
  — migration file: `supabase/migrations/20260612121434_challenge_trigger_fix.sql`
- ✅ Realtime enabled via Supabase UI dashboard (Database → Publications → supabase_realtime)
  — tables enabled: `nodes`, `challenge_votes`, `votes`
- ✅ Add connections between existing nodes (UI)
  — `+ Connect` button in detail sidebar opens modal
  — live search/filter of target nodes (excludes self + already-linked targets)
  — relationship type picker: `supports | depends | conflicts`
  — inserts row into `links` table; re-renders graph without full reload

---

## 🔜 Up next (priority order)

### 1. Edge voting system
Edges (connections) need the same confidence mechanism as nodes.
- `edge_votes` table: `(edge_id, user_id, vote int, created_at)`
  — unique constraint `(edge_id, user_id)`
- `edge_vote_summary` view: total votes, up/down ratio
- Edge line thickness or opacity driven by vote count
- Edge color driven by vote ratio (same green/yellow/red thresholds as nodes)
- Vote UI: clicking an edge opens the detail panel with edge info + vote slider

### 2. RLS hardening
- `votes` — users own only their rows ✅ (already set)
- `links` — any authenticated user can insert; only author can delete ✅ (already set)
- `challenge_votes` — users own only their rows ✅ (already set)
- `nodes` — review: currently author-update only; confirm admin-delete policy
- `submissions` — review moderator-approve flow

### 3. Node search + filter bar
- Full-text search across `title` and `summary`
- Filter by `type` (fact / claim / question) and `status`
- Highlight matched nodes on the graph, grey-out the rest

### 4. User profile & contribution history
- `/profile` view: nodes created, votes cast, challenges submitted
- Karma score (rough: upvoted facts + resolved challenges)

### 5. Notifications
- Realtime Supabase subscription: notify the node author when their node
  gets challenged or reaches the challenge-retirement threshold

---

## 🗃️ DB migration files

| File | Location | Description |
|---|---|---|
| `001_initial_schema` | `supabase/migrations/20260101000000_initial_schema.sql` | Baseline schema: nodes, links, sources, node_sources, votes, challenges, challenge_votes, submissions, views, RLS |
| `002_challenge_trigger` | `db/migrations/002_challenge_trigger.sql` | Legacy reference copy of the trigger (pre-Supabase CLI) |
| `challenge_trigger_fix` | `supabase/migrations/20260612121434_challenge_trigger_fix.sql` | Corrected trigger using `target_id`/`target_type` schema — **deployed to production 2026-06-12** |
