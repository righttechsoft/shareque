import type { Context, Next } from "hono";
import { config } from "../config";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function csrfProtection(c: Context, next: Next) {
  if (SAFE_METHODS.has(c.req.method)) {
    return next();
  }

  const expectedOrigin = new URL(config.baseUrl).origin;

  const origin = c.req.header("Origin");
  if (origin) {
    if (origin !== expectedOrigin) {
      return c.json({ error: "CSRF: origin mismatch" }, 403);
    }
    return next();
  }

  const referer = c.req.header("Referer");
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (refOrigin !== expectedOrigin) {
        return c.json({ error: "CSRF: referer mismatch" }, 403);
      }
      return next();
    } catch {
      return c.json({ error: "CSRF: invalid referer" }, 403);
    }
  }

  // No Origin or Referer — only allow JSON content type (blocks cross-origin form submissions)
  const contentType = c.req.header("Content-Type") || "";
  if (contentType.includes("application/json")) {
    return next();
  }

  return c.json({ error: "CSRF: missing origin" }, 403);
}
