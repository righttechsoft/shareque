import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

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

// --- HMAC & signing helpers ---

export function hmacSign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createSignedToken(data: object, secret: string): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const signature = hmacSign(payload, secret);
  return `${payload}.${signature}`;
}

export function verifySignedToken(token: string, secret: string): object | null {
  const dotIdx = token.indexOf(".");
  if (dotIdx === -1) return null;

  const payload = token.slice(0, dotIdx);
  const signature = token.slice(dotIdx + 1);
  const expected = hmacSign(payload, secret);

  // Timing-safe comparison
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
}

export function keyVerificationHash(keyBase64Url: string): string {
  const hash = createHash("sha256").update(keyBase64Url).digest();
  return hash.subarray(0, 16).toString("base64url");
}

export function encryptCookieValue(data: object, secret: string): string {
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const plaintext = JSON.stringify(data);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, authTag, encrypted]).toString("base64url");
  const mac = hmacSign(combined, secret);
  return `${combined}.${mac}`;
}

export function decryptCookieValue(value: string, secret: string): object | null {
  const dotIdx = value.indexOf(".");
  if (dotIdx === -1) return null;

  const combined = value.slice(0, dotIdx);
  const mac = value.slice(dotIdx + 1);
  const expectedMac = hmacSign(combined, secret);

  const macBuf = Buffer.from(mac);
  const expBuf = Buffer.from(expectedMac);
  if (macBuf.length !== expBuf.length || !timingSafeEqual(macBuf, expBuf)) {
    return null;
  }

  try {
    const raw = Buffer.from(combined, "base64url");
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const key = createHash("sha256").update(secret).digest();
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString("utf-8"));
  } catch {
    return null;
  }
}
