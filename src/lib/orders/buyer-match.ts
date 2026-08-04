// Shared "is this the same buyer" key used by two business rules documented
// at the top of db/schema.sql: BUYER-BATCH SUFFIX and DUPLICATE-DISPATCHED-
// ORDER REUSE. Both match "same buyer" the same way — contact_no with
// non-digits stripped, falling back to buyer_name_address trimmed/lowercased
// only when contact_no is blank. Kept as one function so both rules can
// never quietly drift apart.
export function buyerMatchKey(
  contactNo: string | null | undefined,
  buyerNameAddress: string | null | undefined
): string {
  const digits = (contactNo ?? "").replace(/\D/g, "");
  if (digits) return `phone:${digits}`;
  return `name:${(buyerNameAddress ?? "").trim().toLowerCase()}`;
}
