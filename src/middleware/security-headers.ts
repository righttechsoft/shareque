import type { Context, Next } from "hono";
import { config } from "../config";

export async function securityHeaders(c: Context, next: Next) {
  await next();

  c.header(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-XSS-Protection", "0");

  if (config.baseUrl.startsWith("https")) {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}
