import { nanoid } from "nanoid";
import { randomBytes } from "node:crypto";
import { db } from "../db/connection";
import { config } from "../config";
import { createTextShare, createFileShare } from "./share";
import { sendUploadNotification } from "./email";

interface UploadRequestRow {
  id: string;
  token: string;
  user_id: string;
  is_consumed: number;
  expires_at: number;
}

interface UserRow {
  id: string;
  email: string;
}

export function createUploadRequest(
  userId: string,
  ttlHours: number = 48
): { id: string; token: string; url: string } {
  const id = nanoid(12);
  const token = nanoid(16);
  const expiresAt = Math.floor(Date.now() / 1000) + ttlHours * 3600;

  db.run(
    "INSERT INTO upload_requests (id, token, user_id, expires_at) VALUES (?, ?, ?, ?)",
    [id, token, userId, expiresAt]
  );

  return {
    id,
    token,
    url: `${config.baseUrl}/upload/${token}`,
  };
}

export function getUploadRequest(token: string): UploadRequestRow | null {
  const now = Math.floor(Date.now() / 1000);
  return db
    .query<UploadRequestRow, [string, number]>(
      "SELECT * FROM upload_requests WHERE token = ? AND is_consumed = 0 AND expires_at > ?"
    )
    .get(token, now);
}

export async function fulfillUploadRequest(
  token: string,
  data: { type: "text"; text: string } | { type: "file"; fileData: Buffer; fileName: string; fileMime: string; fileSize: number }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const request = getUploadRequest(token);
  if (!request) return { ok: false, error: "Upload request not found or expired" };

  // Generate a random password for the share
  const password = randomBytes(16).toString("base64url");

  let shareResult: { id: string; key: string };
  if (data.type === "text") {
    shareResult = await createTextShare({
      userId: request.user_id,
      text: data.text,
      password,
    });
  } else {
    shareResult = await createFileShare({
      userId: request.user_id,
      fileData: data.fileData,
      fileName: data.fileName,
      fileMime: data.fileMime,
      fileSize: data.fileSize,
      password,
    });
  }

  // Mark request as consumed
  db.run("UPDATE upload_requests SET is_consumed = 1 WHERE id = ?", [
    request.id,
  ]);

  // Get user email
  const user = db
    .query<UserRow, [string]>("SELECT id, email FROM users WHERE id = ?")
    .get(request.user_id);

  if (user) {
    const viewUrl = `${config.baseUrl}/view/${shareResult.id}#${shareResult.key}`;
    try {
      await sendUploadNotification(user.email, viewUrl, password);
    } catch (err) {
      console.error("[email] Failed to send upload notification:", err);
    }
  }

  return { ok: true };
}

export function cleanupExpiredRequests(): number {
  const now = Math.floor(Date.now() / 1000);
  const result = db.run(
    "DELETE FROM upload_requests WHERE expires_at <= ? OR is_consumed = 1",
    [now]
  );
  return result.changes;
}
