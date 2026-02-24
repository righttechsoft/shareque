import { randomBytes } from "node:crypto";
import { db } from "../db/connection";
import type { Context } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";

const SESSION_COOKIE = "sq_session";
const SESSION_TTL = 24 * 60 * 60; // 24 hours

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
