import { requireCapability } from "@/lib/auth/require-capability";
import { OrderPackagesClient } from "./order-packages-client";

// Gap 1 (multi-package per order, 2026-08-20) — see actions.ts header for
// the full design reference. Green-field entry screen: look up an order,
// see/add/edit its shipments (AWBs) and the packages under each.
export default async function OrderPackagesPage() {
  await requireCapability("doc_entry");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">📦 Order Shipments &amp; Packages</h1>
        <p className="mt-1 text-sm text-slate-500">
          Look up an order to record how it actually shipped — one or more physical packages, each under a
          shipment/AWB (packages can share one AWB, or each get its own — courier/case dependent).
        </p>
      </div>
      <OrderPackagesClient />
    </div>
  );
}
