"use client";

import { useActionState, useMemo, useRef, useState, useEffect } from "react";
import { saveStockIn, type StockFormState } from "./actions";
import { UnitSelect } from "@/components/unit-select";
import { toFeet, type LengthUnit } from "@/lib/length-units";

const initialState: StockFormState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type EditableStockIn = {
  id: string;
  source_party_id: string;
  sku_code: string;
  product_name: string | null;
  chalan_no: string | null;
  in_date: string | null;
  quantity_in: number;
  rate_per_qty: number | null;
  party_chalan_no: string | null;
  our_chalan_no: string | null;
  bill_no: string | null;
  bill_date: string | null;
  paid_date: string | null;
  remark: string | null;
};

// Used both for "new Stock In entry" (row=undefined) and inline editing
// (row set) — same form/action, hidden row_id when editing. Chalan No. is
// required here (the user's own hard rule for live entry) but NOT in the
// bulk CSV upload — see actions.ts's requireChalan param.
export function StockInForm({
  parties,
  skuOptions,
  row,
  onDone,
}: {
  parties: { id: string; name: string }[];
  skuOptions: string[];
  row?: EditableStockIn;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveStockIn, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const isEdit = !!row;

  const [qty, setQty] = useState(row?.quantity_in?.toString() ?? "");
  const [rate, setRate] = useState(row?.rate_per_qty?.toString() ?? "");
  // 2026-08-17 — same FT/MTR/INCH/YARD/CM picker as Purchase Bill (see
  // src/lib/length-units.ts). `qty` stays exactly what's typed, in whatever
  // unit is selected; the value actually submitted (quantity_in) is always
  // converted to feet.
  const [qtyUnit, setQtyUnit] = useState<LengthUnit>("FT");
  const qtyInFeet = toFeet(Number(qty) || 0, qtyUnit);

  // Reset the live-preview inputs the moment a submit succeeds — adjusted
  // during render (React's documented pattern for "state derived from a
  // prop/state change") rather than in an effect, so it can't cascade an
  // extra render. `prevState` only changes identity on a fresh
  // useActionState result, so this body runs once per successful submit,
  // not on every unrelated re-render.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) {
      setQty("");
      setRate("");
      setQtyUnit("FT");
    }
  }

  const preview = useMemo(() => {
    const q = toFeet(Number(qty) || 0, qtyUnit);
    const r = Number(rate);
    if (!Number.isFinite(q) || !Number.isFinite(r) || (!qty && !rate)) return null;
    const total = q * r;
    return { total, gst: total * 0.05, toBePaid: total * 1.05 };
  }, [qty, qtyUnit, rate]);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      onDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {isEdit && <input type="hidden" name="row_id" value={row.id} />}

      <datalist id="stock-sku-options">
        {skuOptions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="si_source">Source *</label>
          <select id="si_source" name="source_party_id" required defaultValue={row?.source_party_id ?? ""} className={inputClass}>
            <option value="" disabled>Select source</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="si_chalan">Chalan No. *</label>
          <input id="si_chalan" name="chalan_no" required defaultValue={row?.chalan_no ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="si_sku">SKU Code *</label>
          <input id="si_sku" name="sku_code" required list="stock-sku-options" defaultValue={row?.sku_code ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="si_product">Product Name</label>
          <input id="si_product" name="product_name" defaultValue={row?.product_name ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="si_date">In Date</label>
          <input id="si_date" name="in_date" type="date" defaultValue={row?.in_date ?? new Date().toISOString().slice(0, 10)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="si_qty">Quantity In *</label>
          <div className="flex gap-1.5">
            <input
              id="si_qty"
              type="number"
              step="0.01"
              required
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={inputClass}
            />
            <UnitSelect value={qtyUnit} onChange={setQtyUnit} />
          </div>
          {qtyUnit !== "FT" && qty && (
            <p className="mt-0.5 text-[11px] text-purple-600">= {qtyInFeet.toFixed(2)} Ft (saved)</p>
          )}
          <input type="hidden" name="quantity_in" value={qty ? qtyInFeet : ""} />
        </div>
        <div>
          <label className={labelClass} htmlFor="si_rate">Rate Per Qty</label>
          <input
            id="si_rate"
            name="rate_per_qty"
            type="number"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="si_party_chalan">Party Chalan No.</label>
          <input id="si_party_chalan" name="party_chalan_no" defaultValue={row?.party_chalan_no ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="si_our_chalan">Our Chalan No.</label>
          <input id="si_our_chalan" name="our_chalan_no" defaultValue={row?.our_chalan_no ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="si_bill_no">Bill No.</label>
          <input id="si_bill_no" name="bill_no" defaultValue={row?.bill_no ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="si_bill_date">Bill Date</label>
          <input id="si_bill_date" name="bill_date" type="date" defaultValue={row?.bill_date ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="si_paid_date">Paid Date</label>
          <input id="si_paid_date" name="paid_date" type="date" defaultValue={row?.paid_date ?? ""} className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="si_remark">Remark</label>
        <textarea id="si_remark" name="remark" rows={2} defaultValue={row?.remark ?? ""} className={inputClass} />
      </div>

      {preview && (
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <div>Total Amt: <span className="font-semibold text-slate-800">₹{preview.total.toFixed(2)}</span></div>
          <div>GST (5%): <span className="font-semibold text-slate-800">₹{preview.gst.toFixed(2)}</span></div>
          <div>To Be Paid: <span className="font-semibold text-slate-800">₹{preview.toBePaid.toFixed(2)}</span></div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
        >
          {pending ? "Saving..." : isEdit ? "Save Changes" : "Save Stock In"}
        </button>
        {isEdit && onDone && (
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
