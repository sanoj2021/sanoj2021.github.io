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
- ✅ Edge voting system
  — `edge_votes` table: `(edge_id, user_id, vote int, created_at)` with unique `(edge_id, user_id)` constraint
  — `edge_vote_summary` view: total votes, up/down ratio
  — Edge line thickness/opacity driven by vote count
  — Edge color driven by vote ratio (same green/yellow/red thresholds as nodes)
  — Clicking an edge opens detail panel with edge info + vote slider
  — Fixed bigint/string coercion bug (`Number()` coercions in `renderGraph`, `renderEdgeDetail`, `renderLinkedPanel`)
- ✅ RLS hardening
  — migration: `supabase/migrations/20260616000000_rls_hardening.sql`
  — `admins` table added (opt-in allowlist, populated via Supabase dashboard)
  — `is_admin()` helper function (SECURITY DEFINER, granted to `authenticated`)
  — `nodes: admin delete` policy — hard-delete cascades to links/votes/challenges
  — `submissions: own update pending` — submitter can edit content while pending, cannot self-approve
  — `submissions: moderator update` — admins can approve/reject/reopen
  — `submissions: own delete pending` — submitter can withdraw their pending submission
  — **Action required:** insert your user_id into `admins` table via Supabase dashboard to activate admin powers
- ✅ Node search + filter bar
  — Full-text search across `title` and `summary` (debounced, 180 ms)
  — Filter pills: type (`fact | claim | question`) and status (`new | open | challenged | retired`)
  — Matched nodes highlighted with dashed ring; unmatched nodes dimmed to 12% opacity
  — Live result count badge (`N / total nodes`)

---

## 🔜 Up next (priority order)

### 1. User profile & contribution history
- `/profile` view (slide-in panel): nodes created, votes cast (node + edge), challenges submitted
- Karma score (rough: upvoted facts + resolved challenges)
- 🔄 **In progress**

### 2. Node/edge voting history
- Per-node vote history table: who voted what, when (admin only / own votes)
- Per-edge vote history: same pattern
- Timeline chart of votes cast over time on a given node/edge

### 3. Notifications
- Realtime Supabase subscription: notify the node author when their node
  gets challenged or reaches the challenge-retirement threshold

---

## 🗃️ DB migration files

| File | Location | Description |
|---|---|---|
| `001_initial_schema` | `supabase/migrations/20260101000000_initial_schema.sql` | Baseline schema: nodes, links, sources, node_sources, votes, challenges, challenge_votes, submissions, views, RLS |
| `002_challenge_trigger` | `db/migrations/002_challenge_trigger.sql` | Legacy reference copy of the trigger (pre-Supabase CLI) |
| `challenge_trigger_fix` | `supabase/migrations/20260612121434_challenge_trigger_fix.sql` | Corrected trigger using `target_id`/`target_type` schema — **deployed to production 2026-06-12** |
| `rls_hardening` | `supabase/migrations/20260616000000_rls_hardening.sql` | `admins` table, `is_admin()` helper, node admin-delete, submissions moderator flow — **deploy to production** |
