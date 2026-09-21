-- 2026-09-21 — Courier Bill per-AWB charge breakup ("couriour ke bill aaye
-- unke charges hai ye bhi update karo" + "total shipping amt = per awb
-- charges jisme fuel+remote+other hote hai phir GST alag aata hai phir gross
-- shipping ammount").
--
-- Until now only billed_freight_amt (the shipment's single "Total") was
-- persisted per AWB. The real bill breaks each shipment's charge into
-- components and levies GST separately, so the Courier Bill Report's
-- "Total Shipping Amt / GST / Gross Shipping" per-AWB columns need the
-- breakup captured as its own fields:
--
--   billed_base_amt    — the line-haul/base freight charge for this AWB
--   billed_fuel_amt    — fuel surcharge for this AWB
--   billed_remote_amt  — remote-area / delivery-area surcharge for this AWB
--   billed_other_amt   — everything else (address correction, residential,
--                        oversize…) billed on this AWB
--   billed_gst_amt     — GST actually charged ON this AWB (bills don't
--                        always break GST per line; when they don't, the
--                        header GST is prorated across AWBs by their
--                        pre-tax charge share and stored here so the report
--                        reads straight values)
--
-- billed_freight_amt keeps its meaning: the AWB's TOTAL pre-GST charge
-- (base+fuel+remote+other as printed). The five new columns are the breakup
-- behind it; report gross = billed_freight_amt + billed_gst_amt.
ALTER TABLE freight_bill_awb_assignments
  ADD COLUMN IF NOT EXISTS billed_base_amt   numeric(14,2),
  ADD COLUMN IF NOT EXISTS billed_fuel_amt   numeric(14,2),
  ADD COLUMN IF NOT EXISTS billed_remote_amt numeric(14,2),
  ADD COLUMN IF NOT EXISTS billed_other_amt  numeric(14,2),
  ADD COLUMN IF NOT EXISTS billed_gst_amt    numeric(14,2);

COMMENT ON COLUMN freight_bill_awb_assignments.billed_freight_amt IS
  '2026-09-21: this AWB''s TOTAL pre-GST charge as billed (base+fuel+remote+other). The billed_*_amt breakup columns hold the components; report gross shipping = this + billed_gst_amt. Previously only this total was stored (2026-09-01).';
