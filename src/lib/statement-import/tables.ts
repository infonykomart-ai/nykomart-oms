// Statement-family CSV import config (round 11) — the CSV Upload dashboard
// tile ("Bulk-load rows into the back-office log sheets from a CSV file")
// covers ALL of the statement-family tables from db/schema.sql SECTION 15
// (see claude/statement-import-notes.md for where each one came from and
// what real export file it matches) except the 2 PDF-only ones
// (etsy_monthly_tax_invoices / ebay_financial_summary — those are one
// hand-typed record per statement, so they live on the Statement Entry
// screen instead, exactly as db/schema.sql's own comment on those 2 tables
// says: "entered by hand via the 'Statement Entry' screen (not
// CSV-uploadable)"). Also includes sale_profit_ledger (old: Sale & Profit
// Ledger, CSV_UPLOAD_SHEETS in the old system) for backfilling historical
// order P&L without going through the live Order Entry form.
//
// One shared generic importer (see ../../app/dashboard/csv-upload/actions.ts)
// drives off this config instead of 8 separate bespoke upload forms/actions
// — every one of these tables is a flat "one CSV row -> one DB row" import
// with no cross-row logic, so a config-driven mapper is a correctness win
// (one code path to get right) as well as a time one.
// 2026-08-13: "date_dmy"/"date_mdy" added for Amazon's Transactions report
// — the SAME "Date" header means DD/MM/YYYY on the UK/GBP export and
// M/D/YYYY on the US/USD export (confirmed against each real file's own
// stated date range). Postgres' default DateStyle would misparse (or
// outright reject) whichever one isn't its expected order if imported as
// plain "date" text, so these convert to ISO (YYYY-MM-DD) at import time
// instead of relying on Postgres to guess. Plain "date" stays as before
// (relies on Postgres accepting the source's own format, e.g. Etsy's
// "January 31, 2026", which it does).
export type ImportColumnType = "text" | "number" | "integer" | "date" | "date_dmy" | "date_mdy" | "boolean";

export type ImportColumn = {
  header: string; // CSV column header (also the template header)
  dbColumn: string;
  type: ImportColumnType;
  required?: boolean;
};

export type ImportTableConfig = {
  key: string;
  label: string;
  dbTable: string;
  sourceNote: string;
  columns: ImportColumn[];
  // 2026-08-13: literal values applied to EVERY imported row, not read
  // from the CSV at all — added for Amazon, where the currency isn't a
  // fixed column (the "Total" column's own header changes per marketplace
  // — "Total (GBP)" vs "Total (USD)"), so each currency gets its own
  // template with its own currency literal + matching date column type
  // instead of trying to auto-detect it from the file.
  fixedValues?: Record<string, string>;
};

export const STATEMENT_IMPORT_TABLES: ImportTableConfig[] = [
  {
    key: "bank_statement",
    label: "Bank Statement",
    dbTable: "bank_statement_lines",
    sourceNote: "PNB (or other) bank account CSV export.",
    columns: [
      { header: "Txn No", dbColumn: "txn_no", type: "text" },
      { header: "Txn Date", dbColumn: "txn_date", type: "date" },
      { header: "Description", dbColumn: "description", type: "text" },
      { header: "Branch Name", dbColumn: "branch_name", type: "text" },
      { header: "Cheque No", dbColumn: "cheque_no", type: "text" },
      { header: "Dr Amount", dbColumn: "dr_amount", type: "number" },
      { header: "Cr Amount", dbColumn: "cr_amount", type: "number" },
      { header: "Balance", dbColumn: "balance", type: "number" },
      { header: "KIMS Remarks", dbColumn: "kims_remarks", type: "text" },
      { header: "Status", dbColumn: "status", type: "text" },
    ],
  },
  {
    key: "etsy_ledger",
    label: "Etsy Ledger",
    dbTable: "etsy_ledger_lines",
    sourceNote: "Etsy's granular per-transaction ledger export.",
    columns: [
      // 2026-08-13: fixed against real Etsy Ledger CSV exports (Jan-Jul
      // 2026) — the actual column is named "Date", not "Txn Date"; the
      // old header here would never have matched, so txn_date would have
      // imported as NULL for every row.
      { header: "Date", dbColumn: "txn_date", type: "date" },
      { header: "Type", dbColumn: "type", type: "text" },
      { header: "Title", dbColumn: "title", type: "text" },
      { header: "Info", dbColumn: "info", type: "text" },
      { header: "Currency", dbColumn: "currency", type: "text" },
      { header: "Amount", dbColumn: "amount", type: "number" },
      { header: "Fees & Taxes", dbColumn: "fees_and_taxes", type: "number" },
      { header: "Net", dbColumn: "net", type: "number" },
      { header: "Tax Details", dbColumn: "tax_details", type: "text" },
    ],
  },
  {
    key: "ebay_transactions",
    label: "eBay Transaction Report",
    dbTable: "ebay_transaction_lines",
    sourceNote: "eBay Seller Hub \"Transaction report\" CSV export.",
    columns: [
      { header: "Transaction Creation Date", dbColumn: "transaction_creation_date", type: "date" },
      { header: "Type", dbColumn: "type", type: "text" },
      { header: "Order Number", dbColumn: "order_number", type: "text" },
      { header: "Legacy Order ID", dbColumn: "legacy_order_id", type: "text" },
      { header: "Buyer Username", dbColumn: "buyer_username", type: "text" },
      { header: "Buyer Name", dbColumn: "buyer_name", type: "text" },
      { header: "Ship To City", dbColumn: "ship_to_city", type: "text" },
      { header: "Ship To Province/Region/State", dbColumn: "ship_to_province_region_state", type: "text" },
      { header: "Ship To Zip", dbColumn: "ship_to_zip", type: "text" },
      { header: "Ship To Country", dbColumn: "ship_to_country", type: "text" },
      { header: "Net Amount", dbColumn: "net_amount", type: "number" },
      { header: "Payout Currency", dbColumn: "payout_currency", type: "text" },
      { header: "Payout Date", dbColumn: "payout_date", type: "date" },
      { header: "Payout ID", dbColumn: "payout_id", type: "text" },
      { header: "Payout Method", dbColumn: "payout_method", type: "text" },
      { header: "Payout Status", dbColumn: "payout_status", type: "text" },
      { header: "Reason For Hold", dbColumn: "reason_for_hold", type: "text" },
      { header: "Item ID", dbColumn: "item_id", type: "text" },
      { header: "Transaction ID", dbColumn: "transaction_id", type: "text" },
      { header: "Item Title", dbColumn: "item_title", type: "text" },
      { header: "Custom Label", dbColumn: "custom_label", type: "text" },
      { header: "Quantity", dbColumn: "quantity", type: "integer" },
      { header: "Item Subtotal", dbColumn: "item_subtotal", type: "number" },
      { header: "Shipping And Handling", dbColumn: "shipping_and_handling", type: "number" },
      { header: "Seller Collected Tax", dbColumn: "seller_collected_tax", type: "number" },
      { header: "eBay Collected Tax", dbColumn: "ebay_collected_tax", type: "number" },
      { header: "Seller Specified VAT Rate", dbColumn: "seller_specified_vat_rate", type: "number" },
      { header: "Final Value Fee - Fixed", dbColumn: "final_value_fee_fixed", type: "number" },
      { header: "Final Value Fee - Variable", dbColumn: "final_value_fee_variable", type: "number" },
      { header: "Regulatory Operating Fee", dbColumn: "regulatory_operating_fee", type: "number" },
      { header: "Very High INAD Fee", dbColumn: "very_high_inad_fee", type: "number" },
      { header: "Below Standard Performance Fee", dbColumn: "below_standard_performance_fee", type: "number" },
      { header: "International Fee", dbColumn: "international_fee", type: "number" },
      { header: "Charity Donation", dbColumn: "charity_donation", type: "number" },
      { header: "Deposit Processing Fee", dbColumn: "deposit_processing_fee", type: "number" },
      { header: "Gross Transaction Amount", dbColumn: "gross_transaction_amount", type: "number" },
      { header: "Transaction Currency", dbColumn: "transaction_currency", type: "text" },
      { header: "Exchange Rate", dbColumn: "exchange_rate", type: "number" },
      { header: "Reference ID", dbColumn: "reference_id", type: "text" },
      { header: "Description", dbColumn: "description", type: "text" },
    ],
  },
  {
    key: "ebay_freight_invoice",
    label: "eBay Freight Invoice",
    dbTable: "ebay_freight_invoice_lines",
    sourceNote: "eBay seller shipping/freight invoice CSV export (AWB-level).",
    columns: [
      { header: "AWB No", dbColumn: "awb_no", type: "text" },
      { header: "Ship Date", dbColumn: "ship_date", type: "date" },
      { header: "eBay Invoice Date", dbColumn: "ebay_invoice_date", type: "date" },
      { header: "Seller ID", dbColumn: "seller_id", type: "text" },
      { header: "Logistic Service Provider", dbColumn: "logistic_service_provider", type: "text" },
      { header: "Service Type", dbColumn: "service_type", type: "text" },
      { header: "eBay Item No or Dispute ID", dbColumn: "ebay_item_no_or_dispute_id", type: "text" },
      { header: "Declared Weight", dbColumn: "declared_weight", type: "number" },
      { header: "Chargeable Weight", dbColumn: "chargeable_weight", type: "number" },
      { header: "Destination", dbColumn: "destination", type: "text" },
      { header: "Freight Amount", dbColumn: "freight_amount", type: "number", required: true },
      { header: "Emergency Surcharge", dbColumn: "emergency_surcharge", type: "number" },
      { header: "ODA", dbColumn: "oda", type: "number" },
      { header: "OPA", dbColumn: "opa", type: "number" },
      { header: "IP Surcharge", dbColumn: "ip_surcharge", type: "number" },
      { header: "Declared Value Insurance", dbColumn: "declared_value_insurance", type: "number" },
      { header: "Address Correction", dbColumn: "address_correction", type: "number" },
      { header: "Oversize Piece", dbColumn: "oversize_piece", type: "number" },
      { header: "Overweight Piece", dbColumn: "overweight_piece", type: "number" },
      { header: "Additional Handling Charges", dbColumn: "additional_handling_charges", type: "number" },
      { header: "Restricted Destination Charges", dbColumn: "restricted_destination_charges", type: "number" },
      { header: "Elevated Risk Charges", dbColumn: "elevated_risk_charges", type: "number" },
      { header: "Shipment Preparation", dbColumn: "shipment_preparation", type: "number" },
      { header: "Duty Enablement Fees", dbColumn: "duty_enablement_fees", type: "number" },
      { header: "Duty Charges", dbColumn: "duty_charges", type: "number" },
      { header: "Other Destination Charges", dbColumn: "other_destination_charges", type: "number" },
      { header: "Others", dbColumn: "others", type: "number" },
      { header: "Billing Amount USD", dbColumn: "billing_amount_usd", type: "number" },
      { header: "Credit Amount", dbColumn: "credit_amount", type: "number" },
      { header: "Credit Amount USD", dbColumn: "credit_amount_usd", type: "number" },
    ],
  },
  {
    key: "ebay_shipment_customs",
    label: "eBay Shipment & Customs Report",
    dbTable: "ebay_shipment_customs_lines",
    sourceNote: "eBay daily shipment/customs report CSV export (59 columns in the real file).",
    columns: [
      { header: "Tracking No AWB", dbColumn: "tracking_no_awb", type: "text" },
      { header: "Paid/Unpaid", dbColumn: "paid_unpaid", type: "text" },
      { header: "Seller ID", dbColumn: "seller_id", type: "text" },
      { header: "Seller Name", dbColumn: "seller_name", type: "text" },
      { header: "Seller Company Name", dbColumn: "seller_company_name", type: "text" },
      { header: "eBay Order Date", dbColumn: "ebay_order_date", type: "date" },
      { header: "Order ID", dbColumn: "order_id", type: "text" },
      { header: "eBay Item No", dbColumn: "ebay_item_no", type: "text" },
      { header: "Buyer Name", dbColumn: "buyer_name", type: "text" },
      { header: "Buyer ID", dbColumn: "buyer_id", type: "text" },
      { header: "Buyer Tax ID", dbColumn: "buyer_tax_id", type: "text" },
      { header: "Buyer Country", dbColumn: "buyer_country", type: "text" },
      { header: "Delivery Date", dbColumn: "delivery_date", type: "date" },
      { header: "Booking Date", dbColumn: "booking_date", type: "date" },
      { header: "LSP Name", dbColumn: "lsp_name", type: "text" },
      { header: "LSP Service Type", dbColumn: "lsp_service_type", type: "text" },
      { header: "Shipment Purpose", dbColumn: "shipment_purpose", type: "text" },
      { header: "Scheduled Pickup Date", dbColumn: "scheduled_pickup_date", type: "date" },
      { header: "Actual Pickup Date", dbColumn: "actual_pickup_date", type: "date" },
      { header: "Shipping Invoice No", dbColumn: "shipping_invoice_no", type: "text" },
      { header: "Shipping Invoice Date", dbColumn: "shipping_invoice_date", type: "date" },
      { header: "Quantity", dbColumn: "quantity", type: "integer" },
      { header: "Item Description", dbColumn: "item_description", type: "text" },
      { header: "HSN Code Export Country", dbColumn: "hsn_code_export_country", type: "text" },
      { header: "Commodity Code Import Country", dbColumn: "commodity_code_import_country", type: "text" },
      { header: "MEIS", dbColumn: "meis", type: "text" },
      { header: "GSTIN No", dbColumn: "gstin_no", type: "text" },
      { header: "IEC", dbColumn: "iec", type: "text" },
      { header: "PAN No", dbColumn: "pan_no", type: "text" },
      { header: "Terms Of Trade Invoice", dbColumn: "terms_of_trade_invoice", type: "text" },
      { header: "IGST Bond Or UT", dbColumn: "igst_bond_or_ut", type: "text" },
      { header: "IGST Amount", dbColumn: "igst_amount", type: "number" },
      { header: "eBay FedEx Account No", dbColumn: "ebay_fedex_account_no", type: "text" },
      { header: "LSP Shipping Status", dbColumn: "lsp_shipping_status", type: "text" },
      { header: "Currency Code", dbColumn: "currency_code", type: "text" },
      { header: "Invoice Value", dbColumn: "invoice_value", type: "number" },
      { header: "Declared Product Value", dbColumn: "declared_product_value", type: "number" },
      { header: "Declared Shipping Cost", dbColumn: "declared_shipping_cost", type: "number" },
      { header: "Other Landing Cost", dbColumn: "other_landing_cost", type: "number" },
      { header: "Is Multiple Line Item Order", dbColumn: "is_multiple_line_item_order", type: "boolean" },
      { header: "Other Charges", dbColumn: "other_charges", type: "number" },
      { header: "ODA Charges", dbColumn: "oda_charges", type: "number" },
      { header: "Emergency Situation Surcharge", dbColumn: "emergency_situation_surcharge", type: "number" },
      { header: "Est Duty", dbColumn: "est_duty", type: "number" },
      { header: "Est Duty Enablement Fees", dbColumn: "est_duty_enablement_fees", type: "number" },
      { header: "Commercial Clearance Charges", dbColumn: "commercial_clearance_charges", type: "number" },
      { header: "Overweight Charges", dbColumn: "overweight_charges", type: "number" },
      { header: "Oversize Charges", dbColumn: "oversize_charges", type: "number" },
      { header: "Elevated Risk Charges", dbColumn: "elevated_risk_charges", type: "number" },
      { header: "Restricted Destination Charges", dbColumn: "restricted_destination_charges", type: "number" },
      { header: "Additional Handling Charges", dbColumn: "additional_handling_charges", type: "number" },
      { header: "POD Charges", dbColumn: "pod_charges", type: "number" },
      { header: "AG Order", dbColumn: "ag_order", type: "text" },
      { header: "Bucket", dbColumn: "bucket", type: "text" },
      { header: "Prepaid/Postpaid", dbColumn: "prepaid_postpaid", type: "text" },
      { header: "Country Of Manufacture", dbColumn: "country_of_manufacture", type: "text" },
      { header: "Shipment Selected Keyword", dbColumn: "shipment_selected_keyword", type: "text" },
      { header: "Cancellation Reason", dbColumn: "cancellation_reason", type: "text" },
      { header: "Cancellation Remark", dbColumn: "cancellation_remark", type: "text" },
    ],
  },
  {
    key: "ebay_wallet",
    label: "eBay Prepaid Wallet Ledger",
    dbTable: "ebay_wallet_ledger_lines",
    sourceNote: "eBay prepaid shipping-wallet CSV export.",
    columns: [
      { header: "AWB Number Or Transaction ID", dbColumn: "awb_number_or_transaction_id", type: "text" },
      { header: "Credit/Debit Amount", dbColumn: "credit_debit_amount", type: "number" },
      { header: "Operation", dbColumn: "operation", type: "text" },
      { header: "Transaction Mode", dbColumn: "transaction_mode", type: "text" },
      { header: "Wallet Opening Balance", dbColumn: "wallet_opening_balance", type: "number" },
      { header: "Wallet Closing Balance", dbColumn: "wallet_closing_balance", type: "number" },
      { header: "Txn Date", dbColumn: "txn_date", type: "date" },
      { header: "Payment Method", dbColumn: "payment_method", type: "text" },
    ],
  },
  {
    key: "ebay_tax_invoice",
    label: "eBay Tax Invoice Detail",
    dbTable: "ebay_tax_invoice_lines",
    sourceNote: "eBay \"Tax invoice detail\" CSV export (fee-level IGST breakdown).",
    columns: [
      // 2026-08-13: fixed against 8 real months (Dec 2025-Jul 2026) of
      // this export — the real column is "Date", not "Txn Date", and
      // "IGST (%)" (with parens), not "IGST %". Both would have imported
      // NULL for every row. This file also carries a 5-line metadata
      // preamble before the header row — see the generic fix in
      // ../../app/dashboard/csv-upload/actions.ts's readBulkFile.
      { header: "Date", dbColumn: "txn_date", type: "date" },
      { header: "Description", dbColumn: "description", type: "text" },
      { header: "Memo", dbColumn: "memo", type: "text" },
      { header: "Order Number", dbColumn: "order_number", type: "text" },
      { header: "Item Number", dbColumn: "item_number", type: "text" },
      { header: "Fee Group", dbColumn: "fee_group", type: "text" },
      { header: "Fee Type", dbColumn: "fee_type", type: "text" },
      { header: "Currency", dbColumn: "currency", type: "text" },
      { header: "Net Amount", dbColumn: "net_amount", type: "number" },
      { header: "IGST (%)", dbColumn: "igst_pct", type: "number" },
      { header: "IGST Amount", dbColumn: "igst_amount", type: "number" },
      { header: "Total Amount", dbColumn: "total_amount", type: "number" },
      { header: "Charged By Entity", dbColumn: "charged_by_entity", type: "text" },
    ],
  },
  {
    key: "sale_profit_ledger",
    label: "Sale & Profit Ledger",
    dbTable: "sale_profit_ledger",
    sourceNote: "Historical per-order P&L backfill — bypasses live Order Entry on purpose (see db/schema.sql SECTION 12).",
    columns: [
      { header: "PO/RF/RG No", dbColumn: "po_rf_rg_no", type: "text" },
      { header: "Marketplace Order No", dbColumn: "marketplace_order_no", type: "text" },
      { header: "Order Date", dbColumn: "order_date", type: "date" },
      { header: "Invoice No", dbColumn: "invoice_no", type: "text" },
      { header: "Invoice Date", dbColumn: "invoice_date", type: "date" },
      { header: "Sizes", dbColumn: "sizes", type: "text" },
      { header: "Qty", dbColumn: "qty", type: "integer" },
      { header: "Buyer Name", dbColumn: "buyer_name", type: "text" },
      { header: "Buyer Country", dbColumn: "buyer_country", type: "text" },
      { header: "Sale Value USD", dbColumn: "sale_value_usd", type: "number" },
      { header: "Total Value INR", dbColumn: "total_value_inr", type: "number", required: true },
      { header: "Total Expenses INR", dbColumn: "total_expenses_inr", type: "number" },
    ],
  },
  {
    key: "amazon_transactions_uk",
    label: "Amazon Transactions (UK / GBP)",
    dbTable: "amazon_transactions",
    sourceNote: "Amazon Seller Central \"Transactions\" report, amazon.co.uk (GBP) — Date column is DD/MM/YYYY.",
    columns: [
      { header: "Date", dbColumn: "txn_date", type: "date_dmy" },
      { header: "Transaction status", dbColumn: "transaction_status", type: "text" },
      { header: "Transaction type", dbColumn: "transaction_type", type: "text" },
      { header: "Order ID", dbColumn: "order_id", type: "text" },
      { header: "Product Details", dbColumn: "product_details", type: "text" },
      { header: "Total product charges", dbColumn: "total_product_charges", type: "number" },
      { header: "Total promotional rebates", dbColumn: "total_promotional_rebates", type: "number" },
      { header: "Amazon fees", dbColumn: "amazon_fees", type: "number" },
      { header: "Other", dbColumn: "other", type: "number" },
      { header: "Total (GBP)", dbColumn: "total_amount", type: "number" },
    ],
    fixedValues: { currency: "GBP" },
  },
  {
    key: "amazon_transactions_us",
    label: "Amazon Transactions (US / USD)",
    dbTable: "amazon_transactions",
    sourceNote: "Amazon Seller Central \"Transactions\" report, amazon.com (USD) — Date column is M/D/YYYY.",
    columns: [
      { header: "Date", dbColumn: "txn_date", type: "date_mdy" },
      { header: "Transaction Status", dbColumn: "transaction_status", type: "text" },
      { header: "Transaction type", dbColumn: "transaction_type", type: "text" },
      { header: "Order ID", dbColumn: "order_id", type: "text" },
      { header: "Product Details", dbColumn: "product_details", type: "text" },
      { header: "Total product charges", dbColumn: "total_product_charges", type: "number" },
      { header: "Total promotional rebates", dbColumn: "total_promotional_rebates", type: "number" },
      { header: "Amazon fees", dbColumn: "amazon_fees", type: "number" },
      { header: "Other", dbColumn: "other", type: "number" },
      { header: "Total (USD)", dbColumn: "total_amount", type: "number" },
    ],
    fixedValues: { currency: "USD" },
  },
  // 2026-08-13: "agar baki country ki report bhi dali jaye to uska bhi
  // dhyan rakhna" — Australia is the 3rd real Amazon marketplace export
  // supplied. Confirmed DD/MM/YYYY (same as UK) by finding a real day-of-
  // month > 12 in the file's own Date column (30/07/2026, 28/07/2026,
  // etc. — unambiguous, since month 30 doesn't exist). Same recipe as
  // UK/US above: one new template per marketplace/currency once a real
  // export for it is supplied — don't add a country ahead of time without
  // seeing its actual date format and column shape, since those are what
  // differed between UK and US.
  {
    key: "amazon_transactions_au",
    label: "Amazon Transactions (Australia / AUD)",
    dbTable: "amazon_transactions",
    sourceNote: "Amazon Seller Central \"Transactions\" report, amazon.com.au (AUD) — Date column is DD/MM/YYYY.",
    columns: [
      { header: "Date", dbColumn: "txn_date", type: "date_dmy" },
      { header: "Transaction Status", dbColumn: "transaction_status", type: "text" },
      { header: "Transaction type", dbColumn: "transaction_type", type: "text" },
      { header: "Order ID", dbColumn: "order_id", type: "text" },
      { header: "Product Details", dbColumn: "product_details", type: "text" },
      { header: "Total product charges", dbColumn: "total_product_charges", type: "number" },
      { header: "Total promotional rebates", dbColumn: "total_promotional_rebates", type: "number" },
      { header: "Amazon fees", dbColumn: "amazon_fees", type: "number" },
      { header: "Other", dbColumn: "other", type: "number" },
      { header: "Total (AUD)", dbColumn: "total_amount", type: "number" },
    ],
    fixedValues: { currency: "AUD" },
  },
];

export function importTableByKey(key: string): ImportTableConfig | undefined {
  return STATEMENT_IMPORT_TABLES.find((t) => t.key === key);
}
