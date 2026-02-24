import { Hono } from "hono";
import { getShareMeta, viewShare, deleteShare } from "../services/share";
import { MinimalLayout } from "../views/layout";

const view = new Hono();

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
          <form method="POST" action={`/view/${id}/delete`} style="margin:0">
            <button type="submit" class="outline secondary btn-sm" onclick="return confirm('Delete this share permanently?')">
              Delete
            </button>
          </form>
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
            id: '${id}',
            type: '${share.type}',
            hasPassword: ${share.has_password ? "true" : "false"},
            fileName: ${share.file_name ? `'${share.file_name.replace(/'/g, "\\'")}'` : "null"},
            fileMime: ${share.file_mime ? `'${share.file_mime}'` : "null"}
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

  const { key, password } = body;
  if (!key) return c.json({ error: "Encryption key required" }, 400);

  const result = await viewShare(id, key, password);

  if (!result.ok) {
    return c.json({ error: result.error }, result.error === "password_required" ? 401 : 400);
  }

  if (result.type === "text") {
    return c.json({ type: "text", content: result.content });
  }

  // File - return as binary with metadata headers
  return new Response(result.fileData, {
    headers: {
      "Content-Type": result.fileMime || "application/octet-stream",
      "Content-Disposition": `inline; filename="${result.fileName}"`,
      "X-File-Name": result.fileName || "download",
      "X-File-Mime": result.fileMime || "application/octet-stream",
    },
  });
});

// POST delete
view.post("/:id/delete", (c) => {
  const id = c.req.param("id");
  deleteShare(id);
  return c.html(
    <MinimalLayout title="Deleted">
      <div class="text-center" style="margin-top:4rem">
        <h2>Share Deleted</h2>
        <p class="text-muted">This share has been permanently deleted.</p>
      </div>
    </MinimalLayout>
  );
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default view;
