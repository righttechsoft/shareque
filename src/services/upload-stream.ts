import type { Context } from "hono";
import { Readable } from "node:stream";
import { maxUploadBytes } from "../config";

export type RawUpload =
  | { ok: true; source: Readable; fileName: string; fileMime: string; fields: Record<string, string>; maxBytes: number }
  | { ok: false; error: string; tooLarge?: boolean };

// The browser sends the file as the raw request body (see client.js stream upload)
export function readRawUpload(c: Context): RawUpload {
  const contentType = c.req.header("Content-Type") || "";
  if (contentType.startsWith("multipart/form-data") || contentType.startsWith("application/x-www-form-urlencoded")) {
    return { ok: false, error: "Upload requires JavaScript. Please enable it and reload the page." };
  }
  const body = c.req.raw.body;
  if (!body) return { ok: false, error: "Please select a file." };

  const maxBytes = maxUploadBytes();
  const len = parseInt(c.req.header("Content-Length") || "", 10);
  if (!isNaN(len) && len > maxBytes) return { ok: false, error: "File too large", tooLarge: true };

  let fileName = "upload";
  try {
    fileName = decodeURIComponent(c.req.header("X-File-Name") || "");
  } catch {}
  fileName = fileName.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, "") || "upload";

  const fields = Object.fromEntries(new URLSearchParams(c.req.header("X-Upload-Fields") || ""));
  return {
    ok: true,
    source: Readable.fromWeb(body as any),
    fileName,
    fileMime: contentType || "application/octet-stream",
    fields,
    maxBytes,
  };
}
