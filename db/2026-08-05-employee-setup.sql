-- Run this ONCE in the Supabase SQL Editor for the already-applied
-- database (project coowiuszsjxtnfismmfw). It brings the live database up
-- to date with two schema changes made after you first applied
-- db/schema.sql, and links the 15 real employee logins you already
-- created in Authentication -> Users to actual employee records.
-- Safe to re-run — every step is written to skip rows that already exist.

-- 1. Admin role was missing 7 capabilities in the schema you originally
--    applied (order_entry, csv_upload, etc.) — see db/schema.sql's
--    2026-08-05 comment on the Admin role seed.
INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, cap FROM roles r
JOIN (VALUES
  ('Admin', 'order_entry'), ('Admin', 'csv_upload'), ('Admin', 'bill_payment'),
  ('Admin', 'salary_admin'), ('Admin', 'statement_entry'), ('Admin', 'approve_level1'),
  ('Admin', 'approve_level2')
) AS rc(role_name, cap) ON rc.role_name = r.name
ON CONFLICT (role_id, capability_code) DO NOTHING;

-- 2. New table (2026-08-05): lets one login work across more than one
--    company — see db/schema.sql's employee_company_access comment.
CREATE TABLE IF NOT EXISTS employee_company_access (
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, company_id)
);

-- 3. Link each Supabase Auth login (matched by email) to a real employee
--    row. Home company is Nyko Mart for all of them (arbitrary — step 4
--    below grants all 3 companies anyway, switchable from the dashboard
--    header). Role per your instructions: Vinit -> Finance, Gajanand /
--    Ajay Lohra -> Admin, RD Lohra -> MD (Owner/MD), everyone else ->
--    Order Entry.
INSERT INTO employees (company_id, auth_user_id, name, role_id, active)
SELECT (SELECT id FROM companies WHERE short_code = 'NM'), u.id, v.name, r.id, true
FROM (VALUES
  ('ajay.mahawar@abc.com',  'Ajay Mahawar',  'Order Entry'),
  ('girraj.sharma@abc.com', 'Girraj Sharma', 'Order Entry'),
  ('monika.saini@abc.com',  'Monika Saini',  'Order Entry'),
  ('neelu.soni@abc.com',    'Neelu Soni',    'Order Entry'),
  ('rahul.verma@abc.com',   'Rahul Verma',   'Order Entry'),
  ('ritika.sharma@abc.com', 'Ritika Sharma', 'Order Entry'),
  ('roshni@abc.com',        'Roshni',        'Order Entry'),
  ('sumit@abc.com',         'Sumit',         'Order Entry'),
  ('sahil@abc.com',         'Sahil',         'Order Entry'),
  ('vinit.verma@abc.com',   'Vinit Verma',   'Finance'),
  ('gajanand@abc.com',      'Gajanand',      'Admin'),
  ('vijay.nayak@abc.com',   'Vijay Nayak',   'Order Entry'),
  ('ajay.lohra@abc.com',    'Ajay Lohra',    'Admin'),
  ('rd.lohra@abc.com',      'RD Lohra',      'MD'),
  ('bheem.raj@abc.com',     'Bheem Raj',     'Order Entry')
) AS v(email, name, role_name)
JOIN auth.users u ON u.email = v.email
JOIN roles r ON r.name = v.role_name
ON CONFLICT (company_id, name) DO NOTHING;

-- 4. Grant every one of these 15 logins access to all 3 companies.
INSERT INTO employee_company_access (employee_id, company_id)
SELECT e.id, c.id
FROM employees e
JOIN auth.users u ON u.id = e.auth_user_id
CROSS JOIN companies c
WHERE u.email IN (
  'ajay.mahawar@abc.com', 'girraj.sharma@abc.com', 'monika.saini@abc.com', 'neelu.soni@abc.com',
  'rahul.verma@abc.com', 'ritika.sharma@abc.com', 'roshni@abc.com', 'sumit@abc.com', 'sahil@abc.com',
  'vinit.verma@abc.com', 'gajanand@abc.com', 'vijay.nayak@abc.com', 'ajay.lohra@abc.com',
  'rd.lohra@abc.com', 'bheem.raj@abc.com'
)
ON CONFLICT (employee_id, company_id) DO NOTHING;

-- 5. Sanity check — should list all 15 with their role and Nyko Mart as
--    home company (the dashboard header lets each of them switch to
--    Rugara / CASA ARRA too).
SELECT e.name, r.name AS role, c.name AS home_company, u.email
FROM employees e
JOIN roles r ON r.id = e.role_id
JOIN companies c ON c.id = e.company_id
JOIN auth.users u ON u.id = e.auth_user_id
ORDER BY e.name;
