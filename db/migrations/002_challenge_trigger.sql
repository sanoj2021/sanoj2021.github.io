-- ============================================================
-- Migration 002 — Challenge trigger
-- Auto-flips nodes.status based on challenge_vote_summary.
--
-- Rules:
--   • A node becomes 'challenged' when it receives its first
--     challenge_vote with vote = 1 ("valid concern").
--   • A node is 'retired' when:
--       total_votes >= 5  AND  valid_pct >= 0.60
--   • A 'challenged' node is restored to 'open' when:
--       total_votes >= 5  AND  valid_pct < 0.40
--     (community voted the challenge down)
--   • Thresholds can be tuned by adjusting the constants below.
-- ============================================================

-- 1. Helper function called by the trigger
CREATE OR REPLACE FUNCTION public.fn_update_node_status_from_challenge()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_node_id        uuid;
  v_total          int;
  v_valid          int;
  v_valid_pct      numeric;
  v_current_status text;

  -- Tunable thresholds
  c_min_votes      CONSTANT int     := 5;
  c_retire_pct     CONSTANT numeric := 0.60;   -- ≥60% valid → retire
  c_restore_pct    CONSTANT numeric := 0.40;   -- <40% valid → restore to open
BEGIN
  -- Work on the node that was just voted on
  v_node_id := COALESCE(NEW.node_id, OLD.node_id);

  -- Read current vote summary
  SELECT total_votes, valid_votes
    INTO v_total, v_valid
    FROM public.challenge_vote_summary
   WHERE node_id = v_node_id;

  -- No votes yet (e.g. after delete of last row) → nothing to do
  IF v_total IS NULL THEN
    RETURN NEW;
  END IF;

  v_valid_pct := v_valid::numeric / NULLIF(v_total, 0);

  SELECT status INTO v_current_status
    FROM public.nodes
   WHERE id = v_node_id;

  -- ── Decision tree ────────────────────────────────────────────

  -- Any valid-concern vote → mark challenged (if not already retired)
  IF v_valid > 0 AND v_current_status NOT IN ('challenged', 'retired') THEN
    UPDATE public.nodes SET status = 'challenged' WHERE id = v_node_id;
    RETURN NEW;
  END IF;

  -- Enough votes + majority valid → retire
  IF v_total >= c_min_votes AND v_valid_pct >= c_retire_pct
     AND v_current_status != 'retired' THEN
    UPDATE public.nodes SET status = 'retired' WHERE id = v_node_id;
    RETURN NEW;
  END IF;

  -- Enough votes + challenge voted down → restore to open
  IF v_total >= c_min_votes AND v_valid_pct < c_restore_pct
     AND v_current_status = 'challenged' THEN
    UPDATE public.nodes SET status = 'open' WHERE id = v_node_id;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;


-- 2. Attach trigger to challenge_votes (INSERT, UPDATE, DELETE)
DROP TRIGGER IF EXISTS trg_challenge_votes_update_status ON public.challenge_votes;

CREATE TRIGGER trg_challenge_votes_update_status
  AFTER INSERT OR UPDATE OR DELETE
  ON public.challenge_votes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_node_status_from_challenge();


-- 3. Sanity-check: run a manual back-fill for any node whose
--    current challenge_vote_summary already meets the thresholds
--    (handles rows that existed before the trigger was added).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT cvs.node_id,
           cvs.total_votes,
           cvs.valid_votes,
           cvs.valid_votes::numeric / NULLIF(cvs.total_votes,0) AS valid_pct,
           n.status
      FROM public.challenge_vote_summary cvs
      JOIN public.nodes n ON n.id = cvs.node_id
  LOOP
    IF r.total_votes >= 5 AND r.valid_pct >= 0.60 AND r.status != 'retired' THEN
      UPDATE public.nodes SET status = 'retired' WHERE id = r.node_id;
    ELSIF r.total_votes >= 5 AND r.valid_pct < 0.40 AND r.status = 'challenged' THEN
      UPDATE public.nodes SET status = 'open'    WHERE id = r.node_id;
    ELSIF r.valid_votes > 0 AND r.status NOT IN ('challenged','retired') THEN
      UPDATE public.nodes SET status = 'challenged' WHERE id = r.node_id;
    END IF;
  END LOOP;
END;
$$;
