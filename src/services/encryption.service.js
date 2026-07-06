/**
 * AES-256-GCM encryption for credentials at rest.
 * Used for: vendor API keys, social account tokens, bank credentials.
 * Key sourced from ENCRYPTION_KEY env var (must be 32 bytes hex-encoded).
 */

"use strict";

const crypto = require("crypto");
const { config } = require("../config/env");

const ALGO = "aes-256-gcm";

function getKey() {
  return Buffer.from(config.ENCRYPTION_KEY, "hex");
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

function decrypt(encoded) {
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

module.exports = { encrypt, decrypt };
