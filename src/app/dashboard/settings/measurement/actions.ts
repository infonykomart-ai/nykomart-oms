"use server";

// 2026-11-05 — OMS Settings → Measurement. One row per company
// (company_measurement_settings) holding the default dimension/area/rate/
// report units, the decimal precision and whether a transaction may override
// the units. Saving here never touches an existing transaction: purchase rows
// store their OWN original dimensions + display unit, so changing a default
// only affects forms opened afterwards.
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isAreaUnit, isLengthUnit } from "@/lib/measurement";

export type MeasurementSettingsInput = {
  dimensionUnit: string;
  areaUnit: string;
  rateUnit: string;
  reportUnit: string;
  precision: number;
};

export type MeasurementSettingsResult = { error: string | null; saved?: boolean };

export async function saveMeasurementSettings(
  input: MeasurementSettingsInput
): Promise<MeasurementSettingsResult> {
  // Any employee who can enter purchase documents (the screen these defaults
  // feed) may change the company defaults; no separate capability added.
  const employee = await requireCapability("doc_entry");

  if (!isLengthUnit(input.dimensionUnit)) return { error: "Pick a valid default dimension unit (MM/CM/MTR/INCH/FT)." };
  if (!isAreaUnit(input.areaUnit)) return { error: "Pick a valid default area unit." };
  if (!isAreaUnit(input.rateUnit)) return { error: "Pick a valid default rate unit." };
  if (!isAreaUnit(input.reportUnit)) return { error: "Pick a valid default report unit." };
  if (![2, 3, 4].includes(input.precision)) return { error: "Decimal precision must be 2, 3 or 4 places." };

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("company_measurement_settings").upsert(
    {
      company_id: employee.currentCompanyId,
      default_dimension_unit: input.dimensionUnit,
      default_area_unit: input.areaUnit,
      default_rate_unit: input.rateUnit,
      default_report_unit: input.reportUnit,
      decimal_precision: input.precision,
      updated_by_employee_id: employee.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" }
  );

  if (error) {
    if (/company_measurement_settings/i.test(error.message)) {
      return {
        error:
          "Measurement settings need db/2026-11-05-refund-edit-delete-and-measurement.sql applied to the database first.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/dashboard/settings/measurement");
  revalidatePath("/dashboard/documents");
  return { error: null, saved: true };
}
