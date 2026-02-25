import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(import.meta.dir, "../.env");

let envVars: Record<string, string> = {};

if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    envVars[key] = value;
  }
  // Delete .env after reading
  try {
    unlinkSync(envPath);
    console.log("[config] .env file loaded and deleted");
  } catch {
    console.warn("[config] Could not delete .env file");
  }
}

function env(key: string, fallback?: string): string {
  return envVars[key] ?? process.env[key] ?? fallback ?? "";
}

const baseUrl = env("BASE_URL", "http://localhost:3000");
const baseUrlParsed = new URL(baseUrl);

const appSecret = env("APP_SECRET");
if (!appSecret) {
  console.error("[config] FATAL: APP_SECRET is required. Generate with: openssl rand -hex 32");
  process.exit(1);
}

export const config = {
  adminPassword: env("ADMIN_PASSWORD"),
  appSecret,
  port: parseInt(env("PORT", "3000"), 10),
  host: env("HOST", "0.0.0.0"),
  baseUrl,

  smtp: {
    host: env("SMTP_HOST"),
    port: parseInt(env("SMTP_PORT", "587"), 10),
    user: env("SMTP_USER"),
    pass: env("SMTP_PASS"),
    from: env("SMTP_FROM", "shareque@localhost"),
  },

  webauthn: {
    rpName: "Shareque",
    rpId: baseUrlParsed.hostname,
    origin: baseUrlParsed.origin,
  },

  cleanupInterval: parseInt(env("CLEANUP_INTERVAL", "5"), 10),
  maxFileSize: parseInt(env("MAX_FILE_SIZE", "100"), 10) * 1024 * 1024,
  dataDir: resolve(import.meta.dir, "../data"),
  uploadsDir: resolve(import.meta.dir, "../data/uploads"),
};
