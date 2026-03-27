import { nanoid } from "nanoid";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync, rmdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { db } from "../db/connection";
import { encryptText, decryptText, encryptFile, decryptFile } from "../crypto/encryption";
import { config } from "../config";

interface StoredDataRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  encrypted_data: Buffer | null;
  file_path: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  iv: string;
  auth_tag: string;
  created_at: number;
  updated_at: number;
}

export interface StoredDataListItem {
  id: string;
  type: string;
  title: string;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  created_at: number;
  updated_at: number;
}

function userStoredDir(userId: string): string {
  return resolve(config.storedDir, userId);
}

export function createNote(opts: {
  userId: string;
  title: string;
  content: string;
  userToken: Buffer;
}): string {
  const id = nanoid(12);
  const { encrypted, iv, authTag } = encryptText(opts.content, opts.userToken);
  db.run(
    `INSERT INTO stored_data (id, user_id, type, title, encrypted_data, iv, auth_tag)
     VALUES (?, ?, 'note', ?, ?, ?, ?)`,
    [id, opts.userId, opts.title, encrypted, iv, authTag]
  );
  return id;
}

export function createStoredFile(opts: {
  userId: string;
  title: string;
  fileData: Buffer;
  fileName: string;
  fileMime: string;
  fileSize: number;
  userToken: Buffer;
}): string {
  const id = nanoid(12);
  const { encrypted, iv, authTag } = encryptFile(opts.fileData, opts.userToken);

  const dir = userStoredDir(opts.userId);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${id}.enc`);
  writeFileSync(filePath, encrypted);

  db.run(
    `INSERT INTO stored_data (id, user_id, type, title, file_path, file_name, file_mime, file_size, iv, auth_tag)
     VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?, ?)`,
    [id, opts.userId, opts.title, filePath, opts.fileName, opts.fileMime, opts.fileSize, iv, authTag]
  );
  return id;
}

export function listStoredData(userId: string): StoredDataListItem[] {
  return db
    .query<StoredDataListItem, [string]>(
      `SELECT id, type, title, file_name, file_mime, file_size, created_at, updated_at
       FROM stored_data WHERE user_id = ? ORDER BY updated_at DESC`
    )
    .all(userId);
}

export function getNote(
  id: string,
  userId: string,
  userToken: Buffer
): { title: string; content: string } | null {
  const row = db
    .query<StoredDataRow, [string, string]>(
      "SELECT * FROM stored_data WHERE id = ? AND user_id = ? AND type = 'note'"
    )
    .get(id, userId);
  if (!row || !row.encrypted_data) return null;
  const content = decryptText(row.encrypted_data, userToken, row.iv, row.auth_tag);
  return { title: row.title, content };
}

export function getStoredFile(
  id: string,
  userId: string,
  userToken: Buffer
): { title: string; fileData: Buffer; fileName: string; fileMime: string; fileSize: number } | null {
  const row = db
    .query<StoredDataRow, [string, string]>(
      "SELECT * FROM stored_data WHERE id = ? AND user_id = ? AND type = 'file'"
    )
    .get(id, userId);
  if (!row || !row.file_path || !row.file_name) return null;

  const absPath = resolve(row.file_path);
  if (!absPath.startsWith(resolve(config.storedDir))) return null;
  if (!existsSync(absPath)) return null;

  const encrypted = readFileSync(absPath);
  const fileData = decryptFile(encrypted, userToken, row.iv, row.auth_tag);
  return {
    title: row.title,
    fileData,
    fileName: row.file_name,
    fileMime: row.file_mime || "application/octet-stream",
    fileSize: row.file_size || fileData.length,
  };
}

export function updateNote(
  id: string,
  userId: string,
  title: string,
  content: string,
  userToken: Buffer
): boolean {
  const row = db
    .query<StoredDataRow, [string, string]>(
      "SELECT id FROM stored_data WHERE id = ? AND user_id = ? AND type = 'note'"
    )
    .get(id, userId);
  if (!row) return false;

  const { encrypted, iv, authTag } = encryptText(content, userToken);
  db.run(
    `UPDATE stored_data SET title = ?, encrypted_data = ?, iv = ?, auth_tag = ?, updated_at = unixepoch()
     WHERE id = ?`,
    [title, encrypted, iv, authTag, id]
  );
  return true;
}

export function deleteStoredItem(id: string, userId: string): boolean {
  const row = db
    .query<StoredDataRow, [string, string]>(
      "SELECT * FROM stored_data WHERE id = ? AND user_id = ?"
    )
    .get(id, userId);
  if (!row) return false;

  if (row.type === "file" && row.file_path) {
    const absPath = resolve(row.file_path);
    if (absPath.startsWith(resolve(config.storedDir)) && existsSync(absPath)) {
      unlinkSync(absPath);
    }
  }

  db.run("DELETE FROM stored_data WHERE id = ?", [id]);
  return true;
}

export function cleanupUserStoredFiles(userId: string): void {
  const rows = db
    .query<{ file_path: string }, [string]>(
      "SELECT file_path FROM stored_data WHERE user_id = ? AND type = 'file' AND file_path IS NOT NULL"
    )
    .all(userId);

  for (const row of rows) {
    const absPath = resolve(row.file_path);
    if (absPath.startsWith(resolve(config.storedDir)) && existsSync(absPath)) {
      unlinkSync(absPath);
    }
  }

  // Remove user directory if empty
  const dir = userStoredDir(userId);
  if (existsSync(dir)) {
    try {
      const remaining = readdirSync(dir);
      if (remaining.length === 0) rmdirSync(dir);
    } catch { /* ignore */ }
  }
}
