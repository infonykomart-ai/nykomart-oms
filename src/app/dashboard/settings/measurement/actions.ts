"use server";

// 2026-11-05 — OMS Settings → Measurement. One row per company
// (company_measurement_settings) holding the default dimension/area/rate/
// report units, the decimal precision and whether a transaction may override
// the units. Saving here never touches an existing transaction: every row
// stores its OWN original dimensions + display unit, so changing a default
// only affects forms opened afterwards.
//
// 2026-11-06 — extended with weight/quantity units, enabled unit lists,
// rounding mode and per-module billing defaults. Historical rows still keep
// their own values; these are form defaults only.
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  AREA_UNITS,
  LENGTH_UNITS,
  QUANTITY_UNITS,
  WEIGHT_UNITS,
  isAreaUnit,
  isLengthUnit,
  isQuantityUnit,
  isRoundingMode,
  isWeightUnit,
  type AreaUnit,
  type LengthUnit,
  type QuantityUnit,
  type RoundingMode,
  type WeightUnit,
} from "@/lib/measurement";

export type ModuleMeasurementDefaults = {
  purchaseAreaUnit: AreaUnit;
  printingAreaUnit: AreaUnit;
  washingAreaUnit: AreaUnit;
  expenseQtyUnit: QuantityUnit;
};

export type MeasurementSettingsInput = {
  dimensionUnit: string;
  areaUnit: string;
  rateUnit: string;
  reportUnit: string;
  precision: number;
  enabledLengthUnits: string[];
  enabledAreaUnits: string[];
  enabledWeightUnits: string[];
  enabledQuantityUnits: string[];
  defaultWeightUnit: string;
  defaultQuantityUnit: string;
  roundingMode: string;
  moduleDefaults: ModuleMeasurementDefaults;
};

export type MeasurementSettingsResult = { error: string | null; saved?: boolean };

function uniqueValid<T extends string>(
  values: readonly string[] | null | undefined,
  valid: readonly T[],
  isUnit: (v: unknown) => v is T
): T[] {
  const checked = (Array.isArray(values) ? values : []).filter(isUnit);
  return Array.from(new Set(checked.length > 0 ? checked : [...valid]));
}

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
  if (!isWeightUnit(input.defaultWeightUnit)) return { error: "Pick a valid default weight unit." };
  if (!isQuantityUnit(input.defaultQuantityUnit)) return { error: "Pick a valid default quantity unit." };
  if (!isRoundingMode(input.roundingMode)) return { error: "Pick a valid rounding mode." };
  const moduleDefaults = input.moduleDefaults;
  if (
    !moduleDefaults ||
    !isAreaUnit(moduleDefaults.purchaseAreaUnit) ||
    !isAreaUnit(moduleDefaults.printingAreaUnit) ||
    !isAreaUnit(moduleDefaults.washingAreaUnit)
  ) {
    return { error: "Module billing defaults must use valid area units." };
  }
  if (!isQuantityUnit(moduleDefaults.expenseQtyUnit)) return { error: "Expense default quantity unit is invalid." };

  const enabledLength = uniqueValid(input.enabledLengthUnits, LENGTH_UNITS, isLengthUnit);
  const enabledArea = uniqueValid(input.enabledAreaUnits, AREA_UNITS, isAreaUnit);
  const enabledWeight = uniqueValid(input.enabledWeightUnits, WEIGHT_UNITS, isWeightUnit);
  const enabledQuantity = uniqueValid(input.enabledQuantityUnits, QUANTITY_UNITS, isQuantityUnit);
  if (!enabledLength.includes(input.dimensionUnit)) return { error: "Default dimension unit is disabled — enable it or pick another default." };
  if (!enabledArea.includes(input.areaUnit) || !enabledArea.includes(input.rateUnit) || !enabledArea.includes(input.reportUnit)) {
    return { error: "Default area/rate/report unit is disabled — enable it or pick another default." };
  }
  if (!enabledWeight.includes(input.defaultWeightUnit)) return { error: "Default weight unit is disabled." };
  if (!enabledQuantity.includes(input.defaultQuantityUnit)) return { error: "Default quantity unit is disabled." };
  if (
    !enabledArea.includes(moduleDefaults.purchaseAreaUnit) ||
    !enabledArea.includes(moduleDefaults.printingAreaUnit) ||
    !enabledArea.includes(moduleDefaults.washingAreaUnit)
  ) {
    return { error: "A module billing unit is disabled in the available area units." };
  }
  if (!enabledQuantity.includes(moduleDefaults.expenseQtyUnit)) return { error: "Expense default quantity unit is disabled." };

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("company_measurement_settings").upsert(
    {
      company_id: employee.currentCompanyId,
      default_dimension_unit: input.dimensionUnit,
      default_area_unit: input.areaUnit,
      default_rate_unit: input.rateUnit,
      default_report_unit: input.reportUnit,
      decimal_precision: input.precision,
      enabled_length_units: enabledLength,
      enabled_area_units: enabledArea,
      enabled_weight_units: enabledWeight,
      enabled_quantity_units: enabledQuantity,
      default_weight_unit: input.defaultWeightUnit,
      default_quantity_unit: input.defaultQuantityUnit,
      rounding_mode: input.roundingMode as RoundingMode,
      module_defaults: moduleDefaults,
      updated_by_employee_id: employee.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" }
  );

  if (error) {
    if (/company_measurement_settings|enabled_length_units|module_defaults/i.test(error.message)) {
      return {
        error:
          "Measurement settings need db/2026-11-06-return-lifecycle-measurement-biometric.sql applied to the database first.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/dashboard/settings/measurement");
  revalidatePath("/dashboard/documents");
  return { error: null, saved: true };
}

export type { AreaUnit, LengthUnit, QuantityUnit, WeightUnit };
