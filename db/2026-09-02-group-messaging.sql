-- 2026-09-02: Group Messaging — "massaging group banane ka option hona
-- chahiye", built alongside the new Messenger-style popup UI. Adds 3 new
-- tables (conversations, conversation_members, conversation_messages),
-- parallel to the existing direct_messages table which this migration does
-- NOT touch. See db/schema.sql's matching section for the full rationale
-- comments. Idempotent — safe to run even if partially applied already
-- (CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS before each CREATE).

CREATE TABLE IF NOT EXISTS conversations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      text NOT NULL,
  created_by_employee_id    uuid NOT NULL REFERENCES employees(id),
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id           uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  employee_id               uuid NOT NULL REFERENCES employees(id),
  added_by_employee_id      uuid REFERENCES employees(id),
  joined_at                 timestamptz NOT NULL DEFAULT now(),
  last_read_at              timestamptz,
  PRIMARY KEY (conversation_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_members_employee ON conversation_members(employee_id);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id           uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_employee_id        uuid NOT NULL REFERENCES employees(id),
  body                      text,
  attachment_path           text,
  attachment_name           text,
  attachment_mime           text,
  attachment_size_bytes     bigint,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_messages_has_content CHECK (body IS NOT NULL OR attachment_path IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conv_created ON conversation_messages(conversation_id, created_at);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversations_select_member ON conversations;
CREATE POLICY conversations_select_member ON conversations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM conversation_members cm
    JOIN employees e ON e.id = cm.employee_id
    WHERE cm.conversation_id = conversations.id AND e.auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS conversation_members_select_fellow_member ON conversation_members;
CREATE POLICY conversation_members_select_fellow_member ON conversation_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM conversation_members cm2
    JOIN employees e ON e.id = cm2.employee_id
    WHERE cm2.conversation_id = conversation_members.conversation_id AND e.auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS conversation_messages_select_member ON conversation_messages;
CREATE POLICY conversation_messages_select_member ON conversation_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM conversation_members cm
    JOIN employees e ON e.id = cm.employee_id
    WHERE cm.conversation_id = conversation_messages.conversation_id AND e.auth_user_id = auth.uid()
  ));

CREATE OR REPLACE FUNCTION get_unread_group_message_count(p_employee_id uuid)
RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT COUNT(*)::integer
  FROM conversation_messages cm
  JOIN conversation_members mem
    ON mem.conversation_id = cm.conversation_id AND mem.employee_id = p_employee_id
  WHERE cm.sender_employee_id <> p_employee_id
    AND cm.created_at > COALESCE(mem.last_read_at, mem.joined_at);
$$;

-- IMPORTANT — Realtime: the new Messenger popup subscribes to
-- conversation_messages INSERTs with no per-conversation filter (RLS above
-- is what actually restricts which rows reach a given employee), so this
-- table also needs to be added to the supabase_realtime publication, the
-- same way direct_messages already must be. Wrapped in a DO block with an
-- exception handler (not a bare ALTER PUBLICATION) because Postgres raises
-- duplicate_object if it's already a member on a re-run — left bare, that
-- error would abort this whole script's implicit transaction and roll
-- back every CREATE TABLE/INDEX/FUNCTION above it too, defeating the
-- "safe to run even if partially applied" guarantee this file promises.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE conversation_messages;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already added, nothing to do
END $$;
