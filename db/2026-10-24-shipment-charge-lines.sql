-- 2026-10-24 — "OUR SHIPPING CHARGES ADD KARNE KA OPTION NAHI HAI KAHA PAR
-- KARE ... AWB, PO NO RF NO RG NO ya jo bhi apna system hai ke anusar search
-- ho or add ho" + the courier-wise charge-head list (Base Freight, Fuel
-- Surcharge, Remote Area, Duty/Import Tax, RTO, …).
--
-- Until now the ONLY place a courier charge could be recorded was the four
-- fixed columns on freight_bill_awb_assignments (Base / Fuel / Remote /
-- Other) — one lumped "Other" bucket per AWB. That cannot represent what a
-- real FedEx / UPS / Aramex invoice itemises (fuel surcharge, remote area,
-- residential delivery, customs clearance, duty, RTO, address correction,
-- weight discrepancy, …) and it only exists once a FREIGHT BILL has been
-- created — there was no way to record a charge against a shipment before
-- that.
--
-- This table is the per-shipment charge ledger: one row per charge line,
-- linked to the order (and to the specific AWB when there is one), tagged
-- with the courier and the charge head, so a shipment's true cost can be
-- built up as the courier's charges land.
--
-- `direction` exists because a PO can also come BACK to India: an inbound
-- return carries its own freight, customs clearance and duty/tax figures
-- ("agar kisi country se vapas India aara hai to uska freight charge, duty
-- vagera sab ka data bhi maintain hoga"), which must never be mixed into the
-- export cost of the same PO. 'export' is the default for the normal
-- outbound case.
--
-- gst_pct defaults to 18 (the standard rate on Indian courier service
-- charges); set it to 0 for heads that are not taxed (e.g. duty/import tax
-- itself). total_amt is generated so line totals can never disagree with the
-- amount + GST that was typed.
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS shipment_charge_lines (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                 uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_shipment_id        uuid REFERENCES order_shipments(id) ON DELETE SET NULL,
  awb_no                   text,
  courier_name             text NOT NULL DEFAULT 'FedEx',
  direction                text NOT NULL DEFAULT 'export'
                             CHECK (direction IN ('export', 'return_to_india')),
  charge_head              text NOT NULL,
  amount                   numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency                 text NOT NULL DEFAULT 'INR',
  gst_pct                  numeric(5,2) NOT NULL DEFAULT 18 CHECK (gst_pct >= 0 AND gst_pct <= 100),
  gst_amt                  numeric(14,2) GENERATED ALWAYS AS (amount * gst_pct / 100) STORED,
  total_amt                numeric(14,2) GENERATED ALWAYS AS (amount + amount * gst_pct / 100) STORED,
  bill_no                  text,
  bill_date                date,
  remark                   text,
  entered_by_employee_id   uuid REFERENCES employees(id) ON DELETE SET NULL,
  entered_by_name          text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipment_charge_lines_order
  ON shipment_charge_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_shipment_charge_lines_shipment
  ON shipment_charge_lines(order_shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_charge_lines_awb
  ON shipment_charge_lines(awb_no);
CREATE INDEX IF NOT EXISTS idx_shipment_charge_lines_created
  ON shipment_charge_lines(created_at DESC);

COMMENT ON TABLE shipment_charge_lines IS
  'Per-shipment courier charge lines (base freight, fuel, remote, customs, duty, RTO, …) — '
  'one row per charge head, tagged export vs return-to-India, so a shipment''s real cost is '
  'captured as the courier''s charges land instead of being squeezed into four fixed columns.';
COMMENT ON COLUMN shipment_charge_lines.direction IS
  'export = outbound shipment from India; return_to_india = a PO coming back to India '
  '(its own inbound freight / customs / duty figures, never mixed with the export cost).';
