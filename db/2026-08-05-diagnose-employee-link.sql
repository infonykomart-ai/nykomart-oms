-- Run this in the Supabase SQL Editor. It does two things:
--   1. Shows you the CURRENT state (before) so we can see exactly what was
--      wrong.
--   2. Force-syncs every one of the 15 employees' auth_user_id to whatever
--      their email's real, current auth.users.id is right now — this fixes
--      it even if the earlier linking script's ON CONFLICT DO NOTHING
--      silently skipped an update (e.g. because the employees row already
--      existed with a stale id, or the auth user was deleted/recreated
--      after that script ran, which issues a brand new id).
-- Safe to re-run any time.

-- BEFORE — what employees currently has vs. what auth.users actually is:
SELECT
  e.name,
  e.auth_user_id AS employees_table_has,
  u.id           AS auth_users_actually_is,
  u.email,
  (e.auth_user_id = u.id) AS ids_match
FROM employees e
JOIN auth.users u ON u.email = ANY(ARRAY[
  'ajay.mahawar@abc.com', 'girraj.sharma@abc.com', 'monika.saini@abc.com', 'neelu.soni@abc.com',
  'rahul.verma@abc.com', 'ritika.sharma@abc.com', 'roshni@abc.com', 'sumit@abc.com', 'sahil@abc.com',
  'vinit.verma@abc.com', 'gajanand@abc.com', 'vijay.nayak@abc.com', 'ajay.lohra@abc.com',
  'rd.lohra@abc.com', 'bheem.raj@abc.com'
])
WHERE e.name = CASE u.email
  WHEN 'ajay.mahawar@abc.com'  THEN 'Ajay Mahawar'
  WHEN 'girraj.sharma@abc.com' THEN 'Girraj Sharma'
  WHEN 'monika.saini@abc.com'  THEN 'Monika Saini'
  WHEN 'neelu.soni@abc.com'    THEN 'Neelu Soni'
  WHEN 'rahul.verma@abc.com'   THEN 'Rahul Verma'
  WHEN 'ritika.sharma@abc.com' THEN 'Ritika Sharma'
  WHEN 'roshni@abc.com'        THEN 'Roshni'
  WHEN 'sumit@abc.com'         THEN 'Sumit'
  WHEN 'sahil@abc.com'         THEN 'Sahil'
  WHEN 'vinit.verma@abc.com'   THEN 'Vinit Verma'
  WHEN 'gajanand@abc.com'      THEN 'Gajanand'
  WHEN 'vijay.nayak@abc.com'   THEN 'Vijay Nayak'
  WHEN 'ajay.lohra@abc.com'    THEN 'Ajay Lohra'
  WHEN 'rd.lohra@abc.com'      THEN 'RD Lohra'
  WHEN 'bheem.raj@abc.com'     THEN 'Bheem Raj'
END
ORDER BY e.name;

-- FIX — force every one of these 15 employees rows to point at their
-- email's real, current auth.users.id.
UPDATE employees e
SET auth_user_id = u.id
FROM auth.users u
WHERE e.name = CASE u.email
  WHEN 'ajay.mahawar@abc.com'  THEN 'Ajay Mahawar'
  WHEN 'girraj.sharma@abc.com' THEN 'Girraj Sharma'
  WHEN 'monika.saini@abc.com'  THEN 'Monika Saini'
  WHEN 'neelu.soni@abc.com'    THEN 'Neelu Soni'
  WHEN 'rahul.verma@abc.com'   THEN 'Rahul Verma'
  WHEN 'ritika.sharma@abc.com' THEN 'Ritika Sharma'
  WHEN 'roshni@abc.com'        THEN 'Roshni'
  WHEN 'sumit@abc.com'         THEN 'Sumit'
  WHEN 'sahil@abc.com'         THEN 'Sahil'
  WHEN 'vinit.verma@abc.com'   THEN 'Vinit Verma'
  WHEN 'gajanand@abc.com'      THEN 'Gajanand'
  WHEN 'vijay.nayak@abc.com'   THEN 'Vijay Nayak'
  WHEN 'ajay.lohra@abc.com'    THEN 'Ajay Lohra'
  WHEN 'rd.lohra@abc.com'      THEN 'RD Lohra'
  WHEN 'bheem.raj@abc.com'     THEN 'Bheem Raj'
END
AND (e.auth_user_id IS DISTINCT FROM u.id);

-- AFTER — confirm every row now matches (ids_match should be all "true"):
SELECT
  e.name,
  e.auth_user_id AS employees_table_has,
  u.id           AS auth_users_actually_is,
  u.email,
  (e.auth_user_id = u.id) AS ids_match
FROM employees e
JOIN auth.users u ON u.id = e.auth_user_id
WHERE u.email IN (
  'ajay.mahawar@abc.com', 'girraj.sharma@abc.com', 'monika.saini@abc.com', 'neelu.soni@abc.com',
  'rahul.verma@abc.com', 'ritika.sharma@abc.com', 'roshni@abc.com', 'sumit@abc.com', 'sahil@abc.com',
  'vinit.verma@abc.com', 'gajanand@abc.com', 'vijay.nayak@abc.com', 'ajay.lohra@abc.com',
  'rd.lohra@abc.com', 'bheem.raj@abc.com'
)
ORDER BY e.name;
