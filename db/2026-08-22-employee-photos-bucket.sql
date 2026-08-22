-- 2026-08-22 — "URL ki jagah upload ka option kar do": Employee Master's
-- Photo field was a plain paste-a-link text input (profile-fields.tsx),
-- same pre-existing limitation as orders.photo_url before 2026-08-18. This
-- creates the Storage bucket the new upload-only field
-- (src/app/dashboard/admin/employees/employee-photo-field.tsx +
-- uploadEmployeePhoto() in src/app/dashboard/admin/employees/actions.ts)
-- writes to. Same pattern as db/2026-08-18-order-photos-bucket.sql.
--
-- PUBLIC bucket — employee photos need to render directly in the admin UI
-- without going through an auth-gated proxy route. Uploads still only
-- happen through the server action (service-role client, bypasses
-- RLS/bucket policy entirely, and gated behind requireCapability
-- ("employee_admin")), so making the bucket public only affects reads, not
-- who can write to it.
--
-- Idempotent — safe to run again.
insert into storage.buckets (id, name, public)
values ('employee-photos', 'employee-photos', true)
on conflict (id) do nothing;
