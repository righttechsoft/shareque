import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

export function generateKey(): Buffer {
  return randomBytes(32);
}

export function encryptText(
  plaintext: string,
  key: Buffer
): { encrypted: Buffer; iv: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted,
    iv: iv.toString("base64url"),
    authTag: authTag.toString("base64url"),
  };
}

export function decryptText(
  encrypted: Buffer,
  key: Buffer,
  iv: string,
  authTag: string
): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf-8");
}

export function encryptFile(
  data: Buffer,
  key: Buffer
): { encrypted: Buffer; iv: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted,
    iv: iv.toString("base64url"),
    authTag: authTag.toString("base64url"),
  };
}

export function decryptFile(
  encrypted: Buffer,
  key: Buffer,
  iv: string,
  authTag: string
): Buffer {
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function keyToBase64Url(key: Buffer): string {
  return key.toString("base64url");
}

export function keyFromBase64Url(encoded: string): Buffer {
  return Buffer.from(encoded, "base64url");
}
