import { Hono } from "hono";
import { getShareMeta, viewShare, deleteShare } from "../services/share";
import { verifySignedToken } from "../crypto/encryption";
import { config } from "../config";
import { MinimalLayout } from "../views/layout";

const view = new Hono();

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
              <input type="password" id="share-password" autofocus />
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
            fileMime: ${share.file_mime ? safeJsonEmbed(share.file_mime) : "null"}
          };
        `,
        }}
      />
    </MinimalLayout>
  );
});

// POST content - decrypt and return
view.post("/:id/content", async (c) => {
  const id = c.req.param("id");

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request" }, 400);
  }

  const { key, password, passwordToken } = body;
  if (!key) return c.json({ error: "Encryption key required" }, 400);

  const result = await viewShare(id, key, password, passwordToken);

  if (!result.ok) {
    return c.json({ error: result.error }, result.error === "password_required" ? 401 : 400);
  }

  if (result.type === "text") {
    return c.json({ type: "text", content: result.content });
  }

  // File - return as binary with metadata headers
  // Sanitize filename for Content-Disposition
  const safeName = sanitizeFilename(result.fileName || "download");
  return new Response(result.fileData, {
    headers: {
      "Content-Type": result.fileMime || "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${safeName}`,
      "X-File-Name": result.fileName || "download",
      "X-File-Mime": result.fileMime || "application/octet-stream",
    },
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default view;
