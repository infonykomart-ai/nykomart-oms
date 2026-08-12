-- 2026-08-12 (round 8): "PURCHASE PARTY HAI SQL ME UPDATE KARNE PAR AUTO
-- UPDATE HO JAYEGI" — user gave a list of 8 real vendor (Purchase Party)
-- companies with full bank details (bank name / account no / IFSC),
-- asking to confirm a direct SQL insert/update against `parties` shows up
-- live in the app. It does — Party Master (/dashboard/parties) reads the
-- `parties` table straight, no caching layer — but bank_name/account_no/
-- ifsc_code had NO column to land in until this file. Adding them here
-- (same shape as company_profiles' own bank fields) so both this one-time
-- seed AND any future SQL update run directly against `parties` for these
-- fields actually stick, rather than being silently dropped.
ALTER TABLE parties ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS account_no text;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS ifsc_code text;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS account_holder_name text;  -- only set when it genuinely differs from the party name itself

COMMENT ON COLUMN parties.account_holder_name IS
  'Bank account holder name, only when it differs from the party''s own name (e.g. a proprietorship billed under '
  'a personal name) — NULL means "same as party name".';

-- The 8 vendor parties given this round — upsert by name (parties.name is
-- UNIQUE citext, matching the existing create-or-update convention this
-- table already uses for CSV re-uploads — see bulkSaveParties in
-- src/app/dashboard/parties/actions.ts), so re-running this file after an
-- edit is always safe. invoice_type = 'Purchase' for all 8, per "PURCHASE
-- PARTY HAI" — an existing invoice_type enum value, no ALTER TYPE needed.
INSERT INTO parties (name, invoice_type, address, contact_no, email, gst, bank_name, account_no, ifsc_code, account_holder_name)
VALUES
  ('AK Enterprises', 'Purchase', 'Plot No. 118, Raghunathpuri-II, Bairwa Colony, Sanganer, Jaipur - 302029', '9950271826', NULL, '08HOCFP7376M1Z0', 'Union Bank of India, Sitapura, Jaipur', '310911010000147', 'UBIN0831809', NULL),
  ('Shivam Enterprises', 'Purchase', '45/175 Moti Path, Mansarover, Jaipur, Rajasthan - 302020', '9602491780', 'shivamenterprisesjaipur67@gmail.com', '08AELFS6052D1ZX', 'AU Small Finance Bank, Shyam Nagar, Jaipur', '2121244534165838', 'AUBL0002445', 'Shivam Enterprises'),
  ('M/S. Prachi Rugs', 'Purchase', 'Rasoolpur, Fatehpur Sikri, 283110 (Agra), U.P.', '8449656151', NULL, '09LSSPS7578E1ZG', 'IndusInd Bank', '259027180185', 'INDB0000472', NULL),
  ('Shivam Export Fabrics', 'Purchase', 'Poonam Chambers, Opp. Saroj Nursery, Near Sanganer Police Thana, Sanganer, Jaipur (Raj.) 302011', '9314527299, 8963095915', NULL, '08AASPG5263F121', 'HDFC Bank, Malviya Nagar, Jaipur', '18448020000032', 'HDFC0001844', NULL),
  ('A G Computer', 'Purchase', '162/SP33, Sector-16, Pratap Nagar, Jaipur, 302033, Rajasthan, India', '8619026931, 9571355966', 'avinashgupta612@gmail.com', '08BQFPA0508M1Z2', 'Punjab National Bank, RUHS, Pratap Nagar, Jaipur', '12562193000183', 'PUNB0125610', 'Avinash Kumar'),
  ('Jai Ambey Prints', 'Purchase', 'Plot No 58, Printers Nagar 1st, Tonk Road, Sitabadi, Jaipur', '9460310221', NULL, '08CDEPD7523A1Z2', 'Punjab National Bank, Sanganer, Jaipur', '0776102100001928', 'PUNB0077610', NULL),
  ('NVR Home Decor', 'Purchase', '2-A East, Girraj Colony, Near Sawai Madhopur Puliya, Sanganer, Jaipur - 302029', NULL, NULL, NULL, 'ICICI Bank, Sanganer', '678005501455', 'ICIC0006780', NULL),
  ('R.K. Stone Wash', 'Purchase', 'Near Goverdhan Nagar Choraha, Khajane Walo Ki Dhani', '9828984888, 7014781993', NULL, '08DGSPM5434F1Z0', 'Axis Bank, Malviya Nagar, Jaipur', '918020021805561', 'UTIB0000626', NULL)
ON CONFLICT (name) DO UPDATE SET
  invoice_type         = EXCLUDED.invoice_type,
  address              = EXCLUDED.address,
  contact_no           = EXCLUDED.contact_no,
  email                = COALESCE(EXCLUDED.email, parties.email),
  gst                  = COALESCE(EXCLUDED.gst, parties.gst),
  bank_name            = EXCLUDED.bank_name,
  account_no           = EXCLUDED.account_no,
  ifsc_code            = EXCLUDED.ifsc_code,
  account_holder_name  = EXCLUDED.account_holder_name;

-- Note: buyer_party ("Nyko Mart") given alongside this list is one of our
-- OWN 3 companies, not a vendor — its GSTIN (08CVAPS0200H1Z0) already
-- matches what's on file in company_profiles (see
-- claude/invoice-origin-declarations-and-numbering.md), so nothing to
-- update there.
