-- ============================================================
-- Migration 003 — Edge (link) voting system
--
-- Allows users to vote 1–5 on the confidence / relevance of
-- a directed connection (edge) between two nodes.
--
-- • link_votes         — one row per (link_id, user_id)
-- • link_vote_summary  — materialised-like view; aggregates
--                        per link: total votes, avg, up/down
-- • upsert_link_vote   — RPC used by the front-end so a user
--                        can create-or-update their vote in
--                        one call (mirrors upsert_vote for nodes)
-- ============================================================

-- 1. link_votes table -----------------------------------------
CREATE TABLE IF NOT EXISTS public.link_votes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id    uuid        NOT NULL REFERENCES public.links(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  value      smallint    NOT NULL CHECK (value BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (link_id, user_id)
);

ALTER TABLE public.link_votes ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read all votes (same policy as node votes)
CREATE POLICY "read link votes" ON public.link_votes
  FOR SELECT USING (auth.role() = 'authenticated');

-- Users may only insert/update/delete their own votes
CREATE POLICY "own link votes" ON public.link_votes
  FOR ALL USING (user_id = auth.uid());


-- 2. link_vote_summary view -----------------------------------
-- Mirrors the node_vote_summary view pattern so the front-end
-- can consume both in a uniform way.
CREATE OR REPLACE VIEW public.link_vote_summary AS
SELECT
  lv.link_id                                       AS id,
  COUNT(*)                                         AS total_votes,
  ROUND(AVG(lv.value)::numeric, 2)                 AS avg_confidence,
  SUM(CASE WHEN lv.value >= 4 THEN 1 ELSE 0 END)  AS up_votes,
  SUM(CASE WHEN lv.value <= 2 THEN 1 ELSE 0 END)  AS down_votes
FROM public.link_votes lv
GROUP BY lv.link_id;


-- 3. upsert_link_vote RPC -------------------------------------
-- Insert a new vote or update an existing one atomically.
-- p_link_id : uuid  — the links.id to vote on
-- p_value   : int   — 1..5
CREATE OR REPLACE FUNCTION public.upsert_link_vote(
  p_link_id uuid,
  p_value   int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.link_votes (link_id, user_id, value)
  VALUES (p_link_id, auth.uid(), p_value)
  ON CONFLICT (link_id, user_id)
  DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END;
$$;
