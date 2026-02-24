import { nanoid } from "nanoid";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { db } from "../db/connection";
import {
  generateKey,
  encryptText,
  decryptText,
  encryptFile,
  decryptFile,
  keyToBase64Url,
  keyFromBase64Url,
} from "../crypto/encryption";
import { config } from "../config";

interface ShareRow {
  id: string;
  user_id: string;
  type: string;
  encrypted_data: Buffer | null;
  file_path: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  iv: string;
  auth_tag: string;
  encryption_key: string;
  password_hash: string | null;
  has_password: number;
  max_views: number | null;
  view_count: number;
  is_consumed: number;
  expires_at: number | null;
  created_at: number;
}

interface CreateTextOptions {
  userId: string;
  text: string;
  password?: string;
  maxViews?: number;
  expiresAt?: number;
}

interface CreateFileOptions {
  userId: string;
  fileData: Buffer;
  fileName: string;
  fileMime: string;
  fileSize: number;
  password?: string;
  maxViews?: number;
  expiresAt?: number;
}

export async function createTextShare(opts: CreateTextOptions) {
  const id = nanoid(12);
  const key = generateKey();
  const { encrypted, iv, authTag } = encryptText(opts.text, key);

  let passwordHash: string | null = null;
  if (opts.password) {
    passwordHash = await Bun.password.hash(opts.password);
  }

  db.run(
    `INSERT INTO shares (id, user_id, type, encrypted_data, iv, auth_tag, encryption_key, password_hash, has_password, max_views, expires_at)
     VALUES (?, ?, 'text', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.userId,
      encrypted,
      iv,
      authTag,
      keyToBase64Url(key),
      passwordHash,
      opts.password ? 1 : 0,
      opts.maxViews ?? null,
      opts.expiresAt ?? null,
    ]
  );

  return { id, key: keyToBase64Url(key) };
}

export async function createFileShare(opts: CreateFileOptions) {
  const id = nanoid(12);
  const key = generateKey();
  const { encrypted, iv, authTag } = encryptFile(opts.fileData, key);

  const now = new Date();
  const monthDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const uploadDir = `${config.uploadsDir}/${monthDir}`;
  mkdirSync(uploadDir, { recursive: true });

  const filePath = `${uploadDir}/${id}.enc`;
  writeFileSync(filePath, encrypted);

  let passwordHash: string | null = null;
  if (opts.password) {
    passwordHash = await Bun.password.hash(opts.password);
  }

  db.run(
    `INSERT INTO shares (id, user_id, type, file_path, file_name, file_mime, file_size, iv, auth_tag, encryption_key, password_hash, has_password, max_views, expires_at)
     VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.userId,
      filePath,
      opts.fileName,
      opts.fileMime,
      opts.fileSize,
      iv,
      authTag,
      keyToBase64Url(key),
      passwordHash,
      opts.password ? 1 : 0,
      opts.maxViews ?? null,
      opts.expiresAt ?? null,
    ]
  );

  return { id, key: keyToBase64Url(key) };
}

export function getShareMeta(id: string): ShareRow | null {
  return db
    .query<ShareRow, [string]>("SELECT * FROM shares WHERE id = ?")
    .get(id);
}

export async function viewShare(
  id: string,
  encryptionKey: string,
  password?: string
): Promise<
  | { ok: true; type: string; content?: string; fileData?: Buffer; fileName?: string; fileMime?: string; fileSize?: number }
  | { ok: false; error: string }
> {
  const share = db
    .query<ShareRow, [string, number]>(
      "SELECT * FROM shares WHERE id = ? AND is_consumed = 0 AND (expires_at IS NULL OR expires_at > ?)"
    )
    .get(id, Math.floor(Date.now() / 1000));

  if (!share) return { ok: false, error: "Share not found or expired" };

  // Verify password if needed
  if (share.has_password) {
    if (!password) return { ok: false, error: "password_required" };
    const valid = await Bun.password.verify(password, share.password_hash!);
    if (!valid) return { ok: false, error: "Invalid password" };
  }

  // Check and increment view count atomically
  if (share.max_views) {
    const result = db
      .query<ShareRow, [string]>(
        `UPDATE shares
         SET view_count = view_count + 1,
             is_consumed = CASE WHEN view_count + 1 >= max_views THEN 1 ELSE 0 END
         WHERE id = ? AND is_consumed = 0
         RETURNING *`
      )
      .get(id);
    if (!result) return { ok: false, error: "Share has been consumed" };
  } else {
    db.run("UPDATE shares SET view_count = view_count + 1 WHERE id = ?", [id]);
  }

  const key = keyFromBase64Url(encryptionKey);

  if (share.type === "text") {
    const content = decryptText(
      share.encrypted_data as Buffer,
      key,
      share.iv,
      share.auth_tag
    );
    return { ok: true, type: "text", content };
  }

  // File
  if (!share.file_path || !existsSync(share.file_path)) {
    return { ok: false, error: "File not found" };
  }
  const encryptedFile = readFileSync(share.file_path);
  const fileData = decryptFile(encryptedFile, key, share.iv, share.auth_tag);
  return {
    ok: true,
    type: "file",
    fileData,
    fileName: share.file_name!,
    fileMime: share.file_mime!,
    fileSize: share.file_size!,
  };
}

export function deleteShare(id: string): boolean {
  const share = db
    .query<ShareRow, [string]>("SELECT * FROM shares WHERE id = ?")
    .get(id);
  if (!share) return false;

  if (share.file_path && existsSync(share.file_path)) {
    try {
      unlinkSync(share.file_path);
    } catch {}
  }

  db.run("DELETE FROM shares WHERE id = ?", [id]);
  return true;
}

export function cleanupExpiredShares(): number {
  const now = Math.floor(Date.now() / 1000);
  const expired = db
    .query<ShareRow, [number]>(
      "SELECT * FROM shares WHERE (expires_at IS NOT NULL AND expires_at <= ?) OR is_consumed = 1"
    )
    .all(now);

  for (const share of expired) {
    if (share.file_path && existsSync(share.file_path)) {
      try {
        unlinkSync(share.file_path);
      } catch {}
    }
  }

  const result = db.run(
    "DELETE FROM shares WHERE (expires_at IS NOT NULL AND expires_at <= ?) OR is_consumed = 1",
    [now]
  );
  return result.changes;
}
