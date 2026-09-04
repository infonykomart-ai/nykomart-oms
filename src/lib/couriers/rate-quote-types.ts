// Shared input/output shape for the "compare all couriers' rates before
// booking" feature (2026-09-03) — see rate-compare-actions.ts for the
// Server Action that calls all 6 of these in parallel, and each courier's
// own *-rate.ts for the vendor-specific client. Deliberately the SAME
// "one server-side shape, courier-specific clients" pattern the booking
// clients (*-ship.ts) already use — see BRAIN.md §4's note on this.
//
// This is a QUOTE-ONLY call — it must NEVER create a real shipment/AWB.
// Every *-rate.ts file calls a courier's dedicated rating/serviceability
// endpoint, separate from the shipment-creation endpoint *-ship.ts calls.

export type RateQuoteInput = {
  originPostalCode: string;
  originCountryCode: string;
  destPostalCode: string;
  destCountryCode: string;
  weightKg: number;
};

export type RateQuoteResult =
  | { ok: true; amount: number; currency: string }
  | { ok: false; error: string };
