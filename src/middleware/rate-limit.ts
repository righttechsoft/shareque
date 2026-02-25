import type { Context, Next } from "hono";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  max: number;
  windowMs: number;
}

const limiters = new Map<string, Map<string, RateLimitEntry>>();

// Periodic cleanup every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [, store] of limiters) {
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }
}, 60_000);

function getClientIp(c: Context): string {
  return (
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
    c.req.header("X-Real-IP") ||
    "unknown"
  );
}

export function rateLimit(name: string, opts: RateLimitOptions) {
  if (!limiters.has(name)) {
    limiters.set(name, new Map());
  }
  const store = limiters.get(name)!;

  return async (c: Context, next: Next) => {
    const ip = getClientIp(c);
    const now = Date.now();
    const entry = store.get(ip);

    if (entry && entry.resetAt > now) {
      if (entry.count >= opts.max) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        c.header("Retry-After", retryAfter.toString());
        return c.json({ error: "Too many requests" }, 429);
      }
      entry.count++;
    } else {
      store.set(ip, { count: 1, resetAt: now + opts.windowMs });
    }

    return next();
  };
}
