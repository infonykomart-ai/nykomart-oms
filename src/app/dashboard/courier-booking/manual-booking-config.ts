// 2026-09-05 — pulled out of manual-booking-actions.ts (a "use server"
// file). Next.js requires every export of a "use server" module to be an
// async function — MANUAL_BOOKING_COURIERS (a plain array) and
// ManualBookingCourierChoice (a type) broke that rule the moment
// create-shipment-form.tsx (a client component) imported them directly
// from that file, which crashed the WHOLE /dashboard/courier-booking page
// with "Error: A 'use server' file can only export async functions, found
// object." (confirmed live in Vercel's runtime logs — 3 occurrences,
// SEP 05 12:36–12:38, all 500s on /dashboard/courier-booking).
//
// Fix: this plain data/type module has no "use server" directive, so both
// the server file (manual-booking-actions.ts, which still needs the type
// for its own form-parsing logic) and the client form component
// (create-shipment-form.tsx, which needs the dropdown list) import from
// here instead of from each other.
export type ManualBookingCourierChoice = "fedex" | "ups" | "aramex" | "delhivery" | "shiprocket" | "dhl" | "other";

export const MANUAL_BOOKING_COURIERS: { value: ManualBookingCourierChoice; label: string }[] = [
  { value: "fedex", label: "FedEx" },
  { value: "ups", label: "UPS" },
  { value: "aramex", label: "Aramex" },
  { value: "delhivery", label: "Delhivery" },
  { value: "shiprocket", label: "Shiprocket" },
  { value: "dhl", label: "DHL" },
  { value: "other", label: "Other (type the name)" },
];
