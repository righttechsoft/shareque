import type { Context, Next } from "hono";
import { getSessionFromCookie } from "../auth/session";
import { db } from "../db/connection";

interface ManageConfig {
  tfa_setup_complete: number;
}

export async function manageGuard(c: Context, next: Next) {
  const session = getSessionFromCookie(c);
  if (!session || !session.is_admin) {
    return c.redirect("/manage/login");
  }
  if (!session.tfa_verified) {
    const cfg = db
      .query<ManageConfig, []>("SELECT tfa_setup_complete FROM admin_config WHERE id = 1")
      .get();
    if (!cfg?.tfa_setup_complete) {
      return c.redirect("/manage/setup-2fa");
    }
    return c.redirect("/manage/verify-2fa");
  }
  c.set("session", session);
  await next();
}

export async function manageSessionGuard(c: Context, next: Next) {
  const session = getSessionFromCookie(c);
  if (!session || !session.is_admin) {
    return c.redirect("/manage/login");
  }
  c.set("session", session);
  await next();
}
