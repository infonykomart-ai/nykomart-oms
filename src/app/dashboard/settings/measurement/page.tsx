// 2026-11-05 — OMS Settings → Measurement.
// Company defaults for dimension/area/rate/report units + decimal precision.
// Company-scoped, so it needs the same capability as the document screens it
// configures (doc_entry) rather than a new permission.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { MeasurementSettingsPanel } from "./measurement-settings-panel";

const BUILT_IN_DEFAULTS = {
  default_dimension_unit: "FT",
  default_area_unit: "SQ_FT",
  default_rate_unit: "SQ_FT",
  default_report_unit: "SQ_FT",
  decimal_precision: 2,
};

export default async function MeasurementSettingsPage() {
  const employee = await requireCapability("doc_entry");
  // Service-role read: company_measurement_settings has no RLS policies; the
  // capability check above is the authorization gate.
  const supabase = createServiceRoleClient();

  // No row (or a database that has not run the 2026-11-05 migration yet) =
  // the engine's built-in defaults, exactly what the purchase forms used
  // before this setting existed.
  const { data } = await supabase
    .from("company_measurement_settings")
    .select(
      "default_dimension_unit, default_area_unit, default_rate_unit, default_report_unit, decimal_precision, allow_per_transaction_unit"
    )
    .eq("company_id", employee.currentCompanyId)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-[var(--oms-text)]">Measurement</h1>
        <p className="mt-0.5 text-sm text-[var(--oms-text-muted)]">
          Universal unit defaults for purchase entry: length in MM / CM / MTR / INCH / FT, area in SQ MM / SQ CM /
          SQ MTR / SQ INCH / SQ FT. Mixed units (e.g. 30 INCH × 5 FT) are always allowed per entry.
        </p>
      </div>
      <MeasurementSettingsPanel settings={{ ...BUILT_IN_DEFAULTS, ...(data ?? {}) }} />
      <p className="text-xs text-slate-400">
        Measurement storage: <code>company_measurement_settings</code> (one row per company). Purchase bills keep their
        original dimensions, normalized area, chosen display unit and quoted rate unit on every row.
      </p>
    </div>
  );
}
