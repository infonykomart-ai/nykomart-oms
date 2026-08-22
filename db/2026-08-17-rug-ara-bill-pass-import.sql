-- 2026-08-17: import of the historical "Rug Ara" Master Bill Pass File
-- into bill_pass_register (company = Rugara, short_code = 'RUG').
-- MUST run AFTER db/2026-08-17-party-master-cleanup-and-new-parties.sql
-- (this file looks up party_id by name; any party not created yet will
-- import with party_id = NULL).
--
-- Source: user-uploaded "RUG ARA MASTER BILL PASS FILE 2026 RUG ARA ALL BILLS.csv" (72 data rows).
-- approval_status: 'Approved L2' when the row was already fully paid per
-- its own TOTAL PAID vs TO BE PAY (TOTAL AMT - CREDIT NOTE AMT), else
-- 'Pending' -- per user's explicit choice (2026-08-17 Cowork chat).
-- prepared_by_employee_id / passed_by_employee_id / payment_by_employee_id
-- are left NULL on every row: the source columns ("PREPARED BY", "PASS BY
-- RD SIR", "PAYMNET BY AJAY JI") are free-text names/dates/status notes,
-- not a clean 1:1 match to an `employees` row (e.g. two live employees
-- are named "Ajay" -- Ajay Lohra and Ajay Mahawar -- so guessing which one
-- would be fabricating data). The raw text is preserved in `remark`
-- instead so nothing is lost.
-- credit_note_id is left NULL for the same reason: it's a FK to
-- `credit_notes`, and this import has no matching `credit_notes` rows to
-- link to -- the CSV's own credit-note reference number is folded into
-- `remark` as plain text ("Credit Note Ref: ...").
-- source / source_id are left NULL, matching the documented convention
-- for "manually entered (vendor/courier bill, typed in directly)" rows.
-- to_be_pay / balance_due / due_date are generated columns -- not part of
-- this INSERT's column list, Postgres computes them automatically from
-- total_amt / credit_note_amt / total_paid / invoice_recv_date.

BEGIN;

INSERT INTO bill_pass_register (
  company_id, invoice_no, vendor_invoice_no, invoice_type,
  invoice_date, invoice_recv_date, credit_note_date,
  total_amt, credit_note_amt, total_paid,
  party_id, party_type, shipping_pct, duty_tax_pct,
  remark, approval_status
)
SELECT
  (SELECT id FROM companies WHERE short_code = 'RUG'),
  v.invoice_no, v.vendor_invoice_no, v.invoice_type::invoice_type,
  v.invoice_date::date, v.invoice_recv_date::date, v.credit_note_date::date,
  v.total_amt::numeric, v.credit_note_amt::numeric, v.total_paid::numeric,
  p.id, v.party_type, v.shipping_pct::numeric, v.duty_pct::numeric,
  v.remark, v.approval_status::bill_approval_status
FROM (VALUES
  ('RJ2425006240', NULL, 'DUTY TAX', '2025-12-19', '2025-10-23', NULL, 1958.67, 0, 0, 'Aramex', 'Courier /international shipping', NULL, NULL, 'Prepared by: Ajay | Passed (RD Sir) on: 17-Apr-2026 | Payment note: Paid 27-Jan-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Pending'),
  ('P-62', NULL, 'Purchase', '2025-12-22', '2025-10-23', NULL, 25993.0, 0, 25993.0, 'M/S. Prachi Rugs', 'Purchase / Jute Rug', NULL, NULL, 'Prepared by: Ajay | Passed (RD Sir) on: 8-Jul-2026 [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100153450', NULL, 'FREIGHT INVOICE', '2025-12-11', '2026-03-02', NULL, 48569.63, 0, 48569.63, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: Ajay | Passed (RD Sir) on: 17-Apr-2026 | Payment note: Paid 03-Mar-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100154869', NULL, 'FREIGHT INVOICE', '2026-01-01', '2026-01-10', NULL, 4398.61, 0, 4398.61, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: Ajay | Passed (RD Sir) on: 17-Apr-2026 | Payment note: Paid 03-Mar-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100151850', NULL, 'FREIGHT INVOICE', '2025-11-20', '2025-11-20', NULL, 14086.5, 0, 14086.5, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: Ajay | Passed (RD Sir) on: 17-Apr-2026 | Payment note: Paid 03-Mar-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('RJ2425007905', NULL, 'FREIGHT INVOICE', '2026-03-31', '2026-03-31', NULL, 41848.85, 0, 0, 'Aramex', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 17-Apr-2026 [imported from Master Bill Pass File]', 'Pending'),
  ('108100163749', NULL, 'FREIGHT INVOICE', '2026-03-26', '2026-04-21', NULL, 23326.24, 0, 23326.24, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 23-Apr-2026 | Payment note: Paid 15-May-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100165010', NULL, 'FREIGHT INVOICE', '2026-04-02', '2026-04-21', NULL, 4171.81, 0, 4171.81, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 23-Apr-2026 | Payment note: Paid 15-May-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100166297', NULL, 'Disbursement FEE', '2026-04-08', '2026-04-21', NULL, 1531.92, 0, 1531.92, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 23-Apr-2026 | Payment note: Paid 15-May-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100166298', NULL, 'Disbursement FEE', '2026-04-08', '2026-04-21', NULL, 1531.92, 0, 1531.92, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 23-Apr-2026 | Payment note: Paid 15-May-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108500038052', NULL, 'DUTY TAX', '2026-04-08', '2026-04-21', NULL, 542.48, 0, 542.48, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 23-Apr-2026 | Payment note: Paid 15-May-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108500038053', NULL, 'DUTY TAX', '2026-04-08', '2026-04-21', NULL, 382.0, 0, 382.0, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 23-Apr-2026 | Payment note: Paid 15-May-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100166679', NULL, 'FREIGHT INVOICE', '2026-04-09', '2026-04-21', '2026-04-24', 12464.6, 7823.02, 4641.58, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 23-Apr-2026 | Payment note: Paid 15-May-2026 | Credit Note Ref: YES | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100167472', NULL, 'Disbursement FEE', '2026-04-15', '2026-04-21', NULL, 1564.12, 0, 1564.12, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 23-Apr-2026 | Payment note: Paid 15-May-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100167473', NULL, 'Disbursement FEE', '2026-04-15', '2026-04-21', NULL, 1541.85, 0, 1541.85, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 23-Apr-2026 | Payment note: Paid 15-May-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108500038331', NULL, 'DUTY TAX', '2026-04-15', '2026-04-21', NULL, 871.05, 0, 871.05, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 23-Apr-2026 | Payment note: Paid 15-May-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108500038332', NULL, 'DUTY TAX', '2026-04-15', '2026-04-21', NULL, 273.46, 0, 273.46, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 23-Apr-2026 | Payment note: Paid 15-May-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100167874', NULL, 'FREIGHT INVOICE', '2026-04-16', '2026-04-21', NULL, 14264.65, 0, 14264.65, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 23-Apr-2026 | Payment note: Paid 02-June-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('DC/2026-27/065', NULL, 'Purchase', '2026-04-20', '2026-04-20', NULL, 6800.0, 0, 4460.0, 'DILEEP COMPUTERS', 'OTHER', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 14-May-2026 [imported from Master Bill Pass File]', 'Pending'),
  ('108100169301', NULL, 'FREIGHT INVOICE', '2026-04-23', '2026-05-12', NULL, 28187.27, 0, 28187.27, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 14-May-2026 | Payment note: Paid 02-June-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100170071', NULL, 'Disbursement FEE', '2026-04-29', '2026-05-14', NULL, 1540.9, 0, 1540.9, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 14-May-2026 | Payment note: Paid 15-May-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100170072', NULL, 'Disbursement FEE', '2026-04-29', '2026-05-14', NULL, 1540.9, 0, 1540.9, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 14-May-2026 | Payment note: Paid 15-May-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100170073', NULL, 'Disbursement FEE', '2026-04-29', '2026-05-13', NULL, 1540.9, 0, 1540.9, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 14-May-2026 | Payment note: Paid 02-June-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100170074', NULL, 'Disbursement FEE', '2026-04-29', '2026-05-14', NULL, 1578.03, 0, 1578.03, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 14-May-2026 | Payment note: Paid 02-June-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108500038859', NULL, 'DUTY TAX', '2026-04-29', '2026-05-14', NULL, 620.27, 0, 620.27, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 14-May-2026 | Payment note: Paid 490.75/- on 15-May-2026 & Paid 02-June-2026 [imported from Master Bill Pass File]', 'Approved L2'),
  ('108500038860', NULL, 'DUTY TAX', '2026-04-29', '2026-05-14', NULL, 260.24, 0, 260.24, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 14-May-2026 | Payment note: Paid 02-June-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108500038861', NULL, 'DUTY TAX', '2026-04-29', '2026-05-13', NULL, 496.22, 0, 496.22, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 14-May-2026 | Payment note: Paid 02-June-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108500038862', NULL, 'DUTY TAX', '2026-04-29', '2026-05-14', NULL, 1155.82, 0, 1155.82, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 14-May-2026 | Payment note: Paid 02-June-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100170490', NULL, 'FREIGHT INVOICE', '2026-04-30', '2026-05-12', NULL, 10531.11, 0, 10531.11, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 14-May-2026 | Payment note: Paid 02-June-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('PI-1753', NULL, 'Purchase', '2026-05-25', '2026-05-26', NULL, 11800.0, 0, 0, 'PARSHOTAM & ASSOCIATES', 'Serivce', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 8-Jul-2026 [imported from Master Bill Pass File]', 'Pending'),
  ('108100171085', NULL, 'Disbursement FEE', '2026-05-06', '2026-06-13', NULL, 1554.2, 0, 1554.2, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 13-Jun-2026 | Payment note: PAID 15-JUNE-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100171086', NULL, 'Disbursement FEE', '2026-05-06', '2026-06-13', NULL, 1554.2, 0, 1554.2, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 13-Jun-2026 | Payment note: PAID 15-JUNE-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108500039101', NULL, 'DUTY TAX', '2026-05-06', '2026-06-13', NULL, 212.62, 0, 212.62, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 13-Jun-2026 | Payment note: PAID 15-JUNE-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108500039102', NULL, 'DUTY TAX', '2026-05-06', '2026-06-13', NULL, 275.66, 0, 275.66, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 13-Jun-2026 | Payment note: PAID 15-JUNE-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100172065', NULL, 'FREIGHT INVOICE', '2026-05-07', '2026-06-13', NULL, 3169.27, 0, 3169.27, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 13-Jun-2026 | Payment note: PAID 15-JUNE-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100172815', NULL, 'FREIGHT INVOICE', '2026-05-14', '2026-06-13', NULL, 25672.56, 0, 0, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 13-Jun-2026 [imported from Master Bill Pass File]', 'Pending'),
  ('108100173216', NULL, 'Disbursement FEE', '2026-05-21', '2026-06-13', NULL, 3812.7, 0, 3812.7, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 8-Jul-2026 | Payment note: PAID 15-JUNE-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100173593', NULL, 'Disbursement FEE', '2026-05-21', '2026-06-13', '2026-06-05', 51920.25, 3629.9, 48290.35, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 8-Jul-2026 | Payment note: PAID 15-JUNE-2026 | Credit Note Ref: 908100011435 & 908100011628 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108500039477', NULL, 'DUTY TAX', '2026-05-21', '2026-06-13', NULL, 1129.48, 0, 1129.48, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 8-Jul-2026 | Payment note: PAID 15-JUNE-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100174068', NULL, 'Disbursement FEE', '2026-05-28', '2026-06-13', NULL, 11482.58, 0, 11482.58, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 8-Jul-2026 | Payment note: PAID 15-JUNE-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100174309', NULL, 'FREIGHT INVOICE', '2026-05-28', '2026-06-13', NULL, 6513.82, 0, 6513.82, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 13-Jun-2026 | Payment note: PAID 15-JUNE-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108500039610', NULL, 'DUTY TAX', '2026-05-28', '2026-06-13', NULL, 4084.87, 0, 4084.87, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 8-Jul-2026 | Payment note: PAID 15-JUNE-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100175008', NULL, 'FREIGHT INVOICE', '2026-06-04', '2026-06-13', '1-06-05', 46131.55, 8022.88, 0, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 13-Jun-2026 | Credit Note Ref: YES [imported from Master Bill Pass File]', 'Pending'),
  ('108100175581', NULL, 'Disbursement FEE', '2026-06-10', '2026-06-13', NULL, 10931.25, 0, 0, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 13-Jun-2026 [imported from Master Bill Pass File]', 'Pending'),
  ('108500039851', NULL, 'DUTY TAX', '2026-06-10', '2026-06-13', NULL, 9083.0, 0, 0, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 8-Jul-2026 [imported from Master Bill Pass File]', 'Pending'),
  ('276425286', NULL, 'FREIGHT INVOICE', '2026-06-04', '2026-06-17', NULL, 26572.5, 0, 26572.5, 'FedEx', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 8-Jul-2026 | Payment note: PAID 17-JULY-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('276426146', NULL, 'FREIGHT INVOICE', '2026-06-11', '2026-06-17', NULL, 8933.6, 0, 8933.6, 'FedEx', 'Courier /international shipping', NULL, NULL, 'Prepared by: GAJANAND | Passed (RD Sir) on: 8-Jul-2026 | Payment note: PAID 17-JULY-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100175808', NULL, 'FREIGHT INVOICE', '2026-06-11', '2026-06-26', NULL, 5889.65, 0, 0, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 8-Jul-2026 [imported from Master Bill Pass File]', 'Pending'),
  ('108100176336', NULL, 'FREIGHT INVOICE', '2026-06-18', '2026-06-26', NULL, 9199.31, 0, 0, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 8-Jul-2026 [imported from Master Bill Pass File]', 'Pending'),
  ('276426942', NULL, 'FREIGHT INVOICE', '2026-06-18', '2026-06-26', NULL, 50180.2, 0, 50180.2, 'FedEx', 'Courier /international shipping', NULL, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 8-Jul-2026 | Payment note: PAID-04-AUG-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('276427730', NULL, 'FREIGHT INVOICE', '2026-06-25', '2026-06-29', NULL, 15371.7, 0, 15371.7, 'FedEx', 'Courier /international shipping', 37.42, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 8-Jul-2026 | Payment note: PAID-29-JULY-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('276429044', NULL, 'FREIGHT INVOICE', '2026-07-06', '2026-07-09', NULL, 33904.5, 0, 33904.5, 'FedEx', 'Courier /international shipping', NULL, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 28-Jul-2026 | Payment note: PAID-05-AUG-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('276429514', NULL, 'DUTY TAX', '2026-07-09', '2026-07-23', NULL, 1234.0, 0, 1234.0, 'FedEx', 'Courier /international shipping', NULL, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 28-Jul-2026 | Payment note: PAID-04-AUG-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('276429836', NULL, 'FREIGHT INVOICE', '2026-07-13', '2026-07-23', NULL, 9091.1, 0, 9091.1, 'FedEx', 'Courier /international shipping', 18.28, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 28-Jul-2026 | Payment note: PAID-29-JULY-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('276430094', NULL, 'DUTY TAX', '2026-07-13', '2026-07-23', NULL, 7734.6, 0, 7734.6, 'FedEx', 'Courier /international shipping', 33.0, 9.0, 'Prepared by: VINIT | Passed (RD Sir) on: 28-Jul-2026 | Payment note: PAID-29-JULY-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('276430340', NULL, 'DUTY TAX', '2026-07-16', '2026-07-23', NULL, 1918.1, 0, 1918.1, 'FedEx', 'Courier /international shipping', 55.0, 22.0, 'Prepared by: VINIT | Passed (RD Sir) on: 28-Jul-2026 | Payment note: PAID-29-JULY-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('276430665', NULL, 'FREIGHT INVOICE', '2026-07-20', '2026-07-23', NULL, 11657.0, 0, 11657.0, 'FedEx', 'Courier /international shipping', 29.0, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 28-Jul-2026 | Payment note: PAID-29-JULY-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('276430993', NULL, 'DUTY TAX', '2026-07-21', '2026-07-23', NULL, 7367.5, 0, 7367.5, 'FedEx', 'Courier /international shipping', 36.0, 6.0, 'Prepared by: VINIT | Passed (RD Sir) on: 28-Jul-2026 | Payment note: PAID-29-JULY-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('108100177712', NULL, 'FREIGHT INVOICE', '2026-07-02', '2026-07-27', '2026-07-19', 4668.19, 98.88, 0, 'UPS', 'Courier /international shipping', NULL, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 28-Jul-2026 | Credit Note Ref: YES [imported from Master Bill Pass File]', 'Pending'),
  ('276431216', NULL, 'DUTY TAX', '2026-07-24', '2026-07-29', NULL, 2439.5, 0, 2439.5, 'FedEx', 'Courier /international shipping', 46.0, 14.0, 'Prepared by: VINIT | Passed (RD Sir) on: 11-Aug-2026 | Payment note: PAID-29-JULY-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('276431055', NULL, 'DUTY TAX', '2026-07-22', '2026-07-29', NULL, 2036.0, 0, 2036.0, 'FedEx', 'Courier /international shipping', 26.0, 7.0, 'Prepared by: VINIT | Passed (RD Sir) on: 11-Aug-2026 | Payment note: PAID-04-AUG-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('276431478', NULL, 'FREIGHT INVOICE', '2026-07-27', '2026-08-03', NULL, 49352.7, 0, 0, 'FedEx', 'Courier /international shipping', 25.74, NULL, 'Prepared by: VINIT | Passed (RD Sir) on: 11-Aug-2026 [imported from Master Bill Pass File]', 'Pending'),
  ('276431830', NULL, 'DUTY TAX', '2026-07-28', '2026-08-03', NULL, 7636.1, 0, 7636.1, 'FedEx', 'Courier /international shipping', 30.0, 21.0, 'Prepared by: VINIT | Passed (RD Sir) on: 11-Aug-2026 | Payment note: PAID-04-AUG-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('276429289', NULL, 'DUTY TAX', '2026-07-02', '2026-08-05', NULL, 1896.0, 0, 1896.0, 'FedEx', 'Courier /international shipping', 56.0, 33.0, 'Prepared by: VINIT | Passed (RD Sir) on: 11-Aug-2026 | Payment note: PAID-05-AUG-2026 | Remark: PAID [imported from Master Bill Pass File]', 'Approved L2'),
  ('276431919', NULL, 'DUTY TAX', '2026-07-29', '2026-08-11', NULL, 1898.8, 0, 1898.8, 'FedEx', 'Courier /international shipping', 57.0, 32.0, 'Prepared by: VINIT | Passed (RD Sir) on: 11-Aug-2026 | Payment note: paid 13-aug-2026 [imported from Master Bill Pass File]', 'Approved L2'),
  ('276432002', NULL, 'DUTY TAX', '2026-07-30', '2026-08-11', NULL, 5860.2, 0, 5860.2, 'FedEx', 'Courier /international shipping', 23.0, 7.0, 'Prepared by: VINIT | Passed (RD Sir) on: 11-Aug-2026 | Payment note: paid 13-aug-2026 [imported from Master Bill Pass File]', 'Approved L2'),
  ('276432892', NULL, 'DUTY TAX', '2026-08-05', '2026-08-11', NULL, 3336.0, 0, 3336.0, 'FedEx', 'Courier /international shipping', 26.0, 11.0, 'Prepared by: VINIT | Passed (RD Sir) on: 11-Aug-2026 | Payment note: paid 13-aug-2026 [imported from Master Bill Pass File]', 'Approved L2'),
  ('276433057', NULL, 'DUTY TAX', '2026-08-07', '2026-08-11', NULL, 2508.1, 0, 2508.1, 'FedEx', 'Courier /international shipping', 40.0, 16.0, 'Prepared by: VINIT | Passed (RD Sir) on: 11-Aug-2026 | Payment note: paid 13-aug-2026 [imported from Master Bill Pass File]', 'Approved L2'),
  ('276432735', NULL, 'DUTY TAX', '2026-08-03', '2026-08-12', NULL, 12164.0, 0, 12164.0, 'FedEx', 'Courier /international shipping', 24.0, 11.0, 'Prepared by: VINIT | Payment note: paid 13-aug-2026 [imported from Master Bill Pass File]', 'Approved L2'),
  ('276433520', NULL, 'DUTY TAX', '2026-08-10', '2026-08-14', NULL, 6428.0, 0, 0, 'FedEx', 'Courier /international shipping', 34.0, 12.0, 'Prepared by: VINIT [imported from Master Bill Pass File]', 'Pending'),
  ('276432368', NULL, 'FREIGHT INVOICE', '2026-08-03', '2026-08-14', NULL, 34861.4, 0, 0, 'FedEx', 'Courier /international shipping', 31.0, NULL, 'Prepared by: VINIT [imported from Master Bill Pass File]', 'Pending'),
  ('276433300', NULL, 'FREIGHT INVOICE', '2026-08-10', '2026-08-14', NULL, 43212.9, 0, 0, 'FedEx', 'Courier /international shipping', 23.83, NULL, 'Prepared by: VINIT [imported from Master Bill Pass File]', 'Pending')
) AS v(invoice_no, vendor_invoice_no, invoice_type, invoice_date, invoice_recv_date,
       credit_note_date, total_amt, credit_note_amt, total_paid, party_name,
       party_type, shipping_pct, duty_pct, remark, approval_status)
LEFT JOIN parties p ON lower(p.name) = lower(v.party_name);

COMMIT;

-- After running, verify with:
--   SELECT count(*) FROM bill_pass_register WHERE company_id = (SELECT id FROM companies WHERE short_code = 'RUG') AND remark LIKE '%imported from Master Bill Pass File%';  -- should be 72
--   SELECT invoice_no, party_type FROM bill_pass_register WHERE company_id = (SELECT id FROM companies WHERE short_code = 'RUG') AND party_id IS NULL AND remark LIKE '%imported from Master Bill Pass File%';  -- should return 0 rows -- any row here means a party name didn't match, check spelling
