// 2026-11-05 — OMS Settings → Measurement.
// Company defaults for dimension/area/rate/report units + decimal precision.
// Company-scoped, so it needs the same capability as the document screens it
// configures (doc_entry) rather than a new permission.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { MeasurementSettingsPanel, type MeasurementSettingsValues } from "./measurement-settings-panel";

const BUILT_IN_DEFAULTS: MeasurementSettingsValues = {
  default_dimension_unit: "FT",
  default_area_unit: "SQ_FT",
  default_rate_unit: "SQ_FT",
  default_report_unit: "SQ_FT",
  decimal_precision: 2,
  enabled_length_units: ["MM", "CM", "MTR", "INCH", "FT"],
  enabled_area_units: ["SQ_MM", "SQ_CM", "SQ_MTR", "SQ_INCH", "SQ_FT"],
  enabled_weight_units: ["G", "KG", "TON"],
  enabled_quantity_units: ["PCS", "SET", "BOX", "UNIT"],
  default_weight_unit: "KG",
  default_quantity_unit: "PCS",
  rounding_mode: "HALF_UP",
  module_defaults: null,
};

export default async function MeasurementSettingsPage() {
  const employee = await requireCapability("doc_entry");
  // Service-role read: company_measurement_settings has no RLS policies; the
  // capability check above is the authorization gate.
  const supabase = createServiceRoleClient();

  // No row (or a database that has not run the 2026-11-06 migration yet) =
  // the engine's built-in defaults, exactly what the entry forms used
  // before these settings existed.
  const { data } = await supabase
    .from("company_measurement_settings")
    .select(
      "default_dimension_unit, default_area_unit, default_rate_unit, default_report_unit, decimal_precision, enabled_length_units, enabled_area_units, enabled_weight_units, enabled_quantity_units, default_weight_unit, default_quantity_unit, rounding_mode, module_defaults"
    )
    .eq("company_id", employee.currentCompanyId)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-[var(--oms-text)]">Measurement</h1>
        <p className="mt-0.5 text-sm text-[var(--oms-text-muted)]">
          Universal unit defaults for Purchase, Printing, Washing and Other Expenses: length, area, weight and quantity,
          plus which units users may choose, decimal precision and rounding. Mixed units (e.g. 30 INCH × 5 FT) are always
          allowed per entry.
        </p>
      </div>
      <MeasurementSettingsPanel
        settings={{ ...BUILT_IN_DEFAULTS, ...((data ?? {}) as unknown as Partial<MeasurementSettingsValues>) }}
      />
      <p className="text-xs text-slate-400">
        Measurement storage: <code>company_measurement_settings</code> (one row per company). Every saved bill keeps its
        original dimensions, normalized area, chosen display unit and quoted rate unit on its own row; historical records
        are never recalculated by this screen.
      </p>
    </div>
  );
}
