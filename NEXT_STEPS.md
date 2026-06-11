# ScienceDB — Next Steps

## ✅ Done
- Supabase self-hosted on `teatreestudio.hopto.org`
- Auth via GitHub Pages (`sanoj2021.github.io`)
- Node graph with D3 force layout
- `node_votes` table + `node_vote_summary` view (drives node color)
- `challenge_votes` table + `challenge_vote_summary` view (drives Ⓒ badge darkness)
- RLS on `challenge_votes` (users own only their rows)
- `nodes.status` constraint: `new | open | challenged | retired`
- Add fact modal → direct insert to `nodes` with `status = 'new'`
- Challenge modal on selected node
- Challenge vote panel in detail sidebar

---

## 🔜 Up next (priority order)

### 1. Challenge trigger in DB ← *in progress*
Auto-flip `nodes.status` based on challenge vote ratio.
See `db/migrations/002_challenge_trigger.sql`.

### 2. Add connections between existing nodes (UI)
After a node is selected, allow the user to pick a second node and a
relationship type (`supports | depends | conflicts`) to create a new edge.
- Add **"+ Connect"** button in the detail sidebar (only when a node is selected)
- Open a small panel / modal: search/select target node, pick edge type
- Insert row into `edges` table (or equivalent)
- Re-render graph without full reload

### 3. Edge voting system
Edges (connections) need the same confidence mechanism as nodes.
- `edge_votes` table: `(edge_id, user_id, vote int, created_at)`
  — unique constraint `(edge_id, user_id)`
- `edge_vote_summary` view: total votes, up/down ratio
- Edge line thickness or opacity driven by vote count
- Edge color driven by vote ratio (same green/yellow/red thresholds as nodes)
- Vote UI: clicking an edge opens the detail panel with edge info + vote slider

### 4. RLS hardening
- `node_votes` — users own only their rows
- `edges` — any authenticated user can insert; only author can delete
- `edge_votes` — users own only their rows
- `nodes` — authenticated insert; only author or admin can delete

### 5. Node search + filter bar
- Full-text search across `title` and `summary`
- Filter by `type` (fact / claim / question) and `status`
- Highlight matched nodes on the graph, grey-out the rest

### 6. User profile & contribution history
- `/profile` view: nodes created, votes cast, challenges submitted
- Karma score (rough: upvoted facts + resolved challenges)

### 7. Notifications
- Realtime Supabase subscription: notify the node author when their node
  gets challenged or reaches the challenge-retirement threshold

---

## 🗃️ DB migration files

| File | Description |
|---|---|
| `db/migrations/001_initial_schema.sql` | Baseline schema (nodes, edges, sources, node_votes, challenge_votes, views) |
| `db/migrations/002_challenge_trigger.sql` | Auto-flip node status based on challenge vote ratio |
