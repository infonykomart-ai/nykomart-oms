// Pure availability arithmetic for the Phase 4 order-entry badge. Kept apart
// from order-stock.ts (which imports the server-only Supabase client) so it
// can be unit-tested with plain node:test.

export type AvailabilitySummary = {
  readyPcs: number;
  readySqft: number;
  reservedPcs: number;
  reservedSqft: number;
  availablePcs: number;
  availableSqft: number;
  requestedPcs: number;
  shortfallPcs: number;
  enough: boolean;
};

const clean = (value: number) => (Number.isFinite(value) ? Math.max(value, 0) : 0);

/**
 * READY minus reservations, never below zero, plus what the order still needs.
 * `requestedPcs` of 0 (nothing typed yet) never reports a shortage.
 */
export function summarizeAvailability(input: {
  readyPcs: number;
  readySqft: number;
  reservedPcs: number;
  reservedSqft: number;
  requestedPcs: number;
}): AvailabilitySummary {
  const readyPcs = clean(input.readyPcs);
  const readySqft = clean(input.readySqft);
  const reservedPcs = clean(input.reservedPcs);
  const reservedSqft = clean(input.reservedSqft);
  const availablePcs = Math.max(readyPcs - reservedPcs, 0);
  const availableSqft = Math.max(readySqft - reservedSqft, 0);
  const requestedPcs = clean(input.requestedPcs);
  const shortfallPcs = Math.max(requestedPcs - availablePcs, 0);

  return {
    readyPcs,
    readySqft,
    reservedPcs,
    reservedSqft,
    availablePcs,
    availableSqft,
    requestedPcs,
    shortfallPcs,
    enough: requestedPcs === 0 || shortfallPcs === 0,
  };
}
