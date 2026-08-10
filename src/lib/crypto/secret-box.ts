// Symmetric encryption for values that must be stored in the DB but never
// in plain text (marketplace API keys/secrets, courier API keys). Uses
// Node's built-in crypto — no extra dependency.
//
// Storage format written to a `bytea` column: iv(12 bytes) || authTag(16
// bytes) || ciphertext, all concatenated, base64-encoded when passed
// to Supabase (the JS client handles bytea as a hex/base64 string
// depending on driver — always go through toStorage()/fromStorage()
// below rather than handling the buffer yourself).
//
// Setup (one time): generate a key and put it in .env.local /
// Vercel env vars, NEVER commit it:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// -> ENCRYPTION_KEY=<output>

import crypto from "crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const b64 = process.env.ENCRYPTION_KEY;
  if (!b64) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with: " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
    );
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).");
  }
  return key;
}

/** Encrypt a plaintext secret. Returns a value ready to store in a `bytea` column. */
export function encryptSecret(plaintext: string): Buffer {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

/** Decrypt a value previously produced by encryptSecret(). */
export function decryptSecret(stored: Buffer): string {
  const key = getKey();
  const iv = stored.subarray(0, 12);
  const authTag = stored.subarray(12, 28);
  const ciphertext = stored.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
