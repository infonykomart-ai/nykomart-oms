"use client";

// 2026-11-18b — Expense voucher entry form.
//
// The live totals come from the SAME pure calculation the server runs
// (src/lib/accounts/expense-calc.ts), so the number on screen is the number
// stored. Dynamic lines + additional charges, GST inclusive/exclusive, and the
// payment-mode → account rule are all visible while typing.

import { useActionState, useState } from "react";
import Link from "next/link";
import { saveExpenseAction } from "./actions";
import { emptyExpenseFormState } from "@/lib/accounts/form-state";
import { calculateVoucher, type ExpenseChargeInput, type ExpenseItemInput } from "@/lib/accounts/expense-calc";
import {
  expenseQtyLabel,
  expenseRateLabel,
  expenseUnitGroups,
  expenseUnitLabel,
  normalizeExpenseUnit,
  resolveExpenseLineUnits,
  type ResolvedExpenseLineUnits,
} from "@/lib/accounts/line-units";
import { formatPaise } from "@/lib/accounts/money";
import { EXPENSE_TYPES, GST_RATES, INDIAN_STATES, PAYMENT_MODES } from "@/lib/accounts/validation";
import { LENGTH_UNITS, LENGTH_UNIT_LABEL } from "@/lib/measurement";

const input =
  "w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const label = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-stone-500";

export type AccountOption = {
  id: string;
  name: string;
  code: string;
  isCash: boolean;
  isBank: boolean;
  isPettyCash: boolean;
  isCreditCard: boolean;
};

export type CategoryOption = {
  id: string;
  name: string;
  groupName: string;
  defaultGstRate: number;
  gstApplicable: boolean;
  itcEligible: boolean;
};

type Option = { id: string; name: string };

/**
 * What the company enabled in OMS Settings → Measurement. Optional: without it
 * every engine unit is offered, exactly like Office Expenses before settings
 * existed.
 */
export type ExpenseUnitSettings = {
  enabledUnits?: string[];
  defaultQuantityUnit?: string;
};

type DraftLine = {
  key: string;
  description: string;
  categoryId: string;
  qty: string;
  unit: string;
  rate: string;
  amount: string;
  discount: string;
  gstRate: string;
  gstInclusive: boolean;
  itcEligible: boolean;
  /** Size of ONE piece — only used when `unit` is an AREA unit (SQ FT…). */
  length: string;
  width: string;
  lengthUnit: string;
  widthUnit: string;
  /** Piece count the size applies to; blank = use `qty` as the count. */
  pieces: string;
};

type DraftCharge = {
  key: string;
  chargeName: string;
  amount: string;
  gstRate: string;
  isTaxable: boolean;
  allocationMethod: "equal" | "quantity" | "weight" | "value" | "manual";
};

let seq = 0;
const nextKey = () => {
  seq += 1;
  return `k${seq}`;
};

function newLine(defaultUnit: string): DraftLine {
  return {
    key: nextKey(),
    description: "",
    categoryId: "",
    qty: "1",
    unit: defaultUnit,
    rate: "",
    amount: "",
    discount: "",
    gstRate: "0",
    gstInclusive: false,
    itcEligible: true,
    length: "",
    width: "",
    lengthUnit: "FT",
    widthUnit: "FT",
    pieces: "",
  };
}

/**
 * The line's own maths, spelled out: "10 MTR = 32.808 FT", or for an area line
 * with a size "12 × 4 FT × 6 FT = 288 SQ FT". A unit nobody can verify is a
 * unit that will be billed wrong.
 */
function unitHint(line: DraftLine, resolved: ResolvedExpenseLineUnits): string | null {
  if (!resolved.unit || !resolved.qty) return null;
  const base =
    resolved.baseQty != null && resolved.baseUnit && resolved.baseUnit !== resolved.unit
      ? ` = ${resolved.baseQty} ${expenseUnitLabel(resolved.baseUnit)}`
      : "";
  const unitLabel = expenseUnitLabel(resolved.unit);
  if (!resolved.derivedFromSize) return `${resolved.qty} ${unitLabel}${base}`;
  const lengthUnit = normalizeExpenseUnit(line.lengthUnit) ?? "FT";
  const widthUnit = normalizeExpenseUnit(line.widthUnit) ?? lengthUnit;
  const pieces = line.pieces || line.qty;
  return `${pieces} × ${line.length} ${expenseUnitLabel(lengthUnit)} × ${line.width} ${expenseUnitLabel(
    widthUnit
  )} = ${resolved.qty} ${unitLabel}${base}`;
}

export function ExpenseEntryForm({
  companies,
  defaultCompanyId,
  accounts,
  categories,
  departments,
  employees,
  homeState,
  today,
  roundToRupee,
  unitSettings,
}: {
  companies: Option[];
  defaultCompanyId: string;
  accounts: AccountOption[];
  categories: CategoryOption[];
  departments: Option[];
  employees: Option[];
  homeState: string | null;
  today: string;
  roundToRupee: boolean;
  unitSettings: ExpenseUnitSettings;
}) {
  const [state, formAction, pending] = useActionState(saveExpenseAction, emptyExpenseFormState);

  const [companyId, setCompanyId] = useState(defaultCompanyId);
  const [voucherDate, setVoucherDate] = useState(today);
  const [expenseType, setExpenseType] = useState<string>("Office Expense");
  const [paymentMode, setPaymentMode] = useState<string>("Cash");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paid, setPaid] = useState(true);
  const [paidTo, setPaidTo] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [branch, setBranch] = useState("");
  const [costCentre, setCostCentre] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [gstin, setGstin] = useState("");
  const [vendorState, setVendorState] = useState(homeState ?? "");
  const [placeOfSupply, setPlaceOfSupply] = useState(homeState ?? "");
  const [forceInterstate, setForceInterstate] = useState(false);
  const [description, setDescription] = useState("");
  const [remarks, setRemarks] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [upiReference, setUpiReference] = useState("");

  // The company's measurement settings decide which units the dropdown
  // offers; the default count unit seeds every new line.
  const unitGroups = expenseUnitGroups(unitSettings.enabledUnits);
  const defaultUnit = normalizeExpenseUnit(unitSettings.defaultQuantityUnit) ?? "PCS";
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine(defaultUnit)]);
  const [charges, setCharges] = useState<DraftCharge[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  const interstate = forceInterstate
    ? true
    : Boolean(homeState) && Boolean(placeOfSupply || vendorState)
      ? (placeOfSupply || vendorState) !== homeState
      : false;

  const itemsForCalc: ExpenseItemInput[] = lines.map((line) => {
    const category = categories.find((c) => c.id === line.categoryId);
    return {
      description: line.description,
      categoryId: line.categoryId || null,
      qty: line.qty,
      unit: line.unit || null,
      rate: line.rate,
      length: line.length,
      width: line.width,
      lengthUnit: line.lengthUnit,
      widthUnit: line.widthUnit,
      pieces: line.pieces,
      amount: line.amount,
      discount: line.discount,
      gstRate: line.gstRate,
      gstInclusive: line.gstInclusive,
      gstApplicable: category ? category.gstApplicable : true,
      itcEligible: line.itcEligible,
    };
  });

  const chargesForCalc: ExpenseChargeInput[] = charges.map((charge) => ({
    chargeName: charge.chargeName,
    amount: charge.amount,
    gstRate: charge.gstRate,
    isTaxable: charge.isTaxable,
    allocationMethod: charge.allocationMethod,
  }));

  // Pure and cheap — computed on every render so the preview can never drift
  // from what the server will calculate from the same input.
  const calculation = calculateVoucher({
    items: itemsForCalc,
    charges: chargesForCalc,
    interstate,
    roundToRupee,
  });

  const accountLabel = (account: AccountOption) => {
    const kind = account.isCash
      ? "Cash"
      : account.isBank
        ? "Bank"
        : account.isPettyCash
          ? "Petty cash"
          : account.isCreditCard
            ? "Credit card"
            : "Account";
    return `${account.code} · ${account.name} (${kind})`;
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const updateCharge = (key: string, patch: Partial<DraftCharge>) =>
    setCharges((current) => current.map((charge) => (charge.key === key ? { ...charge, ...patch } : charge)));

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="items" value={JSON.stringify(itemsForCalc)} />
      <input type="hidden" name="charges" value={JSON.stringify(chargesForCalc)} />
      <input type="hidden" name="force_interstate" value={forceInterstate ? "on" : ""} />
      {paid ? <input type="hidden" name="paid" value="on" /> : null}

      {state.error ? (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>
      ) : null}
      {state.success ? (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Voucher saved. <Link href="?tab=expenses" className="underline">View the register</Link>
        </p>
      ) : null}
      {state.fieldErrors.length > 0 ? (
        <ul className="list-inside list-disc rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {state.fieldErrors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Basic details                                                     */}
      {/* ---------------------------------------------------------------- */}
      <section className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
        <h3 className="mb-3 text-sm font-semibold text-stone-800">1 · Basic details</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={label}>Company</label>
            <select name="company_id" value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={input}>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Expense date</label>
            <input
              type="date"
              name="voucher_date"
              value={voucherDate}
              onChange={(e) => setVoucherDate(e.target.value)}
              className={input}
              required
            />
          </div>
          <div>
            <label className={label}>Expense type (accounting nature)</label>
            <select name="expense_type" value={expenseType} onChange={(e) => setExpenseType(e.target.value)} className={input}>
              {EXPENSE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Department</label>
            <select name="department_id" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={input}>
              <option value="">—</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Paid to</label>
            <input name="paid_to" value={paidTo} onChange={(e) => setPaidTo(e.target.value)} className={input} placeholder="Vendor / person" />
          </div>
          <div>
            <label className={label}>Employee (reimbursement)</label>
            <select name="employee_id" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={input}>
              <option value="">—</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Branch</label>
            <input name="branch" value={branch} onChange={(e) => setBranch(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Cost centre</label>
            <input name="cost_centre" value={costCentre} onChange={(e) => setCostCentre(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Invoice no.</label>
            <input name="invoice_no" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Invoice date</label>
            <input type="date" name="invoice_date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Vendor GSTIN</label>
            <input
              name="gstin"
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              className={input}
              placeholder="07ABCDE1234F1Z5"
              maxLength={15}
            />
          </div>
          <div>
            <label className={label}>Vendor state</label>
            <select name="vendor_state" value={vendorState} onChange={(e) => setVendorState(e.target.value)} className={input}>
              <option value="">—</option>
              {INDIAN_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Place of supply</label>
            <select name="place_of_supply" value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)} className={input}>
              <option value="">—</option>
              {INDIAN_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>GST treatment</label>
            <div className="flex h-[34px] items-center gap-3 text-xs text-stone-700">
              <span className={`rounded px-2 py-0.5 ${interstate ? "bg-sky-100 text-sky-800" : "bg-stone-200 text-stone-600"}`}>
                {interstate ? "IGST" : "CGST + SGST"}
              </span>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={forceInterstate}
                  onChange={(e) => setForceInterstate(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                force IGST
              </label>
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Description</label>
            <input name="description" value={description} onChange={(e) => setDescription(e.target.value)} className={input} />
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Remarks</label>
            <input name="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={input} />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Expense lines                                                     */}
      {/* ---------------------------------------------------------------- */}
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-800">2 · Expense lines</h3>
          <button
            type="button"
            onClick={() => setLines((current) => [...current, newLine(defaultUnit)])}
            className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100"
          >
            + Add line
          </button>
        </div>

        <div className="space-y-3">
          {lines.map((line, index) => {
            const category = categories.find((c) => c.id === line.categoryId);
            // Same pure resolution the server will run on save.
            const resolved = resolveExpenseLineUnits(line);
            const isArea = resolved.family === "AREA";
            const hint = unitHint(line, resolved);
            return (
              <div key={line.key} className="rounded-lg border border-stone-200 p-3">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-12">
                  <div className="lg:col-span-2">
                    <label className={label}>Description</label>
                    <input
                      value={line.description}
                      onChange={(e) => updateLine(line.key, { description: e.target.value })}
                      className={input}
                      placeholder={`Line ${index + 1}`}
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <label className={label}>Category</label>
                    <select
                      value={line.categoryId}
                      onChange={(e) => {
                        const next = categories.find((c) => c.id === e.target.value);
                        updateLine(line.key, {
                          categoryId: e.target.value,
                          gstRate: next ? String(next.defaultGstRate) : line.gstRate,
                          itcEligible: next ? next.itcEligible : line.itcEligible,
                        });
                      }}
                      className={input}
                    >
                      <option value="">—</option>
                      {categories.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.groupName} · {option.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="lg:col-span-1">
                    <label className={label}>{expenseQtyLabel(line.unit)}</label>
                    <input
                      value={resolved.derivedFromSize ? String(resolved.qty ?? "") : line.qty}
                      onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                      className={`${input} ${resolved.derivedFromSize ? "bg-stone-100 text-stone-600" : ""}`}
                      inputMode="decimal"
                      readOnly={resolved.derivedFromSize}
                      title={resolved.derivedFromSize ? "From the size below — Length × Width × pieces" : undefined}
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <label className={label}>Unit</label>
                    <select
                      value={line.unit}
                      onChange={(e) => updateLine(line.key, { unit: e.target.value })}
                      className={input}
                      title="How the vendor bills this line — the rate is per this unit"
                    >
                      <option value="">— no unit —</option>
                      {unitGroups.map((group) => (
                        <optgroup key={group.family} label={group.label}>
                          {group.units.map((unit) => (
                            <option key={unit} value={unit}>
                              {expenseUnitLabel(unit)}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div className="lg:col-span-1">
                    <label className={label}>{expenseRateLabel(line.unit)}</label>
                    <input
                      value={line.rate}
                      onChange={(e) => updateLine(line.key, { rate: e.target.value })}
                      className={input}
                      inputMode="decimal"
                    />
                  </div>
                  <div className="lg:col-span-1">
                    <label className={label}>Amount</label>
                    <input
                      value={line.amount}
                      onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                      className={input}
                      inputMode="decimal"
                      placeholder="if no qty"
                    />
                  </div>
                  <div className="lg:col-span-1">
                    <label className={label}>Disc.</label>
                    <input
                      value={line.discount}
                      onChange={(e) => updateLine(line.key, { discount: e.target.value })}
                      className={input}
                      inputMode="decimal"
                    />
                  </div>
                  <div className="lg:col-span-1">
                    <label className={label}>GST %</label>
                    <select
                      value={line.gstRate}
                      onChange={(e) => updateLine(line.key, { gstRate: e.target.value })}
                      className={input}
                    >
                      {GST_RATES.map((rate) => (
                        <option key={rate} value={String(rate)}>
                          {rate}%
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="lg:col-span-1">
                    <label className={label}>Incl.</label>
                    <div className="flex h-[34px] items-center gap-1">
                      <input
                        type="checkbox"
                        checked={line.gstInclusive}
                        onChange={(e) => updateLine(line.key, { gstInclusive: e.target.checked })}
                        className="h-4 w-4"
                        title="Amount already includes GST"
                      />
                      <input
                        type="checkbox"
                        checked={line.itcEligible}
                        onChange={(e) => updateLine(line.key, { itcEligible: e.target.checked })}
                        className="h-4 w-4"
                        title="Input tax credit eligible"
                      />
                    </div>
                  </div>
                </div>
                {isArea ? (
                  <div className="mt-2 grid gap-2 rounded-lg bg-amber-50/70 p-2 sm:grid-cols-2 lg:grid-cols-12">
                    <div className="lg:col-span-2">
                      <label className={label}>Length (1 piece)</label>
                      <input
                        value={line.length}
                        onChange={(e) => updateLine(line.key, { length: e.target.value })}
                        className={input}
                        inputMode="decimal"
                        placeholder="e.g. 4"
                      />
                    </div>
                    <div className="lg:col-span-2">
                      <label className={label}>Length unit</label>
                      <select
                        value={line.lengthUnit}
                        onChange={(e) => updateLine(line.key, { lengthUnit: e.target.value })}
                        className={input}
                      >
                        {LENGTH_UNITS.map((unit) => (
                          <option key={unit} value={unit}>
                            {LENGTH_UNIT_LABEL[unit]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="lg:col-span-2">
                      <label className={label}>Width (1 piece)</label>
                      <input
                        value={line.width}
                        onChange={(e) => updateLine(line.key, { width: e.target.value })}
                        className={input}
                        inputMode="decimal"
                        placeholder="e.g. 6"
                      />
                    </div>
                    <div className="lg:col-span-2">
                      <label className={label}>Width unit</label>
                      <select
                        value={line.widthUnit}
                        onChange={(e) => updateLine(line.key, { widthUnit: e.target.value })}
                        className={input}
                      >
                        {LENGTH_UNITS.map((unit) => (
                          <option key={unit} value={unit}>
                            {LENGTH_UNIT_LABEL[unit]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="lg:col-span-2">
                      <label className={label}>Pieces</label>
                      <input
                        value={line.pieces}
                        onChange={(e) => updateLine(line.key, { pieces: e.target.value })}
                        className={input}
                        inputMode="decimal"
                        placeholder="= qty"
                        title="How many pieces the size applies to — blank means the Qty"
                      />
                    </div>
                    <div className="flex items-end lg:col-span-2">
                      <p className="text-[10px] leading-tight text-stone-600">
                        {resolved.derivedFromSize
                          ? "Area is calculated from the size — the qty box above is the result."
                          : "Leave the size blank when the bill already states the total area."}
                      </p>
                    </div>
                  </div>
                ) : null}
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-stone-500">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>
                      {category ? `${category.groupName} · ${category.name}` : "No category — posts to the default expense account"}
                      {" · "}
                      tick = GST inclusive / ITC eligible
                    </span>
                    {hint ? (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-800">{hint}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLines((current) => (current.length > 1 ? current.filter((l) => l.key !== line.key) : current))}
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Additional charges */}
        <div className="mt-4 border-t border-stone-200 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-stone-700">Additional charges (optional)</h4>
            <button
              type="button"
              onClick={() =>
                setCharges((current) => [
                  ...current,
                  { key: nextKey(), chargeName: "Freight", amount: "", gstRate: "0", isTaxable: false, allocationMethod: "value" },
                ])
              }
              className="rounded-lg border border-stone-300 px-2 py-0.5 text-[11px] text-stone-700 hover:bg-stone-100"
            >
              + Add charge
            </button>
          </div>
          {charges.length === 0 ? (
            <p className="text-[11px] text-stone-500">Freight, loading, kanta, labour, packing, insurance…</p>
          ) : (
            <div className="space-y-2">
              {charges.map((charge) => (
                <div key={charge.key} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-12">
                  <div className="lg:col-span-3">
                    <input
                      value={charge.chargeName}
                      onChange={(e) => updateCharge(charge.key, { chargeName: e.target.value })}
                      className={input}
                      placeholder="Charge name"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <input
                      value={charge.amount}
                      onChange={(e) => updateCharge(charge.key, { amount: e.target.value })}
                      className={input}
                      placeholder="Amount"
                      inputMode="decimal"
                    />
                  </div>
                  <div className="lg:col-span-2">
                    <select
                      value={charge.gstRate}
                      onChange={(e) => updateCharge(charge.key, { gstRate: e.target.value })}
                      className={input}
                    >
                      {GST_RATES.map((rate) => (
                        <option key={rate} value={String(rate)}>
                          {rate}%
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="lg:col-span-2">
                    <select
                      value={charge.allocationMethod}
                      onChange={(e) =>
                        updateCharge(charge.key, { allocationMethod: e.target.value as DraftCharge["allocationMethod"] })
                      }
                      className={input}
                    >
                      {["value", "equal", "quantity", "weight", "manual"].map((method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="lg:col-span-2 flex items-center gap-2">
                    <label className="flex items-center gap-1 text-[11px] text-stone-600">
                      <input
                        type="checkbox"
                        checked={charge.isTaxable}
                        onChange={(e) => updateCharge(charge.key, { isTaxable: e.target.checked })}
                        className="h-4 w-4"
                      />
                      taxable
                    </label>
                    <button
                      type="button"
                      onClick={() => setCharges((current) => current.filter((c) => c.key !== charge.key))}
                      className="ml-auto text-xs text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Payment                                                           */}
      {/* ---------------------------------------------------------------- */}
      <section className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
        <h3 className="mb-3 text-sm font-semibold text-stone-800">3 · Payment</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={label}>Payment mode</label>
            <select name="payment_mode" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className={input}>
              {PAYMENT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Paid from (cash / bank)</label>
            <select
              name="payment_account_id"
              value={paymentAccountId}
              onChange={(e) => setPaymentAccountId(e.target.value)}
              className={input}
            >
              <option value="">—</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {accountLabel(account)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-stone-500">
              UPI / NEFT / cheque must be a bank account. UPI never touches cash.
            </p>
          </div>
          <div>
            <label className={label}>Payment reference</label>
            <input
              name="payment_reference"
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              className={input}
            />
          </div>
          <div>
            <label className={label}>UPI UTR / transaction id</label>
            <input name="upi_reference" value={upiReference} onChange={(e) => setUpiReference(e.target.value)} className={input} />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-xs text-stone-700">
              <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-4 w-4" />
              Already paid (otherwise it becomes a payable)
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Receipt / invoice attachment</label>
            <input type="file" name="receipt" accept="image/*,application/pdf" className="w-full text-xs text-stone-600" />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Totals                                                            */}
      {/* ---------------------------------------------------------------- */}
      <section className="rounded-xl border border-stone-300 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-800">4 · Totals</h3>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="text-xs font-medium text-amber-700 hover:underline"
          >
            {showPreview ? "Hide" : "Show"} accounting preview
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-4">
          <Row label="Gross" value={calculation.totals.grossPaise} />
          <Row label="Discount" value={calculation.totals.discountPaise} />
          <Row label="Taxable" value={calculation.totals.taxablePaise} />
          <Row label="CGST" value={calculation.totals.cgstPaise} />
          <Row label="SGST" value={calculation.totals.sgstPaise} />
          <Row label="IGST" value={calculation.totals.igstPaise} />
          <Row label="Cess" value={calculation.totals.cessPaise} />
          <Row label="Charges" value={calculation.totals.chargesPaise} />
          <Row label="Non-GST" value={calculation.totals.nonGstPaise} />
          <Row label="ITC eligible" value={calculation.totals.itcPaise} />
          <Row label="Round off" value={calculation.totals.roundOffPaise} />
          <div className="col-span-2 border-t border-stone-200 pt-1 sm:col-span-1">
            <dt className="text-[11px] uppercase tracking-wide text-stone-500">Grand total</dt>
            <dd className="text-base font-semibold text-stone-900">₹{formatPaise(calculation.totals.grandTotalPaise)}</dd>
          </div>
        </dl>

        {showPreview ? (
          <div className="mt-3 rounded-lg bg-stone-900 p-3 font-mono text-[11px] leading-relaxed text-stone-100">
            <p className="mb-1 text-stone-400">Journal preview (debit = expense/GST, credit = payment or payable)</p>
            {calculation.valid ? (
              <>
                <p>Dr {formatPaise(calculation.totals.taxablePaise + calculation.totals.chargesPaise + calculation.totals.cessPaise)} · expense &amp; charges</p>
                <p>Dr {formatPaise(calculation.totals.taxPaise - calculation.totals.cessPaise)} · GST input</p>
                <p className="mt-1">Cr {formatPaise(calculation.totals.grandTotalPaise)} · {paid ? "payment account" : "payable"}</p>
              </>
            ) : (
              <p className="text-amber-300">Fix the lines to see the accounting entry.</p>
            )}
          </div>
        ) : null}

        {!calculation.valid && calculation.errors.length > 0 ? (
          <ul className="mt-2 list-inside list-disc text-[11px] text-amber-800">
            {calculation.errors.slice(0, 4).map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            name="intent"
            value="draft"
            disabled={pending}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save draft"}
          </button>
          <button
            type="submit"
            name="intent"
            value="submit"
            disabled={pending || !calculation.valid}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
          >
            Submit for approval
          </button>
          <span className="self-center text-[11px] text-stone-500">
            Nothing reaches the ledger until an admin approves and posts it.
          </span>
        </div>
      </section>
    </form>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className="text-stone-800">{formatPaise(value)}</dd>
    </div>
  );
}
