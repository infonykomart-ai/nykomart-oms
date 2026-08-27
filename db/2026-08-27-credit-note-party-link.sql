-- 2026-08-27 (later same day) — "esa hi credite note me karo esa hi
-- courior ke credit note debit note me karo": Debit Note's vendor-side
-- Company+Party -> bill dropdown (see 2026-08-27-note-linking-and-
-- adjustments.sql, earlier today) needs the same treatment on Credit
-- Note, so a vendor-issued credit note (e.g. a courier's credit note
-- reducing what we owe them) can be raised against + applied against a
-- real bill_pass_register row, same as Debit Note. credit_notes had no
-- party_id at all before this — it was purely sales/buyer-refund
-- oriented (Store, Buyer, Refund Type); credit_notes.bill_pass_register_id
-- already existed (added in the earlier migration, unused until now).
ALTER TABLE credit_notes
  ADD COLUMN party_id uuid REFERENCES parties(id);
CREATE INDEX idx_credit_notes_party ON credit_notes(party_id);

-- Run in Supabase SQL editor. Safe to run alongside/after
-- 2026-08-27-note-linking-and-adjustments.sql — this only adds one nullable
-- column + index to a table that migration already touched (its own
-- bill_pass_register_id ALTER), no conflict.
