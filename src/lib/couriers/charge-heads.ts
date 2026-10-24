// 2026-10-24 — the charge heads a courier invoice actually itemises.
//
// FedEx / UPS / Aramex all bill with the same broad vocabulary (base freight,
// fuel surcharge, remote area, residential/extended area, customs clearance,
// duty, RTO, address correction, weight discrepancy, …), so one shared list
// is used for every courier rather than three separate vocabularies that
// would drift. `couriers` marks the ones a given courier commonly applies, so
// the form can put the likely heads first, but every head stays selectable
// for every courier — a charge that does arrive from an unexpected courier
// must still be recordable instead of being forced into "Other".
//
// `gstPct` is the starting GST rate for that head, editable per line:
//   18 = the standard rate on Indian courier service charges
//   0  = the amounts are a government levy/disbursement, not our service
//        (duty / import tax), so no GST is added on top of them.
// Nothing here is a hard rule — the person entering the charge can override
// both the rate and the head.

export type ChargeHead = {
  key: string;
  label: string;
  /** When this charge applies — shown next to the picker. */
  when: string;
  /** Couriers this head is most commonly seen on. */
  couriers: ("FedEx" | "UPS" | "Aramex" | "DHL Express" | "Delhivery" | "Shiprocket")[];
  /** Default GST % for this head. */
  gstPct: number;
};

export const SHIPPING_CHARGE_HEADS: ChargeHead[] = [
  {
    key: "base_freight",
    label: "1. Base Freight / Shipping Charge",
    when: "The courier's basic transportation charge.",
    couriers: ["FedEx", "UPS", "Aramex", "DHL Express", "Delhivery", "Shiprocket"],
    gstPct: 18,
  },
  {
    key: "volumetric_weight",
    label: "2. Volumetric Weight Charge",
    when: "Parcel is large in size but light in weight, so billed on volumetric weight.",
    couriers: ["FedEx", "UPS", "Aramex", "DHL Express"],
    gstPct: 18,
  },
  {
    key: "fuel_surcharge",
    label: "3. Fuel Surcharge (FSC)",
    when: "Additional charge on account of fuel cost.",
    couriers: ["FedEx", "UPS", "Aramex", "DHL Express", "Delhivery", "Shiprocket"],
    gstPct: 18,
  },
  {
    key: "gst",
    label: "4. GST",
    when: "Tax on the applicable Indian shipping / service charges.",
    couriers: ["FedEx", "UPS", "Aramex", "DHL Express", "Delhivery", "Shiprocket"],
    gstPct: 0,
  },
  {
    key: "remote_area",
    label: "5. Remote Area Surcharge",
    when: "Delivery to a remote / out-of-route location.",
    couriers: ["FedEx", "UPS", "DHL Express", "Aramex"],
    gstPct: 18,
  },
  {
    key: "residential_delivery",
    label: "6. Residential Delivery Surcharge",
    when: "Home-address delivery on certain international services.",
    couriers: ["FedEx", "UPS"],
    gstPct: 18,
  },
  {
    key: "extended_area",
    label: "7. Extended Area Surcharge",
    when: "Selected postal codes or difficult delivery areas.",
    couriers: ["FedEx", "UPS", "DHL Express"],
    gstPct: 18,
  },
  {
    key: "pickup",
    label: "8. Pickup Charge",
    when: "Parcel collected from our address, where applicable.",
    couriers: ["FedEx", "UPS", "Aramex", "Delhivery", "Shiprocket"],
    gstPct: 18,
  },
  {
    key: "packaging",
    label: "9. Packaging Charge",
    when: "Box, carton, bubble wrap or packing service.",
    couriers: ["FedEx", "UPS", "Aramex", "Delhivery", "Shiprocket"],
    gstPct: 18,
  },
  {
    key: "handling",
    label: "10. Handling Charge",
    when: "Special handling or a difficult-to-process shipment.",
    couriers: ["FedEx", "UPS", "Aramex", "DHL Express"],
    gstPct: 18,
  },
  {
    key: "customs_clearance",
    label: "11. Customs Clearance Fee",
    when: "Customs clearance processing for an international shipment.",
    couriers: ["FedEx", "UPS", "Aramex", "DHL Express"],
    gstPct: 18,
  },
  {
    key: "export_documentation",
    label: "12. Export Documentation Fee",
    when: "Commercial invoice, shipping documents or export processing.",
    couriers: ["FedEx", "UPS", "Aramex", "DHL Express"],
    gstPct: 18,
  },
  {
    key: "duty_import_tax",
    label: "13. Duty / Import Tax",
    when: "Customs duty and taxes charged in the destination country.",
    couriers: ["FedEx", "UPS", "Aramex", "DHL Express"],
    gstPct: 0,
  },
  {
    key: "insurance",
    label: "14. Insurance / Shipment Protection",
    when: "Optional or applicable cover based on the declared shipment value.",
    couriers: ["FedEx", "UPS", "Aramex", "DHL Express"],
    gstPct: 18,
  },
  {
    key: "cod",
    label: "15. COD Charge",
    when: "Cash-on-Delivery shipment, where the service is available.",
    couriers: ["Delhivery", "Shiprocket", "Aramex"],
    gstPct: 18,
  },
  {
    key: "rto_return",
    label: "16. RTO / Return Charge",
    when: "Parcel not delivered and returned to us.",
    couriers: ["FedEx", "UPS", "Aramex", "Delhivery", "Shiprocket"],
    gstPct: 18,
  },
  {
    key: "address_correction",
    label: "17. Address Correction Fee",
    when: "Wrong or incomplete address had to be corrected.",
    couriers: ["FedEx", "UPS", "DHL Express"],
    gstPct: 18,
  },
  {
    key: "redelivery",
    label: "18. Re-delivery Charge",
    when: "Additional delivery attempt on certain services.",
    couriers: ["FedEx", "UPS", "Aramex"],
    gstPct: 18,
  },
  {
    key: "storage",
    label: "19. Storage / Warehousing Charge",
    when: "Parcel held at customs or in a warehouse.",
    couriers: ["FedEx", "UPS", "Aramex", "DHL Express"],
    gstPct: 18,
  },
  {
    key: "special_commodity",
    label: "20. Special Commodity Charge",
    when: "Battery, dangerous goods, temperature-sensitive or restricted items, where accepted.",
    couriers: ["FedEx", "UPS", "DHL Express"],
    gstPct: 18,
  },
  {
    key: "weight_discrepancy",
    label: "21. Weight Discrepancy Charge",
    when: "Actual or volumetric weight turns out higher after the fact.",
    couriers: ["FedEx", "UPS", "Aramex", "Delhivery", "Shiprocket"],
    gstPct: 18,
  },
  {
    key: "cancellation",
    label: "22. Cancellation / Amendment Fee",
    when: "Booking cancelled or shipment details changed, where applicable.",
    couriers: ["FedEx", "UPS", "Aramex", "Delhivery", "Shiprocket"],
    gstPct: 18,
  },
  {
    key: "other",
    label: "23. Other Charge",
    when: "Anything not covered above — describe it in the remark.",
    couriers: ["FedEx", "UPS", "Aramex", "DHL Express", "Delhivery", "Shiprocket"],
    gstPct: 18,
  },
];

export const CHARGE_HEAD_BY_KEY = new Map(SHIPPING_CHARGE_HEADS.map((h) => [h.key, h]));

// 2026-10-24 (2) — "CHARGE HEAD DROP DOWN SE AATA HAI IS SE TO HAR BAAR
// DROPDOWN SE KARNA PADEGA ... PURA A4 KA DIALOG BOX OPEN HO LANDSCAPE ME
// SABHI HEAD KA APNA COLUMN HO": the entry form's head dropdown means one
// round-trip per charge, and a courier invoice arrives with every head on
// it at once. These ten are the heads that actually appear on the FedEx /
// UPS / Aramex invoices seen so far; the grid dialog shows them as COLUMNS
// (one shipment per row), so a whole invoice is typed side by side. The
// remaining heads (residential, extended area, export docs, insurance, COD,
// address correction, re-delivery, storage, special commodity,
// cancellation) are still reachable — each row has an "Other" column and
// the existing single-charge form keeps its full dropdown.
export const CHARGE_GRID_HEADS: ChargeHead[] = [
  "base_freight",
  "fuel_surcharge",
  "remote_area",
  "pickup",
  "packaging",
  "handling",
  "customs_clearance",
  "duty_import_tax",
  "rto_return",
  "weight_discrepancy",
]
  .map((key) => CHARGE_HEAD_BY_KEY.get(key))
  .filter((h): h is ChargeHead => !!h);

/** Head key used by the grid's trailing catch-all column. */
export const CHARGE_GRID_OTHER_KEY = "other";

/** The grid's trailing catch-all column (the real "23. Other Charge" head). */
export const CHARGE_GRID_OTHER_HEAD: ChargeHead = CHARGE_HEAD_BY_KEY.get(CHARGE_GRID_OTHER_KEY) ?? {
  key: CHARGE_GRID_OTHER_KEY,
  label: "Other Charge",
  when: "Anything not covered above — describe it in the remark.",
  couriers: ["FedEx", "UPS", "Aramex", "DHL Express", "Delhivery", "Shiprocket"],
  gstPct: 18,
};

/** "1. Base Freight / Shipping Charge" → "Base Freight / Shipping Charge". */
export function chargeHeadShortLabel(key: string): string {
  return (CHARGE_HEAD_BY_KEY.get(key)?.label ?? key).replace(/^\d+\.\s*/, "");
}

export function chargeHeadLabel(key: string): string {
  return CHARGE_HEAD_BY_KEY.get(key)?.label ?? key;
}

export const CHARGE_DIRECTIONS = [
  { key: "export", label: "Export (India → abroad)" },
  { key: "return_to_india", label: "Return to India (inbound)" },
] as const;

export type ChargeDirection = (typeof CHARGE_DIRECTIONS)[number]["key"];

export function chargeDirectionLabel(key: string): string {
  return CHARGE_DIRECTIONS.find((d) => d.key === key)?.label ?? key;
}
