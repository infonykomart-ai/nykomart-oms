-- 2026-09-19 (audit fix, Phase 4 / D — reclassified HIGH from the original "LOW severity
-- duplicate RLS policies, harmless" finding) — group-messaging RLS was not actually
-- restrictive: `allow_authenticated_all` (PERMISSIVE, ALL commands, qual=true) on
-- conversations / conversation_members / conversation_messages / companion_events /
-- companion_character_image meant ANY logged-in employee could read (and write/delete) every
-- row directly via the Supabase REST API or Realtime — completely bypassing the server
-- actions' own membership checks (popup-actions.ts, group-actions.ts). Confirmed
-- live-exploitable via the app's own "unread group message" badge subscription
-- (messenger-popup.tsx lines 136-145), whose 2026-09-02 developer comment explicitly says it
-- "leans entirely on the SELECT RLS policy" to scope to the employee's own conversations — a
-- policy that, until now, never actually restricted anything because of this blanket grant.
--
-- Fix: drop the blanket allow_authenticated_all policy on these 5 tables (+ direct_messages,
-- redundant cleanup only — that table was already properly protected by its own RESTRICTIVE
-- policy layer, see direct_messages_owner_restrictive / direct_messages_delete_sender_only).
-- The existing correctly-scoped SELECT policies already do the right thing and stay in place
-- (recreated here only to fold in the auth_rls_initplan perf fix — wrapping auth.uid() as
-- (select auth.uid()) so it's evaluated once per query instead of once per row):
--   conversations_select_member, conversation_members_select_fellow_member,
--   conversation_messages_select_member, companion_events_select_own,
--   companion_character_image_select_all (this last one is an intentionally-shared "default"
--   character asset, not per-employee data, so an open SELECT for any authenticated user is
--   correct and was already the case).
-- All real writes to these tables already go through server actions using the service-role
-- client (verified: popup-actions.ts, group-actions.ts, companion-access/actions.ts,
-- notify.ts, help-center/actions.ts all use createServiceRoleClient(), which bypasses RLS
-- entirely) — so removing authenticated-role INSERT/UPDATE/DELETE access here does not affect
-- any real app flow. help_articles gets the same allow_authenticated_all removal — its
-- existing help_articles_read_all (open SELECT, intentional — help content for all employees)
-- is untouched, and writes already go through help-center/actions.ts's service-role client.
--
-- Idempotent — safe to re-run (DROP POLICY IF EXISTS + CREATE POLICY replaces in place).

DROP POLICY IF EXISTS allow_authenticated_all ON conversations;
DROP POLICY IF EXISTS allow_authenticated_all ON conversation_members;
DROP POLICY IF EXISTS allow_authenticated_all ON conversation_messages;
DROP POLICY IF EXISTS allow_authenticated_all ON companion_events;
DROP POLICY IF EXISTS allow_authenticated_all ON companion_character_image;
DROP POLICY IF EXISTS allow_authenticated_all ON help_articles;
DROP POLICY IF EXISTS allow_authenticated_all ON direct_messages;

DROP POLICY IF EXISTS conversations_select_member ON conversations;
CREATE POLICY conversations_select_member ON conversations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM conversation_members cm JOIN employees e ON e.id = cm.employee_id
    WHERE cm.conversation_id = conversations.id AND e.auth_user_id = (select auth.uid())
  ));

DROP POLICY IF EXISTS conversation_members_select_fellow_member ON conversation_members;
CREATE POLICY conversation_members_select_fellow_member ON conversation_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM conversation_members cm2 JOIN employees e ON e.id = cm2.employee_id
    WHERE cm2.conversation_id = conversation_members.conversation_id AND e.auth_user_id = (select auth.uid())
  ));

DROP POLICY IF EXISTS conversation_messages_select_member ON conversation_messages;
CREATE POLICY conversation_messages_select_member ON conversation_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM conversation_members cm JOIN employees e ON e.id = cm.employee_id
    WHERE cm.conversation_id = conversation_messages.conversation_id AND e.auth_user_id = (select auth.uid())
  ));

DROP POLICY IF EXISTS companion_events_select_own ON companion_events;
CREATE POLICY companion_events_select_own ON companion_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM employees e WHERE e.id = companion_events.employee_id AND e.auth_user_id = (select auth.uid())
  ));

DROP POLICY IF EXISTS companion_character_image_select_all ON companion_character_image;
CREATE POLICY companion_character_image_select_all ON companion_character_image FOR SELECT
  USING ((select auth.uid()) IS NOT NULL);
