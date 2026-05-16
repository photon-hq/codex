import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

function masterKey(): Buffer {
  const hex = process.env.MASTER_KEY;
  if (!hex) {
    throw new Error("MASTER_KEY is not set");
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("MASTER_KEY must be a 32-byte (64-char) hex string");
  }
  return Buffer.from(hex, "hex");
}

export interface EncryptedBlob {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function encrypt(plaintext: string): EncryptedBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decrypt(blob: EncryptedBlob): string {
  const decipher = createDecipheriv(ALGO, masterKey(), Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
