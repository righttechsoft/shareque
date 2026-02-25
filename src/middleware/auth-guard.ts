import type { Context, Next } from "hono";
import { getSessionFromCookie } from "../auth/session";

export async function authGuard(c: Context, next: Next) {
  const session = getSessionFromCookie(c);
  if (!session || session.is_admin) {
    return c.redirect("/login");
  }
  if (!session.tfa_verified) {
    return c.redirect("/verify-2fa");
  }
  c.set("session", session);
  c.set("userId", session.user_id);
  await next();
}

export async function sessionGuard(c: Context, next: Next) {
  const session = getSessionFromCookie(c);
  if (!session || session.is_admin) {
    return c.redirect("/login");
  }
  c.set("session", session);
  if (session.user_id) c.set("userId", session.user_id);
  await next();
}
