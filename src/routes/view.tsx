import { Hono } from "hono";
import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import { getShareMeta, viewShare, deleteShare } from "../services/share";
import { verifySignedToken, keyVerificationHash, keyFromBase64Url, decryptText, decryptFileStream, decryptFileRange, encryptCookieValue, decryptCookieValue } from "../crypto/encryption";
import { setCookie, getCookie } from "hono/cookie";
import { getSessionFromCookie, getUserTokenFromSession } from "../auth/session";
import { createNote, createStoredFile } from "../services/stored-data";
import { config, maxUploadBytes } from "../config";
import { MinimalLayout } from "../views/layout";

const view = new Hono();

const STREAM_SLICE = 4 * 1024 * 1024;

function isStreamable(share: { type: string; max_views: number | null; file_mime: string | null }): boolean {
  return share.type === "file" && !share.max_views && /^(video|audio)\//.test(share.file_mime || "");
}

function safeJsonEmbed(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function sanitizeFilename(name: string): string {
  // Strip control characters
  const cleaned = name.replace(/[\x00-\x1f\x7f]/g, "");
  // RFC 5987 encoding for Content-Disposition
  return encodeURIComponent(cleaned).replace(/['()]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase());
}

// View page shell - JS will read fragment and POST for content
view.get("/:id", (c) => {
  const id = c.req.param("id");
  const share = getShareMeta(id);

  if (!share || share.is_consumed) {
    return c.html(
      <MinimalLayout title="Not Found">
        <div class="text-center" style="margin-top:4rem">
          <h2>Share Not Found</h2>
          <p class="text-muted">This share may have expired, been deleted, or already viewed.</p>
        </div>
      </MinimalLayout>,
      404
    );
  }

  const expired =
    share.expires_at && share.expires_at <= Math.floor(Date.now() / 1000);
  if (expired) {
    return c.html(
      <MinimalLayout title="Expired">
        <div class="text-center" style="margin-top:4rem">
          <h2>Share Expired</h2>
          <p class="text-muted">This share has expired and is no longer available.</p>
        </div>
      </MinimalLayout>,
      410
    );
  }

  // Check if viewer is a logged-in user with encryption token
  let canSave = false;
  const session = getSessionFromCookie(c);
  if (session && !session.is_admin && session.tfa_verified && session.user_id) {
    const userToken = getUserTokenFromSession(session);
    if (userToken) canSave = true;
  }

  return c.html(
    <MinimalLayout title="View Share">
      <div id="view-container" style="margin-top:2rem">
        <div class="view-header">
          <h2>Shared {share.type === "file" ? "File" : "Text"}</h2>
          <div id="delete-btn-area" style="display:none"></div>
        </div>

        {share.type === "file" && share.file_name && (
          <div class="file-info">
            <strong>{share.file_name}</strong> ({formatSize(share.file_size || 0)})
          </div>
        )}

        {share.has_password ? (
          <div id="password-prompt" class="password-prompt">
            <p>This share is password protected.</p>
            <label>
              Password
              <input type="text" id="sq-unlock" class="input-secret" autocomplete="off" autofocus />
            </label>
            <button type="button" id="submit-password">Unlock</button>
            <div id="password-error" class="alert alert-error" style="display:none"></div>
          </div>
        ) : null}

        <div id="content-area" style={share.has_password ? "display:none" : ""}>
          <div class="loading" id="loading-indicator">Decrypting...</div>
        </div>

        <div class="actions" id="content-actions" style="display:none">
          <button type="button" id="copy-content-btn" class="outline">Copy to Clipboard</button>
        </div>
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `
          window.__shareContext = {
            id: ${safeJsonEmbed(id)},
            type: ${safeJsonEmbed(share.type)},
            hasPassword: ${share.has_password ? "true" : "false"},
            fileName: ${share.file_name ? safeJsonEmbed(share.file_name) : "null"},
            fileMime: ${share.file_mime ? safeJsonEmbed(share.file_mime) : "null"},
            fileSize: ${share.file_size || 0},
            canStream: ${isStreamable(share) ? "true" : "false"},
            canSave: ${canSave ? "true" : "false"}
          };
        `,
        }}
      />
    </MinimalLayout>
  );
});

// POST content - decrypt and return (JSON body from fetch, or form body for streamed downloads)
view.post("/:id/content", async (c) => {
  const id = c.req.param("id");

  const isForm = (c.req.header("Content-Type") || "").startsWith("application/x-www-form-urlencoded");
  const fail = (error: string, status: number) =>
    isForm
      ? c.html(
          <MinimalLayout title="Error">
            <div class="text-center" style="margin-top:4rem">
              <div class="alert alert-error">{error === "password_required" ? "Password required" : error}</div>
              <a href="javascript:history.back()">Back</a>
            </div>
          </MinimalLayout>,
          status as any
        )
      : c.json({ error }, status as any);

  let body: any;
  try {
    body = isForm ? await c.req.parseBody() : await c.req.json();
  } catch {
    return fail("Invalid request", 400);
  }

  const { key, password, passwordToken } = body;
  if (!key) return fail("Encryption key required", 400);

  const wantTicket = !isForm && body.ticket === true;
  if (wantTicket) {
    const meta = getShareMeta(id);
    if (!meta || !isStreamable(meta)) return c.json({ error: "Streaming not available" }, 400);
  }

  const result = await viewShare(id, key, password, passwordToken);

  if (!result.ok) {
    return fail(result.error, result.error === "password_required" ? 401 : 400);
  }

  if (wantTicket) {
    // Stream ticket: encrypted HttpOnly cookie holding the share key, used by GET /view/:id/stream
    result.fileStream?.destroy();
    const meta = getShareMeta(id)!;
    const now = Math.floor(Date.now() / 1000);
    const exp = Math.min(now + 6 * 3600, meta.expires_at ?? Infinity);
    setCookie(c, `sq_stream_${id}`, encryptCookieValue({ id, k: key, exp }, config.appSecret), {
      httpOnly: true,
      secure: config.baseUrl.startsWith("https"),
      sameSite: "Strict",
      path: `/view/${id}/stream`,
      maxAge: exp - now,
    });
    return c.json({ type: "stream" });
  }

  if (result.type === "text") {
    return c.json({ type: "text", content: result.content });
  }

  // File - stream as binary with metadata headers
  // Sanitize filename for Content-Disposition
  const safeName = sanitizeFilename(result.fileName || "download");
  const headers: Record<string, string> = {
    "Content-Type": result.fileMime || "application/octet-stream",
    "Content-Disposition": `${isForm ? "attachment" : "inline"}; filename*=UTF-8''${safeName}`,
    "X-File-Name": result.fileName || "download",
    "X-File-Mime": result.fileMime || "application/octet-stream",
  };
  if (result.fileSize) headers["Content-Length"] = String(result.fileSize);
  return new Response(Readable.toWeb(result.fileStream!) as any, { headers });
});

// GET stream - Range-capable playback of video/audio shares, authorized by the ticket cookie
view.get("/:id/stream", (c) => {
  const id = c.req.param("id");
  const cookie = getCookie(c, `sq_stream_${id}`);
  const t = cookie ? (decryptCookieValue(cookie, config.appSecret) as { id: string; k: string; exp: number } | null) : null;
  const now = Math.floor(Date.now() / 1000);
  if (!t || t.id !== id || t.exp <= now) return c.text("Forbidden", 403);

  const share = getShareMeta(id);
  if (
    !share || share.type !== "file" || share.is_consumed ||
    (share.expires_at && share.expires_at <= now) ||
    !share.file_path || !existsSync(share.file_path) ||
    keyVerificationHash(t.k) !== share.key_verification
  ) {
    return c.text("Not found", 404);
  }

  const size = share.file_size || 0;
  const key = keyFromBase64Url(t.k);
  const base: Record<string, string> = {
    "Content-Type": share.file_mime || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };

  const m = /^bytes=(\d*)-(\d*)$/.exec(c.req.header("Range") || "");
  if (!m || (m[1] === "" && m[2] === "")) {
    base["Content-Length"] = String(size);
    return new Response(Readable.toWeb(decryptFileStream(share.file_path, key, share.iv, share.auth_tag)) as any, { headers: base });
  }

  let start: number;
  let end: number;
  if (m[1] === "") {
    // suffix range: last N bytes
    start = Math.max(0, size - parseInt(m[2], 10));
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === "" ? size - 1 : parseInt(m[2], 10);
  }
  if (start >= size || end < start) {
    return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
  }
  end = Math.min(end, size - 1, start + STREAM_SLICE - 1);

  const body = decryptFileRange(share.file_path, key, share.iv, start, end);
  return new Response(body as any, {
    status: 206,
    headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(body.length) },
  });
});

// POST delete - always JSON-based, requires encryption key
view.post("/:id/delete", async (c) => {
  const id = c.req.param("id");

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request" }, 400);
  }

  const { key, password, passwordToken } = body;
  if (!key) return c.json({ error: "Encryption key required" }, 400);

  const share = getShareMeta(id);
  if (!share) {
    return c.json({ error: "Share not found" }, 404);
  }

  // If password-protected, verify password via signed token
  if (share.has_password) {
    if (!password || !passwordToken) {
      return c.json({ error: "Password required" }, 401);
    }
    const tokenData = verifySignedToken(passwordToken, config.appSecret) as { h: string } | null;
    if (!tokenData?.h) {
      return c.json({ error: "Invalid password token" }, 403);
    }
    const valid = await Bun.password.verify(password, tokenData.h);
    if (!valid) {
      return c.json({ error: "Invalid password" }, 403);
    }
  }

  const deleted = deleteShare(id, key);
  if (!deleted) {
    return c.json({ error: "Failed to delete (invalid key)" }, 403);
  }

  return c.json({ deleted: true });
});

// POST save - decrypt share and save to user's stored data (no view count increment)
view.post("/:id/save", async (c) => {
  const id = c.req.param("id");

  // Require authenticated user with encryption token
  const session = getSessionFromCookie(c);
  if (!session || session.is_admin || !session.tfa_verified || !session.user_id) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  const userToken = getUserTokenFromSession(session);
  if (!userToken) {
    return c.json({ error: "Encryption token not available" }, 400);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request" }, 400);
  }

  const { key, password, passwordToken, title: reqTitle } = body;
  if (!key) return c.json({ error: "Encryption key required" }, 400);

  const share = getShareMeta(id);
  if (!share || share.is_consumed) {
    return c.json({ error: "Share not found" }, 404);
  }

  // Verify key
  const kvHash = keyVerificationHash(key);
  if (kvHash !== share.key_verification) {
    return c.json({ error: "Invalid encryption key" }, 400);
  }

  // Verify password if needed
  if (share.has_password) {
    if (!password || !passwordToken) return c.json({ error: "Password required" }, 401);
    const tokenData = verifySignedToken(passwordToken, config.appSecret) as { h: string } | null;
    if (!tokenData?.h) return c.json({ error: "Invalid password token" }, 403);
    const valid = await Bun.password.verify(password, tokenData.h);
    if (!valid) return c.json({ error: "Invalid password" }, 403);
  }

  const shareKey = keyFromBase64Url(key);
  const userId = session.user_id;

  if (share.type === "text") {
    const content = decryptText(share.encrypted_data as Buffer, shareKey, share.iv, share.auth_tag);
    const title = (reqTitle as string)?.trim() || `Saved share (${new Date().toLocaleDateString()})`;
    createNote({ userId, title, content, userToken });
    return c.json({ saved: true });
  }

  // File
  if (!share.file_path || !existsSync(share.file_path)) {
    return c.json({ error: "File not found" }, 404);
  }
  const title = (reqTitle as string)?.trim() || share.file_name || `Saved file (${new Date().toLocaleDateString()})`;
  try {
    await createStoredFile({
      userId,
      title,
      source: decryptFileStream(share.file_path, shareKey, share.iv, share.auth_tag),
      maxBytes: maxUploadBytes(),
      fileName: share.file_name || "download",
      fileMime: share.file_mime || "application/octet-stream",
      userToken,
    });
  } catch (err) {
    console.error("[save]", err);
    return c.json({ error: "Failed to save file (too large or corrupted)" }, 400);
  }
  return c.json({ saved: true });
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default view;
