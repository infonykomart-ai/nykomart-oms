"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  lookupOrderForPackages,
  saveOrderShipment,
  deleteOrderShipment,
  saveOrderPackage,
  deleteOrderPackage,
  type OrderPackagesLookup,
  type ShipmentRow,
} from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";
const initialSimple = { error: null };

export function OrderPackagesClient() {
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<OrderPackagesLookup | null>(null);
  const [isLooking, startLookup] = useTransition();

  function handleLookup() {
    startLookup(async () => {
      const r = await lookupOrderForPackages(query);
      setLookup(r);
    });
  }

  async function refresh() {
    if (!lookup?.order) return;
    const r = await lookupOrderForPackages(lookup.order.ref_no);
    setLookup(r);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <label className={labelClass}>Find order by PO/RF/RG No.</label>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleLookup())}
            placeholder="e.g. PO-0001"
            className={inputClass}
          />
          <button
            type="button"
            onClick={handleLookup}
            disabled={isLooking}
            className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {isLooking ? "..." : "Find"}
          </button>
        </div>
        {lookup?.error && <p className="mt-2 text-xs text-red-600">{lookup.error}</p>}
      </div>

      {lookup?.order && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">{lookup.order.ref_no}</h2>
            <p className="mt-1 text-xs text-slate-400">
              {lookup.shipments.length} shipment{lookup.shipments.length === 1 ? "" : "s"} on record.
            </p>
          </div>

          {lookup.shipments.map((s) => (
            <ShipmentCard key={s.id} orderId={lookup.order!.id} shipment={s} onChanged={refresh} />
          ))}

          <AddShipmentForm orderId={lookup.order.id} nextShipmentNo={lookup.shipments.length + 1} onSaved={refresh} />
        </div>
      )}
    </div>
  );
}

function ShipmentCard({ orderId, shipment, onChanged }: { orderId: string; shipment: ShipmentRow; onChanged: () => void }) {
  const [deleteError, setDeleteError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  function handleDelete() {
    setDeleteError("");
    startTransition(async () => {
      const r = await deleteOrderShipment(shipment.id);
      if (r.error) setDeleteError(r.error);
      else onChanged();
      setConfirmingDelete(false);
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">
            Shipment {shipment.shipment_no} {shipment.awb_no ? `— AWB ${shipment.awb_no}` : "(no AWB yet)"}
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            {shipment.courier_name ?? "—"} ·{" "}
            <span className={shipment.delivered_status === "Delivered" ? "text-green-600" : "text-slate-400"}>
              {shipment.delivered_status ?? "Not tracked yet"}
            </span>
            {shipment.delivered_date ? ` (${shipment.delivered_date})` : ""}
          </p>
          {shipment.remark && <p className="mt-0.5 text-xs text-slate-500">{shipment.remark}</p>}
        </div>
        <div className="flex shrink-0 gap-2 text-xs">
          <button type="button" onClick={() => setEditing((v) => !v)} className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-600 hover:bg-slate-50">
            {editing ? "Cancel" : "Edit"}
          </button>
          {confirmingDelete ? (
            <>
              <button type="button" disabled={isPending} onClick={handleDelete} className="rounded border border-red-300 bg-white px-2 py-1 font-semibold text-red-600 hover:bg-red-50">
                Confirm delete
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-500 hover:bg-slate-50">
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmingDelete(true)} className="rounded border border-red-200 bg-white px-2 py-1 font-medium text-red-600 hover:bg-red-50">
              Delete shipment
            </button>
          )}
        </div>
      </div>
      {deleteError && <p className="mt-2 text-xs text-red-600">{deleteError}</p>}

      {editing && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <ShipmentForm orderId={orderId} shipment={shipment} onSaved={() => { setEditing(false); onChanged(); }} />
        </div>
      )}

      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        <h4 className="text-xs font-semibold text-slate-600">Packages</h4>
        {shipment.packages.length === 0 && <p className="text-xs text-slate-400">No packages recorded yet.</p>}
        {shipment.packages.map((p) => (
          <PackageRowView key={p.id} orderShipmentId={shipment.id} pkg={p} onChanged={onChanged} />
        ))}
        <AddPackageForm orderShipmentId={shipment.id} nextPackageNo={shipment.packages.length + 1} onSaved={onChanged} />
      </div>
    </div>
  );
}

function PackageRowView({
  orderShipmentId,
  pkg,
  onChanged,
}: {
  orderShipmentId: string;
  pkg: ShipmentRow["packages"][number];
  onChanged: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  function handleDelete() {
    setError("");
    startTransition(async () => {
      const r = await deleteOrderPackage(pkg.id);
      if (r.error) setError(r.error);
      else onChanged();
    });
  }

  if (editing) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-2">
        <PackageEditForm orderShipmentId={orderShipmentId} pkg={pkg} onSaved={() => { setEditing(false); onChanged(); }} />
        <button type="button" onClick={() => setEditing(false)} className="mt-1 text-xs text-slate-400 hover:underline">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
      <span>
        Pkg {pkg.package_no} — {pkg.weight_kg ?? "—"} kg
        {pkg.length_cm || pkg.width_cm || pkg.height_cm ? ` · ${pkg.length_cm ?? "—"}×${pkg.width_cm ?? "—"}×${pkg.height_cm ?? "—"} cm` : ""}
        {pkg.remark ? ` · ${pkg.remark}` : ""}
      </span>
      <span className="flex gap-2">
        <button type="button" onClick={() => setEditing(true)} className="text-slate-400 hover:text-slate-700 hover:underline">
          Edit
        </button>
        <button type="button" disabled={isPending} onClick={handleDelete} className="text-red-500 hover:underline disabled:opacity-50">
          Delete
        </button>
      </span>
      {error && <span className="text-red-600">{error}</span>}
    </div>
  );
}

function ShipmentForm({ orderId, shipment, onSaved }: { orderId: string; shipment?: ShipmentRow; onSaved: () => void }) {
  const [state, formAction, pending] = useActionState(saveOrderShipment, initialSimple);

  useEffect(() => {
    if (state !== initialSimple && state.error === null) onSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="order_id" value={orderId} />
      {state.error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-800">{state.error}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <label className={labelClass}>Shipment No.</label>
          <input name="shipment_no" type="number" min="1" defaultValue={shipment?.shipment_no} className={inputClass} required />
        </div>
        <div>
          <label className={labelClass}>Courier</label>
          <input name="courier_name" defaultValue={shipment?.courier_name ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>AWB No.</label>
          <input name="awb_no" defaultValue={shipment?.awb_no ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Delivered Status</label>
          <select name="delivered_status" defaultValue={shipment?.delivered_status ?? ""} className={inputClass}>
            <option value="">—</option>
            <option value="Delivered">Delivered</option>
            <option value="NOT Delivered">NOT Delivered</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Delivered Date</label>
          <input name="delivered_date" type="date" defaultValue={shipment?.delivered_date ?? ""} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Remark</label>
          <input name="remark" defaultValue={shipment?.remark ?? ""} className={inputClass} />
        </div>
      </div>
      <button type="submit" disabled={pending} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50">
        {pending ? "Saving..." : "Save Shipment"}
      </button>
    </form>
  );
}

function AddShipmentForm({ orderId, nextShipmentNo, onSaved }: { orderId: string; nextShipmentNo: number; onSaved: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
      <h3 className="mb-2 text-xs font-semibold text-slate-600">Add another shipment/AWB</h3>
      <ShipmentForm orderId={orderId} shipment={{ id: "", shipment_no: nextShipmentNo, courier_name: null, awb_no: null, delivered_status: null, delivered_date: null, remark: null, packages: [] }} onSaved={onSaved} />
    </div>
  );
}

function PackageFieldSet({ pkg }: { pkg?: ShipmentRow["packages"][number] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <div>
        <label className={labelClass}>Pkg No.</label>
        <input name="package_no" type="number" min="1" defaultValue={pkg?.package_no} className={inputClass} required />
      </div>
      <div>
        <label className={labelClass}>Weight (kg)</label>
        <input name="weight_kg" type="number" step="0.001" defaultValue={pkg?.weight_kg ?? ""} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>L (cm)</label>
        <input name="length_cm" type="number" step="0.1" defaultValue={pkg?.length_cm ?? ""} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>W (cm)</label>
        <input name="width_cm" type="number" step="0.1" defaultValue={pkg?.width_cm ?? ""} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>H (cm)</label>
        <input name="height_cm" type="number" step="0.1" defaultValue={pkg?.height_cm ?? ""} className={inputClass} />
      </div>
      <div className="col-span-2 sm:col-span-5">
        <label className={labelClass}>Remark</label>
        <input name="remark" defaultValue={pkg?.remark ?? ""} className={inputClass} />
      </div>
    </div>
  );
}

function AddPackageForm({ orderShipmentId, nextPackageNo, onSaved }: { orderShipmentId: string; nextPackageNo: number; onSaved: () => void }) {
  const [state, formAction, pending] = useActionState(saveOrderPackage, initialSimple);

  useEffect(() => {
    if (state !== initialSimple && state.error === null) onSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="space-y-2 rounded border border-dashed border-slate-300 bg-white p-2">
      <input type="hidden" name="order_shipment_id" value={orderShipmentId} />
      {state.error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-800">{state.error}</p>}
      <PackageFieldSet pkg={{ id: "", package_no: nextPackageNo, weight_kg: null, length_cm: null, width_cm: null, height_cm: null, remark: null }} />
      <button type="submit" disabled={pending} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
        {pending ? "Adding..." : "Add Package"}
      </button>
    </form>
  );
}

function PackageEditForm({
  orderShipmentId,
  pkg,
  onSaved,
}: {
  orderShipmentId: string;
  pkg: ShipmentRow["packages"][number];
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveOrderPackage, initialSimple);

  useEffect(() => {
    if (state !== initialSimple && state.error === null) onSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="order_shipment_id" value={orderShipmentId} />
      {state.error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-800">{state.error}</p>}
      <PackageFieldSet pkg={pkg} />
      <button type="submit" disabled={pending} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50">
        {pending ? "Saving..." : "Save Package"}
      </button>
    </form>
  );
}
