-- 2026-08-20 -- Rugara order-linked freight & duty import (freight_charges.xlsx
-- and duty.xlsx). Both files share the identical 149-row PO/order-number
-- skeleton (mostly a blank template -- only 149 of 1074 rows have any PONO at
-- all); of those, 111 POs match a real order (101 Rugara, 7 Nyko Mart, 2 CASA
-- ARRA -- user confirmed: import by each order's real company, not just Rugara).
-- The other 38 POs (style 'PO-730', no 'A') match no order anywhere in the
-- system and are skipped entirely -- listed at the bottom of this file.
--
-- purchase_bill.xlsx (the 3rd file in this upload) is NOT imported here: all 149
-- of its rows are the same PO/order skeleton with every purchase-specific column
-- (VENDOR, BILLDATE, amounts) completely blank -- there is no purchase data in
-- that file to import.
--
-- Schema note discovered while building this: freight_bill_awb_assignments and
-- duty_bill_awb_assignments both require a NOT NULL order_shipment_id, and none
-- of these 111 orders had an existing order_shipments row for this AWB. So this
-- migration first creates one order_shipments row per order (Part 1) from the
-- file's own DISPATCHNO./THIRDPARTYNAME columns, then attaches freight/duty cost
-- rows to it. freight.xlsx and duty.xlsx agree on DISPATCHNO for all 110 orders
-- present in both files, so one shipment row serves both.
--
-- Second schema note: freight_bills.total_amt/gst_18pct_amt/gross_total_amt and
-- duty_tax_bills.gross_total_amt are GENERATED columns (fixed 18% GST formula off
-- freight_amt+fuel_amt+other_charges, resp. duty_tax_amt_inr+gst_18pct_amt) --
-- they cannot be inserted directly, so the file's own BILLSHIPPINGAMT./GST18%./
-- GROSSAMT. columns (freight) are NOT written; only freight_amt/other_charges/
-- bill_weight_kg feed in, and the DB computes its own total/GST/gross from those.
-- For duty, duty_tax_amt_usd/duty_tax_amt_inr/gst_18pct_amt ARE writable and are
-- taken directly from the file; only gross_total_amt is left to the DB.
--
-- Of the 111 orders, only 76 have a courier-issued freight invoice number yet
-- (23 distinct invoices) and only 59 have a courier duty invoice number yet (28
-- distinct invoices) -- the rest are shipments that have gone out but haven't
-- been billed by the courier yet. Only the invoiced ones get a freight_bills /
-- duty_tax_bills + assignment row (Part 2 / Part 3); the order_shipments row from
-- Part 1 is still created for all 111 so the shipment itself is on record.
--
-- 2 of the 23 freight invoices (276428860, 276430482) already exist as
-- freight_bills rows from other orders -- these are only extended with new
-- freight_bill_awb_assignments rows, not re-inserted as a header.
--
-- Two source cells were malformed and are imported as NULL/0 rather than guessed:
--   PO-A467-1/2: OURSHIPPINGAMT.='10.360.70' (double decimal) -> treated as 0 for
--     that row's contribution to its invoice's freight_amt sum; DEFRENCEAMT.=
--     '#VALUE!' (an Excel formula error) -> imported as NULL.
--   PO-A08: OURSHIPPINGWEIGHTKG.='.13.155' -- not used, this column isn't mapped
--     to any target field, so it's dropped regardless.
--
-- Compound courier duty-invoice numbers (e.g. '108100171086&108500039102', two
-- UPS references joined with '&' in the source file) are imported as a single
-- literal invoice_no string rather than split -- the file gives no instruction
-- on how to divide the amount between them.
--
-- Dry-run tested (Part 2/3 header inserts + a synthetic-order sample of Part 1/
-- assignment inserts) against the local scratch Postgres; full end-to-end could
-- not be tested there since that DB doesn't have these 111 real orders. Please
-- review before running, and re-verify results after.

BEGIN;

-- Part 1: create the order_shipments row for each of the 111 orders.
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '873432980793'
FROM orders o WHERE o.ref_no = 'PO-A323'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '873432980793');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0412240050'
FROM orders o WHERE o.ref_no = 'PO-A41'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0412240050');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0434779867'
FROM orders o WHERE o.ref_no = 'PO-A112'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0434779867');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0414565107'
FROM orders o WHERE o.ref_no = 'PO-A191-1/2'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0414565107');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '872769760340'
FROM orders o WHERE o.ref_no = 'PO-A220-2/2'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '872769760340');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874356380170'
FROM orders o WHERE o.ref_no = 'PO-A386'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874356380170');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0405914265'
FROM orders o WHERE o.ref_no = 'PO-A31'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0405914265');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '872729776985'
FROM orders o WHERE o.ref_no = 'PO-A222-1/3'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '872729776985');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0405025832'
FROM orders o WHERE o.ref_no = 'PO-A19'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0405025832');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874830939507'
FROM orders o WHERE o.ref_no = 'PO-A434'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874830939507');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0429808095'
FROM orders o WHERE o.ref_no = 'PO-A78'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0429808095');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874599544072'
FROM orders o WHERE o.ref_no = 'PO-A410'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874599544072');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874252197322'
FROM orders o WHERE o.ref_no = 'PO-A385-1/2'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874252197322');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0446059416'
FROM orders o WHERE o.ref_no = 'PO-A164'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0446059416');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '872729776985'
FROM orders o WHERE o.ref_no = 'PO-A222-2/3'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '872729776985');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0402376889'
FROM orders o WHERE o.ref_no = 'PO-A75'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0402376889');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0427107471'
FROM orders o WHERE o.ref_no = 'PO-A73'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0427107471');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874255057120'
FROM orders o WHERE o.ref_no = 'PO-A373-1/2'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874255057120');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874600236327'
FROM orders o WHERE o.ref_no = 'PO-A429-1/3'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874600236327');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '872427544972'
FROM orders o WHERE o.ref_no = 'PO-A203'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '872427544972');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0429182056'
FROM orders o WHERE o.ref_no = 'PO-A103'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0429182056');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0448583640'
FROM orders o WHERE o.ref_no = 'PO-A185-1/2'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0448583640');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '873429350950'
FROM orders o WHERE o.ref_no = 'PO-A317'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '873429350950');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874911554000'
FROM orders o WHERE o.ref_no = 'PO-A452'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874911554000');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874252197322'
FROM orders o WHERE o.ref_no = 'PO-A385-2/2'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874252197322');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874089291009'
FROM orders o WHERE o.ref_no = 'PO-A350'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874089291009');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0438509105'
FROM orders o WHERE o.ref_no = 'PO-A113'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0438509105');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874357218384'
FROM orders o WHERE o.ref_no = 'PO-A387'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874357218384');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0448412744'
FROM orders o WHERE o.ref_no = 'PO-A312'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0448412744');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874665669441'
FROM orders o WHERE o.ref_no = 'PO-A430'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874665669441');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0445380936'
FROM orders o WHERE o.ref_no = 'PO-A08'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0445380936');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '872427633051'
FROM orders o WHERE o.ref_no = 'PO-A201'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '872427633051');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874212241903'
FROM orders o WHERE o.ref_no = 'PO-A382'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874212241903');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0446221463'
FROM orders o WHERE o.ref_no = 'PO-A213'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0446221463');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '872729776985'
FROM orders o WHERE o.ref_no = 'PO-A222-3/3'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '872729776985');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874600236327'
FROM orders o WHERE o.ref_no = 'PO-A429-2/3'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874600236327');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '873065009193'
FROM orders o WHERE o.ref_no = 'PO-A293'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '873065009193');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874348503764'
FROM orders o WHERE o.ref_no = 'PO-A360'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874348503764');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '872769760340'
FROM orders o WHERE o.ref_no = 'PO-A220-1/2'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '872769760340');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0419653824'
FROM orders o WHERE o.ref_no = 'PO-A18'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0419653824');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '873482163808'
FROM orders o WHERE o.ref_no = 'PO-A303'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '873482163808');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0412037299'
FROM orders o WHERE o.ref_no = 'PO-A132'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0412037299');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0414489244'
FROM orders o WHERE o.ref_no = 'PO-A32'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0414489244');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '873648678296'
FROM orders o WHERE o.ref_no = 'PO-A332'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '873648678296');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0435432523'
FROM orders o WHERE o.ref_no = 'PO-A198'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0435432523');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874600236327'
FROM orders o WHERE o.ref_no = 'PO-A429-3/3'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874600236327');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874255057120'
FROM orders o WHERE o.ref_no = 'PO-A373-2/2'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874255057120');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '872731396416'
FROM orders o WHERE o.ref_no = 'PO-A202'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '872731396416');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0448583640'
FROM orders o WHERE o.ref_no = 'PO-A185-2/2'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0448583640');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '873428886226'
FROM orders o WHERE o.ref_no = 'PO-A316'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '873428886226');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0439039835'
FROM orders o WHERE o.ref_no = 'PO-A53'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0439039835');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0422150049'
FROM orders o WHERE o.ref_no = 'PO-A108'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0422150049');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '873922423682'
FROM orders o WHERE o.ref_no = 'PO-A337'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '873922423682');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0414565107'
FROM orders o WHERE o.ref_no = 'PO-A191-2/2'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0414565107');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '872022037231'
FROM orders o WHERE o.ref_no = 'PO-A120'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '872022037231');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '872770465586'
FROM orders o WHERE o.ref_no = 'PO-A244'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '872770465586');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874831532910'
FROM orders o WHERE o.ref_no = 'PO-A487'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874831532910');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874089590548'
FROM orders o WHERE o.ref_no = 'PO-A364'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874089590548');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874152144072'
FROM orders o WHERE o.ref_no = 'PO-A365'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874152144072');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874967737439'
FROM orders o WHERE o.ref_no = 'PO-A439'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874967737439');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874562932348'
FROM orders o WHERE o.ref_no = 'PO-A428'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874562932348');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0422011145'
FROM orders o WHERE o.ref_no = 'PO-A235'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0422011145');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0448251230'
FROM orders o WHERE o.ref_no = 'PO-A172'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0448251230');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0426302930'
FROM orders o WHERE o.ref_no = 'PO-A228'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0426302930');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874715103074'
FROM orders o WHERE o.ref_no = 'PO-A423'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874715103074');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874563211645'
FROM orders o WHERE o.ref_no = 'PO-A397'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874563211645');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874355067281'
FROM orders o WHERE o.ref_no = 'PO-A409'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874355067281');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '872730570790'
FROM orders o WHERE o.ref_no = 'PO-A219'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '872730570790');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0408187877'
FROM orders o WHERE o.ref_no = 'PO-A81'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0408187877');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874563490733'
FROM orders o WHERE o.ref_no = 'PO-A404'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874563490733');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0420008813'
FROM orders o WHERE o.ref_no = 'PO-A12'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0420008813');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0433795912'
FROM orders o WHERE o.ref_no = 'PO-A114'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0433795912');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '873479741858'
FROM orders o WHERE o.ref_no = 'PO-A298'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '873479741858');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '873648078245'
FROM orders o WHERE o.ref_no = 'PO-A329'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '873648078245');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874712123147'
FROM orders o WHERE o.ref_no = 'PO-A424'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874712123147');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'UPS', '1Z0G054Y0429448886'
FROM orders o WHERE o.ref_no = 'PO-A91'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '1Z0G054Y0429448886');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875452913334'
FROM orders o WHERE o.ref_no = 'PO-A503'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875452913334');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'Delhivery', 'DL345796640XB'
FROM orders o WHERE o.ref_no = 'PO-A609'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = 'DL345796640XB');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875455251026'
FROM orders o WHERE o.ref_no = 'PO-A513'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875455251026');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875453163594'
FROM orders o WHERE o.ref_no = 'PO-A521'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875453163594');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875092484623'
FROM orders o WHERE o.ref_no = 'PO-A492'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875092484623');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875503459289'
FROM orders o WHERE o.ref_no = 'PO-A531'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875503459289');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875719279901'
FROM orders o WHERE o.ref_no = 'PO-A533'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875719279901');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875772181542'
FROM orders o WHERE o.ref_no = 'PO-A564-2/2'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875772181542');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875853489479'
FROM orders o WHERE o.ref_no = 'PO-A539'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875853489479');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875454276940'
FROM orders o WHERE o.ref_no = 'PO-A504'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875454276940');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875772181542'
FROM orders o WHERE o.ref_no = 'PO-A564-1/2'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875772181542');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875717160780'
FROM orders o WHERE o.ref_no = 'PO-A537'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875717160780');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875852886224'
FROM orders o WHERE o.ref_no = 'PO-A572'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875852886224');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875718596766'
FROM orders o WHERE o.ref_no = 'PO-A532'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875718596766');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875452421545'
FROM orders o WHERE o.ref_no = 'PO-A484'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875452421545');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875188718068'
FROM orders o WHERE o.ref_no = 'PO-A485-2/2'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875188718068');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875854165837'
FROM orders o WHERE o.ref_no = 'PO-A566'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875854165837');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875502741749'
FROM orders o WHERE o.ref_no = 'PO-A522'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875502741749');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875460129991'
FROM orders o WHERE o.ref_no = 'PO-A520'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875460129991');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875502640670'
FROM orders o WHERE o.ref_no = 'PO-A541'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875502640670');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '876031312340'
FROM orders o WHERE o.ref_no = 'PO-A574'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '876031312340');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875142763264'
FROM orders o WHERE o.ref_no = 'PO-A407'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875142763264');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875452166244'
FROM orders o WHERE o.ref_no = 'PO-A488'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875452166244');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875503570908'
FROM orders o WHERE o.ref_no = 'PO-A538'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875503570908');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875718036790'
FROM orders o WHERE o.ref_no = 'PO-A536'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875718036790');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875033538890'
FROM orders o WHERE o.ref_no = 'PO-A467-2/2'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875033538890');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875716792075'
FROM orders o WHERE o.ref_no = 'PO-A551'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875716792075');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875720036046'
FROM orders o WHERE o.ref_no = 'PO-A565'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875720036046');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875454807534'
FROM orders o WHERE o.ref_no = 'PO-A509'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875454807534');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875453949721'
FROM orders o WHERE o.ref_no = 'PO-A506'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875453949721');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '874908904591'
FROM orders o WHERE o.ref_no = 'PO-A450'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '874908904591');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875459814160'
FROM orders o WHERE o.ref_no = 'PO-A548'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875459814160');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875188718068'
FROM orders o WHERE o.ref_no = 'PO-A485-1/2'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875188718068');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875146290351'
FROM orders o WHERE o.ref_no = 'PO-A405-2/2'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875146290351');
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no)
SELECT o.id, COALESCE((SELECT MAX(shipment_no) FROM order_shipments WHERE order_id = o.id), 0) + 1, 'FedEx', '875033538890'
FROM orders o WHERE o.ref_no = 'PO-A467-1/2'
AND NOT EXISTS (SELECT 1 FROM order_shipments os WHERE os.order_id = o.id AND os.awb_no = '875033538890');

-- Part 2: freight_bills header per distinct courier invoice (23), then one
-- freight_bill_awb_assignments row per order (76).
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-04-16', '108000167874', 13.5, 13559.94, 0.0, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '108000167874');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108000167874'), o.id, 13.5, 704.71, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0445380936'
WHERE o.ref_no = 'PO-A08'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-04-23', '108100169301', 21.0, 22614.510000000002, 3075.0, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '108100169301');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100169301'), o.id, 7.0, 2411.43, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0405025832'
WHERE o.ref_no = 'PO-A19'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100169301'), o.id, 4.0, 61.75, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0419653824'
WHERE o.ref_no = 'PO-A18'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100169301'), o.id, 3.5, -37.19, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0414489244'
WHERE o.ref_no = 'PO-A32'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100169301'), o.id, 6.5, 61.76, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0420008813'
WHERE o.ref_no = 'PO-A12'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-04-30', '108100170490', 10.0, 12674.79, 0.0, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '108100170490');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100170490'), o.id, 2.5, -387.15, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0412240050'
WHERE o.ref_no = 'PO-A41'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100170490'), o.id, 1.5, -517.75, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0405914265'
WHERE o.ref_no = 'PO-A31'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100170490'), o.id, 6.0, -1238.79, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0439039835'
WHERE o.ref_no = 'PO-A53'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-05-07', '108100172065', 2.0, 3251.08, 0.0, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '108100172065');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100172065'), o.id, 2.0, -81.8, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0408187877'
WHERE o.ref_no = 'PO-A81'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-05-14', '108100172815', 25.5, 26087.94, 0.0, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '108100172815');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100172815'), o.id, 7.0, -502.0, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0434779867'
WHERE o.ref_no = 'PO-A112'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100172815'), o.id, 13.5, 98.91, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0402376889'
WHERE o.ref_no = 'PO-A75'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100172815'), o.id, 5.0, -12.92, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0422150049'
WHERE o.ref_no = 'PO-A108'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-05-21', '108100173593', 50.5, 52966.11, 0.0, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '108100173593');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100173593'), o.id, 16.0, NULL, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0429808095'
WHERE o.ref_no = 'PO-A78'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100173593'), o.id, 3.0, NULL, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0427107471'
WHERE o.ref_no = 'PO-A73'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100173593'), o.id, 5.5, NULL, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0429182056'
WHERE o.ref_no = 'PO-A103'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100173593'), o.id, 3.0, NULL, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0438509105'
WHERE o.ref_no = 'PO-A113'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100173593'), o.id, 6.0, NULL, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0412037299'
WHERE o.ref_no = 'PO-A132'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100173593'), o.id, 14.5, NULL, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0433795912'
WHERE o.ref_no = 'PO-A114'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100173593'), o.id, 2.5, NULL, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0429448886'
WHERE o.ref_no = 'PO-A91'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-05-28', '108100174309', 6.0, 6799.97, 0.0, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '108100174309');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100174309'), o.id, 6.0, -286.1576, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0446059416'
WHERE o.ref_no = 'PO-A164'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-06-04', '108100175008', 39.0, 43189.46, 3183.3332, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '108100175008');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100175008'), o.id, 13.5, 3195.3038, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0414565107'
WHERE o.ref_no = 'PO-A191-1/2'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100175008'), o.id, 11.5, -0.0226, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0448583640'
WHERE o.ref_no = 'PO-A185-1/2'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100175008'), o.id, 7.5, -89.3964, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0435432523'
WHERE o.ref_no = 'PO-A198'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100175008'), o.id, 0.0, 0.0, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0448583640'
WHERE o.ref_no = 'PO-A185-2/2'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100175008'), o.id, 0.0, 0.0, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0414565107'
WHERE o.ref_no = 'PO-A191-2/2'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100175008'), o.id, 6.5, -163.7994, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0448251230'
WHERE o.ref_no = 'PO-A172'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-06-11', '108100175808', 8.0, 5889.5, 0.0, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '108100175808');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100175808'), o.id, 8.0, 0.15, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0446221463'
WHERE o.ref_no = 'PO-A213'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-06-18', '108100176336', 12.0, 9157.68, 0.0, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '108100176336');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100176336'), o.id, 5.5, -87.11, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0422011145'
WHERE o.ref_no = 'PO-A235'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100176336'), o.id, 6.5, 128.74, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0426302930'
WHERE o.ref_no = 'PO-A228'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-07-02', '108100177712', 4.0, 4376.55, 0.0, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '108100177712');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '108100177712'), o.id, 4.0, 291.64, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0448412744'
WHERE o.ref_no = 'PO-A312'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-06-04', '276425286', 28.1, 26572.5, 0.0, (SELECT id FROM parties WHERE name = 'FedEx')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '276425286');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276425286'), o.id, 28.1, 0.04, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '872022037231'
WHERE o.ref_no = 'PO-A120'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-06-11', '276426146', 10.1, 8933.4, 0.0, (SELECT id FROM parties WHERE name = 'FedEx')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '276426146');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276426146'), o.id, 8.1, 0.08, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '872427544972'
WHERE o.ref_no = 'PO-A203'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276426146'), o.id, 2.0, 0.066, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '872427633051'
WHERE o.ref_no = 'PO-A201'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-06-18', '276426942', 52.8, 50058.9, 0.0, (SELECT id FROM parties WHERE name = 'FedEx')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '276426942');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276426942'), o.id, 36.9, 0.1, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '872729776985'
WHERE o.ref_no = 'PO-A222-1/3'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276426942'), o.id, 0.0, 0.0, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '872729776985'
WHERE o.ref_no = 'PO-A222-2/3'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276426942'), o.id, 0.0, 0.0, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '872729776985'
WHERE o.ref_no = 'PO-A222-3/3'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276426942'), o.id, 13.6, -0.08, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '872731396416'
WHERE o.ref_no = 'PO-A202'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276426942'), o.id, 2.3, 121.28, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '872730570790'
WHERE o.ref_no = 'PO-A219'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-06-25', '276427730', 13.100000000000001, 13492.7, 0.0, (SELECT id FROM parties WHERE name = 'FedEx')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '276427730');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276427730'), o.id, 0.0, 0.0, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '872769760340'
WHERE o.ref_no = 'PO-A220-2/2'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276427730'), o.id, 2.2, 0.034, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '872769760340'
WHERE o.ref_no = 'PO-A220-1/2'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276427730'), o.id, 10.9, 1879.008, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '872770465586'
WHERE o.ref_no = 'PO-A244'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-07-06', '276428860', 12.1, 7417.4, 0.0, (SELECT id FROM parties WHERE name = 'FedEx')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '276428860');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276428860'), o.id, 12.1, 0.08, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '873432980793'
WHERE o.ref_no = 'PO-A323'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-07-06', '276429044', 29.3, 32018.9, 0.0, (SELECT id FROM parties WHERE name = 'FedEx')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '276429044');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276429044'), o.id, 4.1, 0.04, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '873429350950'
WHERE o.ref_no = 'PO-A317'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276429044'), o.id, 8.9, 1885.63, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '873065009193'
WHERE o.ref_no = 'PO-A293'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276429044'), o.id, 3.3, 0.05, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '873482163808'
WHERE o.ref_no = 'PO-A303'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276429044'), o.id, 3.3, -0.02, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '873648678296'
WHERE o.ref_no = 'PO-A332'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276429044'), o.id, 7.5, 0.01, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '873479741858'
WHERE o.ref_no = 'PO-A298'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276429044'), o.id, 2.2, -0.02, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '873648078245'
WHERE o.ref_no = 'PO-A329'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-07-13', '276429836', 10.8, 9091.1, 0.0, (SELECT id FROM parties WHERE name = 'FedEx')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '276429836');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276429836'), o.id, 10.8, -0.03, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '873428886226'
WHERE o.ref_no = 'PO-A316'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-07-20', '276430482', 29.5, 23097.0, 0.0, (SELECT id FROM parties WHERE name = 'FedEx')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '276430482');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276430482'), o.id, 7.0, -0.06, 4.913, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874089291009'
WHERE o.ref_no = 'PO-A350'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276430482'), o.id, 22.5, -0.09, 19.36, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874089590548'
WHERE o.ref_no = 'PO-A364'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-07-20', '276430665', 9.899999999999999, 11657.0, 0.0, (SELECT id FROM parties WHERE name = 'FedEx')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '276430665');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276430665'), o.id, 5.6, -0.05, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '873922423682'
WHERE o.ref_no = 'PO-A337'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276430665'), o.id, 4.3, 0.03, 3.4162, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874152144072'
WHERE o.ref_no = 'PO-A365'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-07-27', '276431478', 60.5, 49352.76, 0.0, (SELECT id FROM parties WHERE name = 'FedEx')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '276431478');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276431478'), o.id, 14.1, -0.1, 12.32, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874356380170'
WHERE o.ref_no = 'PO-A386'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276431478'), o.id, 14.3, 0.03, 10.9296, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874252197322'
WHERE o.ref_no = 'PO-A385-1/2'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276431478'), o.id, 11.7, 0.08, 8.7032, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874255057120'
WHERE o.ref_no = 'PO-A373-1/2'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276431478'), o.id, 0.0, 0.0, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874252197322'
WHERE o.ref_no = 'PO-A385-2/2'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276431478'), o.id, 4.2, -0.07, 3.264, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874357218384'
WHERE o.ref_no = 'PO-A387'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276431478'), o.id, 4.0, -0.03, 2.871, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874212241903'
WHERE o.ref_no = 'PO-A382'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276431478'), o.id, 9.5, 0.04, 7.7616, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874348503764'
WHERE o.ref_no = 'PO-A360'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276431478'), o.id, 0.0, 0.0, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874255057120'
WHERE o.ref_no = 'PO-A373-2/2'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276431478'), o.id, 2.7, -0.04, 2.1632, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874355067281'
WHERE o.ref_no = 'PO-A409'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-08-03', '276432368', 39.8, 34861.2, 0.0, (SELECT id FROM parties WHERE name = 'FedEx')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '276432368');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276432368'), o.id, 2.1, 0.06, 1.7864, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874599544072'
WHERE o.ref_no = 'PO-A410'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276432368'), o.id, 13.4, 0.07, 10.0464, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874600236327'
WHERE o.ref_no = 'PO-A429-1/3'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276432368'), o.id, 10.4, -0.03, 8.6, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874665669441'
WHERE o.ref_no = 'PO-A430'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276432368'), o.id, 0.0, 0.0, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874600236327'
WHERE o.ref_no = 'PO-A429-2/3'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276432368'), o.id, 0.0, 0.0, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874600236327'
WHERE o.ref_no = 'PO-A429-3/3'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276432368'), o.id, 7.5, 0.08, 6.552, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874562932348'
WHERE o.ref_no = 'PO-A428'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276432368'), o.id, 2.5, 0.06, 1.863, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874715103074'
WHERE o.ref_no = 'PO-A423'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276432368'), o.id, 3.9, 0.0, 3.4782, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874563490733'
WHERE o.ref_no = 'PO-A404'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bills (invoice_date, invoice_no, bill_weight_kg, freight_amt, other_charges, vendor_party_id)
SELECT '2026-08-10', '276433300', 54.099999999999994, 43212.899999999994, 0.0, (SELECT id FROM parties WHERE name = 'FedEx')
WHERE NOT EXISTS (SELECT 1 FROM freight_bills WHERE invoice_no = '276433300');
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276433300'), o.id, 7.2, 0.09, 5.6848, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874830939507'
WHERE o.ref_no = 'PO-A434'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276433300'), o.id, 9.2, 0.0, 7.252, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874911554000'
WHERE o.ref_no = 'PO-A452'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276433300'), o.id, 17.5, -0.07, 12.852, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874831532910'
WHERE o.ref_no = 'PO-A487'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276433300'), o.id, 4.8, 0.04, 3.7944, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874967737439'
WHERE o.ref_no = 'PO-A439'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276433300'), o.id, 1.9, 0.03, 1.6016, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874563211645'
WHERE o.ref_no = 'PO-A397'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);
INSERT INTO freight_bill_awb_assignments (freight_bill_id, order_id, bill_weight_kg, difference_amt, dimensional_weight_kg, order_shipment_id)
SELECT (SELECT id FROM freight_bills WHERE invoice_no = '276433300'), o.id, 13.5, -0.09, 11.025, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874712123147'
WHERE o.ref_no = 'PO-A424'
AND NOT EXISTS (SELECT 1 FROM freight_bill_awb_assignments fba WHERE fba.order_id = o.id AND fba.order_shipment_id = os.id);

-- Part 3: duty_tax_bills header per distinct courier invoice (28), then one
-- duty_bill_awb_assignments row per order (59).
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-04-29', '108100170071&108500038859', 24.01, 1926.11, 235.0512, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '108100170071&108500038859');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100170071&108500038859'), o.id, 24.01, 1926.11, 235.0512, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0405025832'
WHERE o.ref_no = 'PO-A19'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-04-29', '108100170072&108500038860', 20.01, 1566.08, 235.0512, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '108100170072&108500038860');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100170072&108500038860'), o.id, 20.01, 1566.08, 235.0512, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0419653824'
WHERE o.ref_no = 'PO-A18'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-05-06', '108100171085&108500039101', 19.63, 1529.74, 237.0816, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '108100171085&108500039101');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100171085&108500039101'), o.id, 19.63, 1529.74, 237.0816, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0405914265'
WHERE o.ref_no = 'PO-A31'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-05-06', '108100171086&108500039102', 20.33, 1592.78, 237.0816, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '108100171086&108500039102');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100171086&108500039102'), o.id, 20.33, 1592.78, 237.0816, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0412240050'
WHERE o.ref_no = 'PO-A41'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-05-21', '108100173216&108500039477', 54.92, 4360.58, 581.598, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '108100173216&108500039477');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100173216&108500039477'), o.id, 31.9, 2578.24, 292.4172, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0402376889'
WHERE o.ref_no = 'PO-A75'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100173216&108500039477'), o.id, 23.02, 1782.34, 289.1808, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0408187877'
WHERE o.ref_no = 'PO-A81'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-05-28', '108100174068&108500039610', 172.98, 13815.869999999999, 1751.58, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '108100174068&108500039610');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100174068&108500039610'), o.id, 26.95, 2132.93, 292.4172, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0434779867'
WHERE o.ref_no = 'PO-A112'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100174068&108500039610'), o.id, 35.33, 2888.26, 291.6864, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0429808095'
WHERE o.ref_no = 'PO-A78'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100174068&108500039610'), o.id, 25.47, 2000.82, 291.6864, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0429182056'
WHERE o.ref_no = 'PO-A103'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100174068&108500039610'), o.id, 23.93, 1861.64, 291.6864, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0438509105'
WHERE o.ref_no = 'PO-A113'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100174068&108500039610'), o.id, 25.54, 2005.83, 292.4172, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0422150049'
WHERE o.ref_no = 'PO-A108'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100174068&108500039610'), o.id, 35.76, 2926.39, 291.6864, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0433795912'
WHERE o.ref_no = 'PO-A114'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-06-10', '108100175581&108500039851', 234.05, 18346.77, 2718.0786000000003, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '108100175581&108500039851');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100175581&108500039851'), o.id, 83.79, 7288.4, 253.1088, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0414565107'
WHERE o.ref_no = 'PO-A191-1/2'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100175581&108500039851'), o.id, 27.19, 2152.24, 295.065, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0446059416'
WHERE o.ref_no = 'PO-A164'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100175581&108500039851'), o.id, 39.73, 2294.45, 1281.18, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0448583640'
WHERE o.ref_no = 'PO-A185-1/2'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100175581&108500039851'), o.id, 27.59, 2191.46, 291.6864, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0412037299'
WHERE o.ref_no = 'PO-A132'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100175581&108500039851'), o.id, 27.51, 2177.43, 298.5192, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0435432523'
WHERE o.ref_no = 'PO-A198'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100175581&108500039851'), o.id, 0.0, 0.0, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0448583640'
WHERE o.ref_no = 'PO-A185-2/2'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100175581&108500039851'), o.id, 0.0, 0.0, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0414565107'
WHERE o.ref_no = 'PO-A191-2/2'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108100175581&108500039851'), o.id, 28.24, 2242.79, 298.5192, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0448251230'
WHERE o.ref_no = 'PO-A172'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-04-29', '108500038861&108100170073', 22.63, 1802.06, 235.0512, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '108500038861&108100170073');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108500038861&108100170073'), o.id, 22.63, 1802.06, 235.0512, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0420008813'
WHERE o.ref_no = 'PO-A12'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-04-29', '108500038862&108100170074', 30.38, 2493.13, 240.7158, (SELECT id FROM parties WHERE name = 'UPS')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '108500038862&108100170074');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '108500038862&108100170074'), o.id, 30.38, 2493.13, 240.7158, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '1Z0G054Y0445380936'
WHERE o.ref_no = 'PO-A08'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-06-07', '276429289', 21.07, 1634.2, 261.702, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276429289');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276429289'), o.id, 21.07, 1634.2, 261.702, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '872427633051'
WHERE o.ref_no = 'PO-A201'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-07-07', '276429432', 132.08, 11592.1, 295.4, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276429432');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276429432'), o.id, 132.08, 11592.1, 295.4, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '873432980793'
WHERE o.ref_no = 'PO-A323'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-07-09', '276429514', 13.71, 1095.0, 138.96, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276429514');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276429514'), o.id, 13.71, 1095.0, 138.96, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '873482163808'
WHERE o.ref_no = 'PO-A303'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-07-13', '276430094', 85.92999999999999, 7158.599999999999, 576.018, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276430094');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276430094'), o.id, 26.44, 2115.8, 263.862, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '872731396416'
WHERE o.ref_no = 'PO-A202'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276430094'), o.id, 29.5, 2606.6, 48.834, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '873922423682'
WHERE o.ref_no = 'PO-A337'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276430094'), o.id, 29.99, 2436.2, 263.322, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '872770465586'
WHERE o.ref_no = 'PO-A244'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-07-16', '276430340', 21.31, 1657.9, 260.244, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276430340');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276430340'), o.id, 21.31, 1657.9, 260.244, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '873648678296'
WHERE o.ref_no = 'PO-A332'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-07-21', '276430993', 81.87, 7006.5, 361.098, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276430993');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276430993'), o.id, 36.33, 3007.1, 262.242, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '872729776985'
WHERE o.ref_no = 'PO-A222-1/3'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276430993'), o.id, 0.0, 0.0, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '872729776985'
WHERE o.ref_no = 'PO-A222-2/3'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276430993'), o.id, 24.69, 2172.4, 49.428, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874357218384'
WHERE o.ref_no = 'PO-A387'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276430993'), o.id, 0.0, 0.0, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '872729776985'
WHERE o.ref_no = 'PO-A222-3/3'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276430993'), o.id, 20.85, 1827.0, 49.428, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874355067281'
WHERE o.ref_no = 'PO-A409'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-07-22', '276431055', 22.62, 1770.4, 265.554, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276431055');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276431055'), o.id, 22.62, 1770.4, 265.554, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874348503764'
WHERE o.ref_no = 'PO-A360'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-07-24', '276431216', 27.11, 2178.3, 261.162, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276431216');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276431216'), o.id, 27.11, 2178.3, 261.162, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '873479741858'
WHERE o.ref_no = 'PO-A298'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-07-28', '276431830', 84.84, 6655.1, 981.0360000000001, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276431830');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276431830'), o.id, 31.48, 2523.1, 310.338, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874562932348'
WHERE o.ref_no = 'PO-A428'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276431830'), o.id, 53.36, 4132.0, 670.698, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874563490733'
WHERE o.ref_no = 'PO-A404'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-07-29', '276431919', 21.1, 1638.6, 260.244, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276431919');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276431919'), o.id, 21.1, 1638.6, 260.244, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '873648078245'
WHERE o.ref_no = 'PO-A329'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-07-30', '276432002', 65.11, 5334.0, 526.176, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276432002');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276432002'), o.id, 38.61, 3211.7, 263.088, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874252197322'
WHERE o.ref_no = 'PO-A385-1/2'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276432002'), o.id, 26.5, 2122.3, 263.088, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874255057120'
WHERE o.ref_no = 'PO-A373-1/2'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276432002'), o.id, 0.0, 0.0, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874252197322'
WHERE o.ref_no = 'PO-A385-2/2'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276432002'), o.id, 0.0, 0.0, 0.0, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874255057120'
WHERE o.ref_no = 'PO-A373-2/2'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-08-03', '276432709', 45.89, 3971.3, 158.184, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276432709');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276432709'), o.id, 12.85, 1077.0, 79.092, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874089291009'
WHERE o.ref_no = 'PO-A350'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276432709'), o.id, 33.04, 2894.3, 79.092, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874089590548'
WHERE o.ref_no = 'PO-A364'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-08-03', '276432735', 135.16000000000003, 11492.6, 671.31, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276432735');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276432735'), o.id, 29.67, 2621.1, 49.194, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874830939507'
WHERE o.ref_no = 'PO-A434'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276432735'), o.id, 58.32, 5199.3, 49.194, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874831532910'
WHERE o.ref_no = 'PO-A487'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276432735'), o.id, 22.46, 1757.6, 263.646, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874152144072'
WHERE o.ref_no = 'PO-A365'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276432735'), o.id, 24.71, 1914.6, 309.276, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874563211645'
WHERE o.ref_no = 'PO-A397'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-08-05', '276432892', 37.07, 3027.6, 308.34, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276432892');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276432892'), o.id, 37.07, 3027.6, 308.34, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874911554000'
WHERE o.ref_no = 'PO-A452'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-07-08', '276433057', 27.87, 2200.7, 307.422, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276433057');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276433057'), o.id, 27.87, 2200.7, 307.422, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874908904591'
WHERE o.ref_no = 'PO-A450'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-08-10', '276433520', 71.42, 5835.8, 592.1279999999999, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276433520');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276433520'), o.id, 32.1, 2745.9, 143.406, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874356380170'
WHERE o.ref_no = 'PO-A386'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276433520'), o.id, 15.22, 1227.9, 141.642, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874212241903'
WHERE o.ref_no = 'PO-A382'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276433520'), o.id, 24.1, 1862.0, 307.08, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '875142763264'
WHERE o.ref_no = 'PO-A407'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-08-11', '276433603', 27.82, 2353.3, 150.84, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276433603');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276433603'), o.id, 27.82, 2353.3, 150.84, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874600236327'
WHERE o.ref_no = 'PO-A429-1/3'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276433603'), o.id, 0.0, NULL, NULL, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874600236327'
WHERE o.ref_no = 'PO-A429-2/3'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276433603'), o.id, 0.0, NULL, NULL, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '874600236327'
WHERE o.ref_no = 'PO-A429-3/3'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-08-12', '276433737', 25.81, 2019.7, 302.958, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276433737');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276433737'), o.id, 25.81, 2019.7, 302.958, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '875453949721'
WHERE o.ref_no = 'PO-A506'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);
INSERT INTO duty_tax_bills (invoice_date, invoice_no, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, vendor_party_id)
SELECT '2026-08-13', '276433851', 25.8, 2019.4, 302.904, (SELECT id FROM parties WHERE name = 'FEDEX')
WHERE NOT EXISTS (SELECT 1 FROM duty_tax_bills WHERE invoice_no = '276433851');
INSERT INTO duty_bill_awb_assignments (duty_tax_bill_id, order_id, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct, order_shipment_id)
SELECT (SELECT id FROM duty_tax_bills WHERE invoice_no = '276433851'), o.id, 25.8, 2019.4, 302.904, os.id
FROM orders o JOIN order_shipments os ON os.order_id = o.id AND os.awb_no = '875452421545'
WHERE o.ref_no = 'PO-A484'
AND NOT EXISTS (SELECT 1 FROM duty_bill_awb_assignments dba WHERE dba.order_id = o.id AND dba.order_shipment_id = os.id);

COMMIT;

-- Skipped entirely (38 POs with no matching order anywhere in the system) -- see
-- claude/rugara-freight-purchase-duty-csb-structural-findings-2026-08-20.md for
-- the full list.

-- Verification (run after commit):
-- select count(*) from order_shipments where created_at > now() - interval '1 hour';
-- select count(*) from freight_bill_awb_assignments; select count(*) from duty_bill_awb_assignments;