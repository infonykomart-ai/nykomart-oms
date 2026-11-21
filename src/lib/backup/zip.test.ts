import assert from "node:assert/strict";
import test from "node:test";
import { buildZip, crc32 } from "./zip";

/** Reads the archive's own central directory, so the test checks the bytes a
 *  real unzip tool reads — not just an in-memory assumption. */
function readCentralDirectory(zip: Buffer) {
  const eocdOffset = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocdOffset), 0x06054b50, "missing end-of-central-directory record");
  const count = zip.readUInt16LE(eocdOffset + 10);
  const size = zip.readUInt32LE(eocdOffset + 12);
  const offset = zip.readUInt32LE(eocdOffset + 16);
  assert.equal(offset + size, eocdOffset, "central directory size/offset do not reach the EOCD");

  const entries: Array<{ name: string; data: Buffer; crc: number }> = [];
  let cursor = offset;
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50, "bad central directory entry signature");
    const crc = zip.readUInt32LE(cursor + 16);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const uncompressedSize = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");

    assert.equal(zip.readUInt32LE(localOffset), 0x04034b50, `bad local header for ${name}`);
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({ name, crc, data: zip.subarray(dataStart, dataStart + uncompressedSize) });
    assert.equal(compressedSize, uncompressedSize, "STORE entries must not change size");
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test("zip archive is readable and keeps every file's bytes", () => {
  const files = [
    { name: "00-Summary.xlsx", data: Buffer.from("summary-bytes") },
    { name: "Orders.xlsx", data: Buffer.from("order-bytes".repeat(100)) },
    { name: "Other.xlsx", data: Buffer.alloc(0) },
  ];
  const zip = buildZip(files, new Date("2026-11-21T10:00:00Z"));
  const entries = readCentralDirectory(zip);

  assert.deepEqual(entries.map((e) => e.name), files.map((f) => f.name));
  for (let i = 0; i < files.length; i++) {
    assert.equal(entries[i].data.toString("utf8"), files[i].data.toString("utf8"));
    assert.equal(entries[i].crc, crc32(files[i].data));
  }
});

test("crc32 matches the standard check value", () => {
  // The canonical CRC-32 of "123456789" is 0xCBF43926.
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("unsafe or empty archives are refused", () => {
  assert.throws(() => buildZip([]), /empty/);
  assert.throws(() => buildZip([{ name: "../escape.xlsx", data: Buffer.from("x") }]), /Invalid file name/);
});
