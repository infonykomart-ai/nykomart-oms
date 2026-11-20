// 2026-11-20 — Master SKU identity rules (pure, unit-tested).
//
// A Master SKU identifies a PHYSICAL variant, not a marketplace listing. Two
// records may share a Master SKU only when every interchangeability attribute
// matches. This module is the single definition of that comparison, used by the
// mapping screen, the order matcher and the merge tool.
//
// Deliberate rule: size is compared as the EXACT stored label/unit. There is no
// unit conversion here and no measurement-settings lookup, because a saved
// order's "4x6 FT" must never silently become "120x180 CM" or vice versa.
// Intentional conversion is a separate display calculation only.

export type PhysicalVariantAttributes = {
  /** Product design code (master product), e.g. "JUTE". */
  designCode?: string | null;
  /** Exact saved size, e.g. "4x6 FT" / "120x180 CM". */
  sizeLabel: string;
  /** Exact saved size unit, e.g. "FT" / "CM". Never converted. */
  sizeUnit?: string | null;
  colour?: string | null;
  material?: string | null;
  construction?: string | null;
};

/** Trim + collapse whitespace + case-fold. Presentation only. */
export function normalizeIdentityValue(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Stable identity key for a physical variant. Same key = interchangeable stock.
 * Different size, colour, material, construction or design = different key.
 */
export function variantIdentityKey(attributes: PhysicalVariantAttributes): string {
  return [
    attributes.designCode,
    attributes.sizeLabel,
    attributes.sizeUnit,
    attributes.colour,
    attributes.material,
    attributes.construction,
  ]
    .map((value) => normalizeIdentityValue(value ?? ""))
    .join("\u0001");
}

/** True only when every physical attribute matches exactly (normalised case). */
export function isSamePhysicalVariant(
  a: PhysicalVariantAttributes,
  b: PhysicalVariantAttributes
): boolean {
  return variantIdentityKey(a) === variantIdentityKey(b);
}

/**
 * Size equality WITHOUT conversion. "4x6 FT" and "4x6 ft" match; "4x6 FT" and
 * "120x180 CM" do not, even though they may describe a similar rug — that is a
 * human/equivalence-rule decision, never an automatic unit conversion.
 */
export function sizesAreIdentical(
  a: { sizeLabel: string; sizeUnit?: string | null },
  b: { sizeLabel: string; sizeUnit?: string | null }
): boolean {
  return (
    normalizeIdentityValue(a.sizeLabel) === normalizeIdentityValue(b.sizeLabel) &&
    normalizeIdentityValue(a.sizeUnit ?? "") === normalizeIdentityValue(b.sizeUnit ?? "")
  );
}

/** Master SKU prefix from a design/product code: "NYK Jute!" → "NYK-JUTE". */
export function masterSkuBase(code: string): string {
  const base = (code ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "MASTER";
}

/**
 * "NYK-JUTE" + 1 → "NYK-JUTE-0001". Sequence is 1-based; padding grows beyond
 * four digits rather than truncating.
 */
export function formatMasterSku(baseOrCode: string, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence <= 0) {
    throw new Error("Master SKU sequence must be a positive integer.");
  }
  const digits = String(sequence);
  return `${masterSkuBase(baseOrCode)}-${digits.padStart(Math.max(4, digits.length), "0")}`;
}

/** Shape check for a stored Master SKU (prefix groups + 4+ digit sequence). */
export function isMasterSku(value: string | null | undefined): boolean {
  return /^[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{4,}$/.test((value ?? "").trim().toUpperCase());
}

/**
 * Store-SKU uniqueness key. A store SKU is unique within a store, and the same
 * text in two stores (or two companies) is a different mapping.
 */
export function storeSkuKey(companyId: string, storeId: string, storeSku: string): string {
  return [companyId, storeId, storeSku]
    .map((value) => normalizeIdentityValue(value))
    .join("\u0001");
}

/**
 * Next free Master SKU for a base, given the SKUs already used by that master
 * product. Never reuses a number (including merged/inactive SKUs).
 */
export function nextMasterSku(base: string, existingSkus: readonly (string | null | undefined)[]): string {
  let highest = 0;
  for (const sku of existingSkus) {
    const match = /-(\d+)\s*$/.exec((sku ?? "").trim());
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > highest) highest = value;
  }
  return formatMasterSku(base, highest + 1);
}

export type MergeCandidate = PhysicalVariantAttributes & {
  id: string;
  masterSku: string;
  active?: boolean;
  mergedIntoId?: string | null;
};

/**
 * UI-side pre-check for a merge. The database function re-checks everything
 * atomically; this exists to show a clear message before submitting.
 */
export function canMergeMasterVariants(
  source: MergeCandidate,
  target: MergeCandidate
): { ok: true } | { ok: false; reason: string } {
  if (source.id === target.id) return { ok: false, reason: "Source and target Master SKU must be different." };
  if (source.mergedIntoId) return { ok: false, reason: `${source.masterSku} is already merged.` };
  if (target.mergedIntoId) return { ok: false, reason: `${target.masterSku} is itself merged.` };
  if (source.active === false || target.active === false) {
    return { ok: false, reason: "Both Master SKUs must be active to merge." };
  }
  if (
    normalizeIdentityValue(source.sizeLabel) !== normalizeIdentityValue(target.sizeLabel) ||
    normalizeIdentityValue(source.sizeUnit ?? "") !== normalizeIdentityValue(target.sizeUnit ?? "") ||
    normalizeIdentityValue(source.colour ?? "") !== normalizeIdentityValue(target.colour ?? "")
  ) {
    return { ok: false, reason: "These Master SKUs differ in size or colour." };
  }
  if (
    normalizeIdentityValue(source.material ?? "") !== normalizeIdentityValue(target.material ?? "") ||
    normalizeIdentityValue(source.construction ?? "") !== normalizeIdentityValue(target.construction ?? "")
  ) {
    return { ok: false, reason: "The master products differ in material or construction." };
  }
  return { ok: true };
}
