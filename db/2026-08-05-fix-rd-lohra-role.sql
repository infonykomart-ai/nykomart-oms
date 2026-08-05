-- RD Lohra ko Owner/MD role dena hai (abhi Admin set hai) — run once.
UPDATE employees
SET role_id = (SELECT id FROM roles WHERE name = 'MD')
WHERE name = 'RD Lohra';

-- Confirm:
SELECT e.name, r.name AS role FROM employees e JOIN roles r ON r.id = e.role_id WHERE e.name = 'RD Lohra';
