-- =============================================================
-- RLS Hardening
-- Addresses two gaps identified in the initial schema:
--
--   1. nodes — no DELETE policy existed. Added admin-only delete
--      via a dedicated `admins` table (opt-in allowlist).
--
--   2. submissions — `own update` policy allowed the submitter
--      to flip `status` to 'approved' themselves. Replaced with
--      two separate policies:
--        a. own update  — submitter can edit title/summary/type
--           only while status = 'pending' (cannot touch status).
--        b. moderator update — admins can update any column
--           (including status → approved/rejected).
--      Added own delete so submitters can withdraw pending submissions.
-- =============================================================

-- -----------------------------------------------------------
-- admins  (opt-in allowlist — insert rows manually in dashboard)
-- -----------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid not null primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- Only admins can read the admins table (no public exposure)
create policy "admins: admin read"
  on public.admins for select
  using (exists (
    select 1 from public.admins a where a.user_id = auth.uid()
  ));

-- Only a super-admin (service role) may insert/delete admin rows;
-- those operations are done directly in the Supabase dashboard.
-- No INSERT/UPDATE/DELETE policy = anon/authenticated role blocked.

-- -----------------------------------------------------------
-- Helper: is_admin()
-- Centralises the admin check so policies stay readable.
-- SECURITY DEFINER so it can read the admins table regardless
-- of the caller's RLS context.
-- -----------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.admins where user_id = auth.uid()
  );
$$;

grant execute on function public.is_admin() to authenticated;

-- -----------------------------------------------------------
-- nodes — add admin DELETE policy
-- Admins can hard-delete any node (cascades to links,
-- votes, challenges via ON DELETE CASCADE).
-- -----------------------------------------------------------
create policy "nodes: admin delete"
  on public.nodes for delete
  using (public.is_admin());

-- -----------------------------------------------------------
-- submissions — replace overly-broad own-update policy
-- -----------------------------------------------------------

-- Drop the original policy that let submitters update status
drop policy if exists "submissions: own update" on public.submissions;

-- 1. Submitter can edit content fields while still pending,
--    but cannot touch the status column.
create policy "submissions: own update pending"
  on public.submissions for update
  using  (auth.uid() = user_id and status = 'pending')
  with check (
    auth.uid() = user_id
    and status = 'pending'   -- prevents self-approval
  );

-- 2. Admins can update anything (approve, reject, reopen).
create policy "submissions: moderator update"
  on public.submissions for update
  using  (public.is_admin())
  with check (public.is_admin());

-- 3. Submitter can withdraw (delete) their own pending submission.
create policy "submissions: own delete pending"
  on public.submissions for delete
  using (auth.uid() = user_id and status = 'pending');
