import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canMergeMasterVariants,
  formatMasterSku,
  nextMasterSku,
  isMasterSku,
  isSamePhysicalVariant,
  masterSkuBase,
  normalizeIdentityValue,
  sizesAreIdentical,
  storeSkuKey,
  variantIdentityKey,
} from "./master-sku";

// 2026-11-20 — Master SKU identity. These are the rules that decide whether two
// store SKUs may share physical stock. Wrong here = wrong stock promised.

const jute4x6Natural = {
  designCode: "JUTE",
  sizeLabel: "4x6 FT",
  sizeUnit: "FT",
  colour: "Natural",
  material: "Jute",
  construction: "Hand Braided",
};

test("identical physical attributes produce the same identity", () => {
  assert.equal(
    variantIdentityKey(jute4x6Natural),
    variantIdentityKey({ ...jute4x6Natural })
  );
  assert.equal(isSamePhysicalVariant(jute4x6Natural, { ...jute4x6Natural }), true);
});

test("different sizes are different master variants", () => {
  assert.equal(
    isSamePhysicalVariant(jute4x6Natural, { ...jute4x6Natural, sizeLabel: "5x8 FT" }),
    false
  );
});

test("different colours are different master variants", () => {
  assert.equal(
    isSamePhysicalVariant(jute4x6Natural, { ...jute4x6Natural, colour: "White" }),
    false
  );
});

test("different material or construction are never merged", () => {
  assert.equal(
    isSamePhysicalVariant(jute4x6Natural, { ...jute4x6Natural, material: "Cotton" }),
    false
  );
  assert.equal(
    isSamePhysicalVariant(jute4x6Natural, { ...jute4x6Natural, construction: "Hand Tufted" }),
    false
  );
});

test("sizes are compared exactly, never converted", () => {
  // Same dimensions written identically (case/space only) match.
  assert.equal(
    sizesAreIdentical({ sizeLabel: "4x6 FT" }, { sizeLabel: " 4x6   ft " }),
    true
  );
  // A metric equivalent is NOT assumed identical.
  assert.equal(
    sizesAreIdentical(
      { sizeLabel: "4x6 FT", sizeUnit: "FT" },
      { sizeLabel: "120x180 CM", sizeUnit: "CM" }
    ),
    false
  );
});

test("unit is part of the size identity", () => {
  assert.equal(
    sizesAreIdentical({ sizeLabel: "4x6", sizeUnit: "FT" }, { sizeLabel: "4x6", sizeUnit: "CM" }),
    false
  );
});

test("master SKU base is normalised and master SKU is zero-padded", () => {
  assert.equal(masterSkuBase("NYK Jute!"), "NYK-JUTE");
  assert.equal(formatMasterSku("NYK-JUTE", 1), "NYK-JUTE-0001");
  assert.equal(formatMasterSku("NYK-JUTE", 42), "NYK-JUTE-0042");
  assert.equal(formatMasterSku("NYK-JUTE", 12345), "NYK-JUTE-12345");
});

test("master SKU format validates real values and rejects malformed ones", () => {
  for (const sku of ["NYK-JUTE-0001", "NYK-JUTE-12345", "JUTE-0001", "NYK-JUTE-0042"]) {
    assert.equal(isMasterSku(sku), true, sku);
  }
  for (const sku of ["", "NYK-JUTE", "NYK-JUTE-1", "nyk jute 0001", null]) {
    assert.equal(isMasterSku(sku), false, String(sku));
  }
});

test("store SKU keys are scoped by company and store", () => {
  assert.equal(storeSkuKey("c1", "s1", "JUTE-101"), storeSkuKey("c1", "s1", " jute-101 "));
  assert.notEqual(storeSkuKey("c1", "s1", "JUTE-101"), storeSkuKey("c1", "s2", "JUTE-101"));
  assert.notEqual(storeSkuKey("c1", "s1", "JUTE-101"), storeSkuKey("c2", "s3", "JUTE-101"));
});

test("normalisation only folds case and whitespace", () => {
  assert.equal(normalizeIdentityValue("  Natural   Jute "), "natural jute");
  assert.equal(normalizeIdentityValue(null), "");
});

// 2026-11-20c — merge safety. These mirror the SQL guards; a wrong pass here
// would let the UI submit a merge of two different physical products.

test("next Master SKU continues after the highest used number", () => {
  assert.equal(nextMasterSku("JUTE-001", []), "JUTE-001-0001");
  assert.equal(
    nextMasterSku("JUTE-001", ["JUTE-001-0001", "JUTE-001-0007", "JUTE-001-0003"]),
    "JUTE-001-0008"
  );
  // Merged/inactive SKUs are still in the list, so numbers are never reused.
  assert.equal(nextMasterSku("JUTE-001", ["JUTE-001-0002", null, "legacy"]), "JUTE-001-0003");
});

test("merge refuses different physical variants", () => {
  const base = {
    id: "a",
    masterSku: "JUTE-001-0001",
    sizeLabel: "4x6 FT",
    sizeUnit: "FT",
    colour: "Natural",
    material: "Jute",
    construction: "Hand Braided",
    active: true,
    mergedIntoId: null,
  };
  const target = { ...base, id: "b", masterSku: "JUTE-001-0002" };

  assert.equal(canMergeMasterVariants(base, target).ok, true);
  assert.equal(canMergeMasterVariants(base, { ...target, sizeLabel: "5x8 FT" }).ok, false);
  assert.equal(canMergeMasterVariants(base, { ...target, sizeUnit: "CM" }).ok, false);
  assert.equal(canMergeMasterVariants(base, { ...target, colour: "Black" }).ok, false);
  assert.equal(canMergeMasterVariants(base, { ...target, material: "Cotton" }).ok, false);
  assert.equal(canMergeMasterVariants(base, { ...target, construction: "Powerloom" }).ok, false);
});

test("merge refuses same, already-merged and inactive Master SKUs", () => {
  const base = {
    id: "a",
    masterSku: "JUTE-001-0001",
    sizeLabel: "4x6 FT",
    colour: "Natural",
    active: true,
    mergedIntoId: null,
  };
  const other = { ...base, id: "b", masterSku: "JUTE-001-0002" };

  assert.equal(canMergeMasterVariants(base, base).ok, false);
  assert.equal(canMergeMasterVariants({ ...base, mergedIntoId: "b" }, other).ok, false);
  assert.equal(canMergeMasterVariants(base, { ...other, mergedIntoId: "a" }).ok, false);
  assert.equal(canMergeMasterVariants({ ...base, active: false }, other).ok, false);
  assert.equal(canMergeMasterVariants(base, { ...other, active: false }).ok, false);
});
