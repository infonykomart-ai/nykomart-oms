-- 2026-08-18 — adds the 7 couriers this business actually uses (Shiprocket,
-- Delhivery, DHL, FedEx, Aramex, Shipglobal, UPS — same list already
-- confirmed for the courier-tracking integrations, see
-- claude/security-rls-and-marketplace-automation-2026-08-10.md) as real
-- Party Master rows.
--
-- Why this is needed: the Courier/Duty Bill "Vendor / Courier Party"
-- dropdown (built 2026-08-17, see claude/party-ledger-build-2026-08-17.md)
-- groups any party with party_type='Courier' under "🚚 Courier", but ZERO
-- such parties existed — all 17 existing parties are purchase/job-work
-- vendors. Without this, the dropdown has nothing courier-shaped to pick,
-- so no Courier/Duty bill could ever actually be vendor-linked.
--
-- User confirmed (2026-08-18): "all courier use accroding to low rate" —
-- i.e. no single preferred courier, shipments go to whichever of these is
-- cheapest at the time, so all 7 are added (not just the 1-2 most common).
--
-- invoice_type = 'FREIGHT INVOICE' matches how the party-options grouping
-- helper (groupPartyOptions) already treats courier-shaped parties
-- elsewhere; party_type = 'Courier' is what actually drives the dropdown
-- grouping. address/contact_no/gst/bank fields are left NULL — fill in
-- via Party Master's own edit screen if/when you have real account
-- details for each courier to record.
--
-- Idempotent — ON CONFLICT (name) DO NOTHING, since parties.name is
-- UNIQUE. Safe to run again if this file is re-run by mistake.

INSERT INTO parties (name, party_type, invoice_type)
VALUES
  ('Shiprocket', 'Courier', 'FREIGHT INVOICE'),
  ('Delhivery',  'Courier', 'FREIGHT INVOICE'),
  ('DHL',        'Courier', 'FREIGHT INVOICE'),
  ('FedEx',      'Courier', 'FREIGHT INVOICE'),
  ('Aramex',     'Courier', 'FREIGHT INVOICE'),
  ('Shipglobal', 'Courier', 'FREIGHT INVOICE'),
  ('UPS',        'Courier', 'FREIGHT INVOICE')
ON CONFLICT (name) DO NOTHING;
