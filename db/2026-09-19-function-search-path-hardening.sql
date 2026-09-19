-- 2026-09-19 (audit fix, Phase 4 / D) — 23 functions had a mutable search_path (Supabase
-- advisor: function_search_path_mutable, WARN). Standard Postgres hardening: without a fixed
-- search_path, a function that references an unqualified table/type name could be tricked by a
-- caller who creates a same-named object earlier in their own search_path, redirecting the
-- function to operate on the wrong object. Fix: pin every one of these to `public` explicitly.
-- Pure hardening — none of these functions change behavior, since `public` was always where
-- their referenced objects actually live; this just stops a future search_path override from
-- being able to change that. Idempotent — ALTER FUNCTION ... SET is safe to re-run.

ALTER FUNCTION public.format_invoice_no(p_prefix text, p_fy text, p_num integer) SET search_path = public;
ALTER FUNCTION public.trg_shipment_handover_chalans_doc_no() SET search_path = public;
ALTER FUNCTION public.fy_label(p_date date) SET search_path = public;
ALTER FUNCTION public.reserve_next_number(p_company_id uuid, p_scope text, p_use_fy boolean, p_as_of_date date) SET search_path = public;
ALTER FUNCTION public.format_order_ref_no(p_prefix text, p_num integer) SET search_path = public;
ALTER FUNCTION public.format_document_no(p_company_short_code text, p_doc_type text, p_fy text, p_num integer) SET search_path = public;
ALTER FUNCTION public.trg_material_out_chalans_doc_no() SET search_path = public;
ALTER FUNCTION public.get_official_rate_as_of(p_currency_code character varying, p_as_of date) SET search_path = public;
ALTER FUNCTION public.trg_washing_entries_doc_no() SET search_path = public;
ALTER FUNCTION public.trg_debit_notes_doc_no() SET search_path = public;
ALTER FUNCTION public.trg_assign_document_no() SET search_path = public;
ALTER FUNCTION public.trg_credit_notes_doc_no() SET search_path = public;
ALTER FUNCTION public.trg_internal_invoices_doc_no() SET search_path = public;
ALTER FUNCTION public.recover_employee_advance(p_advance_id uuid, p_amount numeric) SET search_path = public;
ALTER FUNCTION public.get_order_status_counts(p_company_id uuid) SET search_path = public;
ALTER FUNCTION public.trg_bpr_adjustments_sync() SET search_path = public;
ALTER FUNCTION public.trg_hr_letters_ref_no() SET search_path = public;
ALTER FUNCTION public.trg_journal_vouchers_doc_no() SET search_path = public;
ALTER FUNCTION public.trg_received_chalans_doc_no() SET search_path = public;
ALTER FUNCTION public.get_unread_group_message_count(p_employee_id uuid) SET search_path = public;
ALTER FUNCTION public.add_task_daily_time(p_task_id uuid, p_log_date date, p_seconds integer) SET search_path = public;
ALTER FUNCTION public.finance_dashboard_unlinked_purchase_washing(p_company_id uuid, p_from date, p_to date) SET search_path = public;
ALTER FUNCTION public.finance_dashboard_monthly(p_company_id uuid, p_from date, p_to date, p_store_id uuid, p_buyer_country text) SET search_path = public;

-- Also folds in current_employee_id() (added in Phase 3/C6, already SECURITY DEFINER by
-- design — used inside direct_messages' RLS policies) since it was found undocumented-but-live
-- during this same advisor sweep and has the same mutable-search_path gap.
ALTER FUNCTION public.current_employee_id() SET search_path = public;
