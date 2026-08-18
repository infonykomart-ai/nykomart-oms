-- 2026-08-18 — "photo ka preview nahi aata" / "photo ke link kaam nahi
-- karte": Orders never had a real photo-upload pipeline, only a plain
-- paste-a-link field (photo_url on orders), which frequently got a
-- non-direct-image link pasted into it (a product page, a Drive "share"
-- link, etc.) that can never render as an <img>. This creates the Storage
-- bucket the new Upload button (src/app/dashboard/orders/photo-url-field.tsx
-- + uploadOrderPhoto() in src/app/dashboard/orders/actions.ts) writes to.
--
-- PUBLIC bucket (unlike the private 'message-attachments' bucket) — order
-- photos are plain product photos, not private content, and need to render
-- directly in printed invoices / WhatsApp-shared links without going
-- through an auth-gated proxy route. Uploads still only happen through the
-- server action (via the service-role client, which bypasses RLS/bucket
-- policy entirely), so making the bucket public only affects reads, not
-- who can write to it.
--
-- Idempotent — safe to run again.
insert into storage.buckets (id, name, public)
values ('order-photos', 'order-photos', true)
on conflict (id) do nothing;
