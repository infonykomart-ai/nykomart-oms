"use client";

import { useActionState, useRef, useEffect } from "react";
import { saveStockOut, type StockFormState } from "./actions";

const initialState: StockFormState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type EditableStockOut = {
  id: string;
  source_party_id: string;
  sku_code: string;
  product_name: string | null;
  chalan_no: string | null;
  out_date: string | null;
  quantity_out: number;
  remark: string | null;
};

export function StockOutForm({
  parties,
  skuOptions,
  row,
  onDone,
}: {
  parties: { id: string; name: string }[];
  skuOptions: string[];
  row?: EditableStockOut;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveStockOut, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const isEdit = !!row;

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

      <datalist id="stock-sku-options-out">
        {skuOptions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="so_source">Source *</label>
          <select id="so_source" name="source_party_id" required defaultValue={row?.source_party_id ?? ""} className={inputClass}>
            <option value="" disabled>Select source</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="so_chalan">Chalan No. *</label>
          <input id="so_chalan" name="chalan_no" required defaultValue={row?.chalan_no ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="so_sku">SKU Code *</label>
          <input id="so_sku" name="sku_code" required list="stock-sku-options-out" defaultValue={row?.sku_code ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="so_product">Product Name</label>
          <input id="so_product" name="product_name" defaultValue={row?.product_name ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="so_date">Out Date</label>
          <input id="so_date" name="out_date" type="date" defaultValue={row?.out_date ?? new Date().toISOString().slice(0, 10)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="so_qty">Quantity Out *</label>
          <input id="so_qty" name="quantity_out" type="number" step="0.01" required defaultValue={row?.quantity_out ?? ""} className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="so_remark">Remark</label>
        <textarea id="so_remark" name="remark" rows={2} defaultValue={row?.remark ?? ""} className={inputClass} />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
        >
          {pending ? "Saving..." : isEdit ? "Save Changes" : "Save Stock Out"}
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
