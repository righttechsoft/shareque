import { randomBytes } from "node:crypto";
import { db } from "../db/connection";
import { config } from "../config";
import { encryptCookieValue, decryptCookieValue } from "../crypto/encryption";
import type { Context } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";

const SESSION_COOKIE = "sq_session";
const PREFS_COOKIE = "sq_prefs";
const SESSION_TTL = 24 * 60 * 60; // 24 hours
const PREFS_TTL = 365 * 24 * 60 * 60; // 1 year

export interface UserPreferences {
  text_use_password: number;
  text_ttl_value: number;
  text_ttl_unit: string;
  text_one_time: number;
  file_use_password: number;
  file_ttl_value: number;
  file_ttl_unit: string;
  file_one_time: number;
}

export const DEFAULT_PREFS: UserPreferences = {
  text_use_password: 0,
  text_ttl_value: 24,
  text_ttl_unit: "hours",
  text_one_time: 0,
  file_use_password: 0,
  file_ttl_value: 24,
  file_ttl_unit: "hours",
  file_one_time: 0,
};

export function getUserPreferences(c: Context): UserPreferences {
  const cookie = getCookie(c, PREFS_COOKIE);
  if (!cookie) return { ...DEFAULT_PREFS };
  const data = decryptCookieValue(cookie, config.appSecret);
  if (!data) return { ...DEFAULT_PREFS };
  return { ...DEFAULT_PREFS, ...(data as Partial<UserPreferences>) };
}

export function setUserPreferences(c: Context, prefs: UserPreferences): void {
  const value = encryptCookieValue(prefs, config.appSecret);
  setCookie(c, PREFS_COOKIE, value, {
    httpOnly: true,
    secure: c.req.url.startsWith("https"),
    sameSite: "Lax",
    path: "/",
    maxAge: PREFS_TTL,
  });
}

interface Session {
  id: string;
  user_id: string | null;
  is_admin: number;
  tfa_verified: number;
  expires_at: number;
}

export function createSession(
  userId: string | null,
  isAdmin: boolean
): string {
  const id = randomBytes(32).toString("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL;
  db.run(
    "INSERT INTO sessions (id, user_id, is_admin, tfa_verified, expires_at) VALUES (?, ?, ?, 0, ?)",
    [id, userId, isAdmin ? 1 : 0, expiresAt]
  );
  return id;
}

export function getSession(sessionId: string): Session | null {
  const now = Math.floor(Date.now() / 1000);
  return db
    .query<Session, [string, number]>(
      "SELECT * FROM sessions WHERE id = ? AND expires_at > ?"
    )
    .get(sessionId, now);
}

export function markTfaVerified(sessionId: string): void {
  db.run("UPDATE sessions SET tfa_verified = 1 WHERE id = ?", [sessionId]);
}

export function deleteSession(sessionId: string): void {
  db.run("DELETE FROM sessions WHERE id = ?", [sessionId]);
}

export function setSessionCookie(c: Context, sessionId: string): void {
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: c.req.url.startsWith("https"),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export function getSessionFromCookie(c: Context): Session | null {
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (!sessionId) return null;
  return getSession(sessionId);
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function cleanExpiredSessions(): number {
  const now = Math.floor(Date.now() / 1000);
  const result = db.run("DELETE FROM sessions WHERE expires_at <= ?", [now]);
  return result.changes;
}

export function clearManageSessions(): number {
  const result = db.run("DELETE FROM sessions WHERE is_admin = 1");
  return result.changes;
}
