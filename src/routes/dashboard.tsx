import { Hono } from "hono";
import { db } from "../db/connection";
import { authGuard } from "../middleware/auth-guard";
import { getUserPreferences, setUserPreferences } from "../auth/session";
import { createTextShare, createFileShare } from "../services/share";
import { createUploadRequest } from "../services/upload-request";
import { Layout } from "../views/layout";
import { config } from "../config";

const dashboard = new Hono();

interface ShareRow {
  id: string;
  type: string;
  has_password: number;
  max_views: number | null;
  view_count: number;
  is_consumed: number;
  expires_at: number | null;
  created_at: number;
  file_name: string | null;
}

interface UploadReqRow {
  id: string;
  token: string;
  is_consumed: number;
  expires_at: number;
  created_at: number;
}

dashboard.use("/dashboard", authGuard);
dashboard.use("/dashboard/*", authGuard);
dashboard.use("/share/*", authGuard);
dashboard.use("/request-data", authGuard);

dashboard.get("/dashboard", (c) => {
  const userId = c.get("userId") as string;

  const prefs = getUserPreferences(c);

  const shares = db
    .query<ShareRow, [string]>(
      "SELECT id, type, has_password, max_views, view_count, is_consumed, expires_at, created_at, file_name FROM shares WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
    )
    .all(userId);

  const uploadReqs = db
    .query<UploadReqRow, [string]>(
      "SELECT * FROM upload_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 20"
    )
    .all(userId);

  return c.html(
    <Layout title="Dashboard">
      <h2>Dashboard</h2>

      <div class="tabs">
        <button class="active" data-tab="text">Share Text</button>
        <button data-tab="file">Share File</button>
        <button data-tab="request">Request Data</button>
        <button data-tab="history">History</button>
      </div>

      {/* Text Share Tab */}
      <div class="tab-content active" id="tab-text">
        <form method="POST" action="/share/text">
          <label>
            Text Content
            <textarea name="text" rows={8} required placeholder="Paste your text here..." />
          </label>
          <div class="inline-options">
            <label>
              <input
                type="checkbox"
                name="use_password"
                value="1"
                checked={!!prefs.text_use_password}
              />{" "}
              Password protect
            </label>
            <label>
              <input
                type="checkbox"
                name="one_time"
                value="1"
                checked={!!prefs.text_one_time}
              />{" "}
              One-time view
            </label>
          </div>
          <div class="form-row">
            <label>
              TTL
              <input
                type="number"
                name="ttl_value"
                min={0}
                value={prefs.text_ttl_value.toString()}
                placeholder="0 = no expiry"
              />
            </label>
            <label>
              Unit
              <select name="ttl_unit">
                <option value="minutes" selected={prefs.text_ttl_unit === "minutes"}>
                  Minutes
                </option>
                <option value="hours" selected={prefs.text_ttl_unit === "hours"}>
                  Hours
                </option>
                <option value="days" selected={prefs.text_ttl_unit === "days"}>
                  Days
                </option>
              </select>
            </label>
          </div>
          <div id="password-field-text" style={prefs.text_use_password ? "" : "display:none"}>
            <label>
              Password
              <input type="password" name="password" />
            </label>
          </div>
          <button type="submit" class="mt-1">Share</button>
        </form>
      </div>

      {/* File Share Tab */}
      <div class="tab-content" id="tab-file">
        <form method="POST" action="/share/file" enctype="multipart/form-data">
          <label>
            File
            <input type="file" name="file" required />
          </label>
          <div class="inline-options">
            <label>
              <input
                type="checkbox"
                name="use_password"
                value="1"
                checked={!!prefs.file_use_password}
              />{" "}
              Password protect
            </label>
            <label>
              <input
                type="checkbox"
                name="one_time"
                value="1"
                checked={!!prefs.file_one_time}
              />{" "}
              One-time view
            </label>
          </div>
          <div class="form-row">
            <label>
              TTL
              <input
                type="number"
                name="ttl_value"
                min={0}
                value={prefs.file_ttl_value.toString()}
                placeholder="0 = no expiry"
              />
            </label>
            <label>
              Unit
              <select name="ttl_unit">
                <option value="minutes" selected={prefs.file_ttl_unit === "minutes"}>
                  Minutes
                </option>
                <option value="hours" selected={prefs.file_ttl_unit === "hours"}>
                  Hours
                </option>
                <option value="days" selected={prefs.file_ttl_unit === "days"}>
                  Days
                </option>
              </select>
            </label>
          </div>
          <div id="password-field-file" style={prefs.file_use_password ? "" : "display:none"}>
            <label>
              Password
              <input type="password" name="password" />
            </label>
          </div>
          <button type="submit" class="mt-1">Upload & Share</button>
        </form>
      </div>

      {/* Request Data Tab */}
      <div class="tab-content" id="tab-request">
        <p>Create a one-time upload link that anyone can use to send you data.</p>
        <form method="POST" action="/request-data">
          <label>
            Link Expiry (hours)
            <input type="number" name="ttl_hours" min={1} max={168} value="48" />
          </label>
          <button type="submit">Create Upload Link</button>
        </form>

        {uploadReqs.length > 0 && (
          <div class="mt-2">
            <h4>Recent Upload Requests</h4>
            <table>
              <thead>
                <tr>
                  <th>Link</th>
                  <th>Status</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {uploadReqs.map((r) => (
                  <tr>
                    <td>
                      <code style="font-size:0.8rem">
                        {config.baseUrl}/upload/{r.token}
                      </code>
                      <button
                        type="button"
                        class="outline btn-sm copy-btn"
                        data-copy={`${config.baseUrl}/upload/${r.token}`}
                        style="margin-left:0.5rem"
                      >
                        Copy
                      </button>
                    </td>
                    <td>{r.is_consumed ? "Used" : "Active"}</td>
                    <td>{new Date(r.expires_at * 1000).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* History Tab */}
      <div class="tab-content" id="tab-history">
        {shares.length === 0 ? (
          <p class="text-muted text-center mt-2">No shares yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>ID</th>
                <th>Views</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {shares.map((s) => (
                <tr>
                  <td>{s.type === "file" ? (s.file_name || "File") : "Text"}</td>
                  <td>
                    <code>{s.id}</code>
                  </td>
                  <td>
                    {s.view_count}
                    {s.max_views ? ` / ${s.max_views}` : ""}
                  </td>
                  <td>
                    {s.is_consumed
                      ? "Consumed"
                      : s.expires_at && s.expires_at <= Math.floor(Date.now() / 1000)
                        ? "Expired"
                        : "Active"}
                  </td>
                  <td>{new Date(s.created_at * 1000).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
});

// --- Create Text Share ---
dashboard.post("/share/text", async (c) => {
  const userId = c.get("userId") as string;
  const body = await c.req.parseBody();
  const text = body.text as string;
  const usePassword = body.use_password === "1";
  const password = (body.password as string) || undefined;
  const oneTime = body.one_time === "1";
  const ttlValue = parseInt(body.ttl_value as string, 10) || 0;
  const ttlUnit = body.ttl_unit as string;

  if (!text?.trim()) return c.redirect("/dashboard");

  let expiresAt: number | undefined;
  if (ttlValue > 0) {
    const multiplier =
      ttlUnit === "days" ? 86400 : ttlUnit === "hours" ? 3600 : 60;
    expiresAt = Math.floor(Date.now() / 1000) + ttlValue * multiplier;
  }

  const result = await createTextShare({
    userId,
    text,
    password: usePassword ? password : undefined,
    maxViews: oneTime ? 1 : undefined,
    expiresAt,
  });

  // Save preferences to cookie
  setUserPreferences(c, {
    text_use_password: usePassword ? 1 : 0,
    text_ttl_value: ttlValue,
    text_ttl_unit: ttlUnit,
    text_one_time: oneTime ? 1 : 0,
    file_use_password: getUserPreferences(c).file_use_password,
    file_ttl_value: getUserPreferences(c).file_ttl_value,
    file_ttl_unit: getUserPreferences(c).file_ttl_unit,
    file_one_time: getUserPreferences(c).file_one_time,
  });

  // Build URL with key.passwordToken fragment format when password is set
  const fragment = result.passwordToken
    ? `${result.key}.${result.passwordToken}`
    : result.key;
  const viewUrl = `${config.baseUrl}/view/${result.id}#${fragment}`;

  return c.html(
    <Layout title="Share Created">
      <h2>Share Created!</h2>
      <div class="alert alert-success">Your share link is ready.</div>
      <div class="share-url">
        <code id="share-url">{viewUrl}</code>
        <button type="button" class="outline btn-sm copy-btn" data-copy={viewUrl}>
          Copy
        </button>
      </div>
      <p class="text-muted">
        The encryption key is in the URL fragment (#) and is never sent to the server.
      </p>
      <a href="/dashboard">Back to Dashboard</a>
    </Layout>
  );
});

// --- Create File Share ---
dashboard.post("/share/file", async (c) => {
  const userId = c.get("userId") as string;
  const body = await c.req.parseBody();
  const file = body.file as File;
  const usePassword = body.use_password === "1";
  const password = (body.password as string) || undefined;
  const oneTime = body.one_time === "1";
  const ttlValue = parseInt(body.ttl_value as string, 10) || 0;
  const ttlUnit = body.ttl_unit as string;

  if (!file || file.size === 0) return c.redirect("/dashboard");
  if (file.size > config.maxFileSize) {
    return c.html(
      <Layout title="Error">
        <div class="alert alert-error">
          File too large. Maximum size is {config.maxFileSize / 1024 / 1024}MB.
        </div>
        <a href="/dashboard">Back to Dashboard</a>
      </Layout>
    );
  }

  let expiresAt: number | undefined;
  if (ttlValue > 0) {
    const multiplier =
      ttlUnit === "days" ? 86400 : ttlUnit === "hours" ? 3600 : 60;
    expiresAt = Math.floor(Date.now() / 1000) + ttlValue * multiplier;
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());

  const result = await createFileShare({
    userId,
    fileData: fileBuffer,
    fileName: file.name,
    fileMime: file.type || "application/octet-stream",
    fileSize: file.size,
    password: usePassword ? password : undefined,
    maxViews: oneTime ? 1 : undefined,
    expiresAt,
  });

  // Save preferences to cookie
  setUserPreferences(c, {
    text_use_password: getUserPreferences(c).text_use_password,
    text_ttl_value: getUserPreferences(c).text_ttl_value,
    text_ttl_unit: getUserPreferences(c).text_ttl_unit,
    text_one_time: getUserPreferences(c).text_one_time,
    file_use_password: usePassword ? 1 : 0,
    file_ttl_value: ttlValue,
    file_ttl_unit: ttlUnit,
    file_one_time: oneTime ? 1 : 0,
  });

  // Build URL with key.passwordToken fragment format when password is set
  const fragment = result.passwordToken
    ? `${result.key}.${result.passwordToken}`
    : result.key;
  const viewUrl = `${config.baseUrl}/view/${result.id}#${fragment}`;

  return c.html(
    <Layout title="Share Created">
      <h2>File Shared!</h2>
      <div class="alert alert-success">Your share link is ready.</div>
      <div class="share-url">
        <code id="share-url">{viewUrl}</code>
        <button type="button" class="outline btn-sm copy-btn" data-copy={viewUrl}>
          Copy
        </button>
      </div>
      <p class="text-muted">
        The encryption key is in the URL fragment (#) and is never sent to the server.
      </p>
      <a href="/dashboard">Back to Dashboard</a>
    </Layout>
  );
});

// --- Request Data ---
dashboard.post("/request-data", async (c) => {
  const userId = c.get("userId") as string;
  const formBody = await c.req.parseBody();
  const ttlHours = parseInt(formBody.ttl_hours as string, 10) || 48;
  const result = createUploadRequest(userId, ttlHours);

  return c.html(
    <Layout title="Upload Request Created">
      <h2>Upload Request Created!</h2>
      <div class="alert alert-success">Share this link with anyone to receive data.</div>
      <div class="share-url">
        <code id="share-url">{result.url}</code>
        <button type="button" class="outline btn-sm copy-btn" data-copy={result.url}>
          Copy
        </button>
      </div>
      <p class="text-muted">
        This link is one-time use and expires in {ttlHours} hours.
      </p>
      <a href="/dashboard">Back to Dashboard</a>
    </Layout>
  );
});

export default dashboard;
