-- Invoice broker info + Duty & Taxes payable-by block — 2026-08-11.
--
-- User's ask, verbatim: "if there is a designated broker for this
-- shipment, please provide contact information. Name of Broker / Tel No /
-- Contact no." + "Duty & Taxes payable by () Exporter () Consignee ()
-- Other, If other please specify" + "agar ddp karenge to to check box
-- automaticly mark ho jayega exporter vala, agar ddu karenge to
-- consignee vala checkbox mark ho jayega".
--
-- broker_name/broker_tel/broker_contact: plain manual text fields, usually
-- left blank (most shipments have no separate customs broker).
--
-- duty_payable_by: auto-derived AT GENERATION TIME from the invoice's own
-- shipment_term (see src/lib/invoices/duty-payable.ts) —
--   shipment_term contains "DDP" -> 'Exporter'
--   shipment_term contains "DDU" or "DAP" -> 'Consignee'
--   anything else -> NULL (left blank, preparer picks manually)
-- Like every other field on sales_invoices, this is a one-time computed
-- default that stays freely editable afterward (updateInvoiceFields) —
-- never auto-resynced if shipment_term is edited later.
--
-- duty_payable_other_specify: free text, only meaningful when
-- duty_payable_by = 'Other'.

ALTER TABLE sales_invoices
  ADD COLUMN broker_name text,
  ADD COLUMN broker_tel text,
  ADD COLUMN broker_contact text,
  ADD COLUMN duty_payable_by text CHECK (duty_payable_by IN ('Exporter', 'Consignee', 'Other')),
  ADD COLUMN duty_payable_other_specify text;

COMMENT ON COLUMN sales_invoices.broker_name IS 'Designated customs broker for this shipment, if any — usually blank.';
COMMENT ON COLUMN sales_invoices.broker_tel IS 'Broker''s telephone number.';
COMMENT ON COLUMN sales_invoices.broker_contact IS 'Broker''s contact person / contact number.';
COMMENT ON COLUMN sales_invoices.duty_payable_by IS 'Who pays duty & taxes — auto-derived from shipment_term at generation (DDP -> Exporter, DDU/DAP -> Consignee), then freely editable. See src/lib/invoices/duty-payable.ts.';
COMMENT ON COLUMN sales_invoices.duty_payable_other_specify IS 'Free-text detail when duty_payable_by = ''Other''.';
