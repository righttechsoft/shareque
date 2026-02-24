import { Hono } from "hono";
import { db } from "../db/connection";
import { config } from "../config";
import {
  createSession,
  setSessionCookie,
  markTfaVerified,
  getSessionFromCookie,
  deleteSession,
  clearSessionCookie,
} from "../auth/session";
import { generateTotpSecret, getTotpUri, generateQrDataUrl, verifyTotp } from "../auth/totp";
import {
  generateRegOptions,
  verifyAndStoreRegistration,
  generateAuthOptions,
  verifyAuth,
  getStoredCredentials,
} from "../auth/webauthn";
import { adminGuard, adminSessionGuard } from "../middleware/admin-guard";
import { sendInviteEmail } from "../services/email";
import { Layout, MinimalLayout } from "../views/layout";
import { nanoid } from "nanoid";

const admin = new Hono();

interface AdminConfig {
  totp_secret: string | null;
  webauthn_enabled: number;
  tfa_setup_complete: number;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  tfa_method: string | null;
  created_at: number;
}

// --- Admin Login ---
admin.get("/login", (c) => {
  return c.html(
    <MinimalLayout title="Admin Login">
      <div style="max-width:400px;margin:4rem auto">
        <h2>Admin Login</h2>
        <form method="POST" action="/manage/login">
          <label>
            Password
            <input type="password" name="password" required autofocus />
          </label>
          <button type="submit">Login</button>
        </form>
      </div>
    </MinimalLayout>
  );
});

admin.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const password = body.password as string;

  if (!password || password !== config.adminPassword) {
    return c.html(
      <MinimalLayout title="Admin Login">
        <div style="max-width:400px;margin:4rem auto">
          <h2>Admin Login</h2>
          <div class="alert alert-error">Invalid password</div>
          <form method="POST" action="/manage/login">
            <label>
              Password
              <input type="password" name="password" required autofocus />
            </label>
            <button type="submit">Login</button>
          </form>
        </div>
      </MinimalLayout>
    );
  }

  const sessionId = createSession(null, true);
  setSessionCookie(c, sessionId);

  const adminCfg = db
    .query<AdminConfig, []>("SELECT * FROM admin_config WHERE id = 1")
    .get();

  if (!adminCfg?.tfa_setup_complete) {
    return c.redirect("/manage/setup-2fa");
  }

  return c.redirect("/manage/verify-2fa");
});

// --- 2FA Setup ---
admin.get("/setup-2fa", adminSessionGuard, async (c) => {
  const adminCfg = db
    .query<AdminConfig, []>("SELECT * FROM admin_config WHERE id = 1")
    .get();

  let qrDataUrl = "";
  let secret = adminCfg?.totp_secret;
  if (!secret) {
    secret = generateTotpSecret();
    db.run("UPDATE admin_config SET totp_secret = ? WHERE id = 1", [secret]);
  }

  const uri = getTotpUri(secret, "admin");
  qrDataUrl = await generateQrDataUrl(uri);

  return c.html(
    <MinimalLayout title="Setup 2FA">
      <div style="max-width:500px;margin:4rem auto">
        <h2>Setup Two-Factor Authentication</h2>
        <p>Scan this QR code with your authenticator app:</p>
        <div class="text-center mb-2">
          <img src={qrDataUrl} alt="TOTP QR Code" style="max-width:250px" />
        </div>
        <p class="text-muted" style="font-size:0.8rem;word-break:break-all">
          Manual entry: {secret}
        </p>
        <form method="POST" action="/manage/setup-2fa">
          <label>
            Verification Code
            <input
              type="text"
              name="code"
              pattern="[0-9]{6}"
              maxlength={6}
              required
              autofocus
              placeholder="Enter 6-digit code"
              autocomplete="one-time-code"
            />
          </label>
          <button type="submit">Verify & Enable</button>
        </form>
        <hr />
        <details>
          <summary>Or use a Security Key (WebAuthn)</summary>
          <button type="button" id="webauthn-register-btn" class="outline mt-1">
            Register Security Key
          </button>
          <div id="webauthn-status"></div>
        </details>
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `
          window.__webauthnContext = { isAdmin: true, userId: 'admin', setupMode: true };
        `,
        }}
      />
    </MinimalLayout>
  );
});

admin.post("/setup-2fa", adminSessionGuard, async (c) => {
  const body = await c.req.parseBody();
  const code = body.code as string;

  const adminCfg = db
    .query<AdminConfig, []>("SELECT * FROM admin_config WHERE id = 1")
    .get();

  if (!adminCfg?.totp_secret || !verifyTotp(adminCfg.totp_secret, code)) {
    return c.redirect("/manage/setup-2fa");
  }

  db.run("UPDATE admin_config SET tfa_setup_complete = 1 WHERE id = 1", []);

  const session = getSessionFromCookie(c);
  if (session) markTfaVerified(session.id);

  return c.redirect("/manage");
});

// --- 2FA Verify ---
admin.get("/verify-2fa", adminSessionGuard, async (c) => {
  const adminCfg = db
    .query<AdminConfig, []>("SELECT * FROM admin_config WHERE id = 1")
    .get();
  const hasWebauthn = getStoredCredentials(null, true).length > 0;

  return c.html(
    <MinimalLayout title="Verify 2FA">
      <div style="max-width:400px;margin:4rem auto">
        <h2>Two-Factor Verification</h2>
        {adminCfg?.totp_secret && (
          <form method="POST" action="/manage/verify-2fa">
            <label>
              Authenticator Code
              <input
                type="text"
                name="code"
                pattern="[0-9]{6}"
                maxlength={6}
                required
                autofocus
                placeholder="Enter 6-digit code"
                autocomplete="one-time-code"
              />
            </label>
            <button type="submit">Verify</button>
          </form>
        )}
        {hasWebauthn && (
          <div>
            <hr />
            <button type="button" id="webauthn-auth-btn" class="outline">
              Use Security Key
            </button>
            <div id="webauthn-status"></div>
          </div>
        )}
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `
          window.__webauthnContext = { isAdmin: true, userId: 'admin', verifyMode: true };
        `,
        }}
      />
    </MinimalLayout>
  );
});

admin.post("/verify-2fa", adminSessionGuard, async (c) => {
  const body = await c.req.parseBody();
  const code = body.code as string;

  const adminCfg = db
    .query<AdminConfig, []>("SELECT * FROM admin_config WHERE id = 1")
    .get();

  if (!adminCfg?.totp_secret || !verifyTotp(adminCfg.totp_secret, code)) {
    return c.redirect("/manage/verify-2fa");
  }

  const session = getSessionFromCookie(c);
  if (session) markTfaVerified(session.id);

  return c.redirect("/manage");
});

// --- User Management ---
admin.get("/", adminGuard, (c) => {
  const users = db
    .query<UserRow, []>(
      "SELECT id, name, email, tfa_method, created_at FROM users ORDER BY created_at DESC"
    )
    .all();

  return c.html(
    <MinimalLayout title="Admin Panel">
      <nav>
        <ul>
          <li>
            <strong>Shareque Admin</strong>
          </li>
        </ul>
        <ul>
          <li>
            <form method="POST" action="/logout" style="margin:0">
              <button type="submit" class="outline secondary btn-sm">
                Logout
              </button>
            </form>
          </li>
        </ul>
      </nav>

      <h2>User Management</h2>

      <div class="card mb-2">
        <h3>Invite New User</h3>
        <form method="POST" action="/manage/invite">
          <div class="form-row">
            <label>
              Name
              <input type="text" name="name" required />
            </label>
            <label>
              Email
              <input type="email" name="email" required />
            </label>
          </div>
          <button type="submit">Send Invite</button>
        </form>
      </div>

      <table class="user-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>2FA</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <td colSpan={5} class="text-center text-muted">
                No users yet. Invite someone!
              </td>
            </tr>
          ) : (
            users.map((user) => (
              <tr>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>{user.tfa_method ?? "Not set"}</td>
                <td>{new Date(user.created_at * 1000).toLocaleDateString()}</td>
                <td>
                  <form
                    method="POST"
                    action={`/manage/delete/${user.id}`}
                    style="margin:0"
                    onsubmit="return confirm('Delete this user and all their data?')"
                  >
                    <button type="submit" class="outline secondary btn-sm">
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </MinimalLayout>
  );
});

admin.post("/invite", adminGuard, async (c) => {
  const body = await c.req.parseBody();
  const name = (body.name as string).trim();
  const email = (body.email as string).trim();

  if (!name || !email) return c.redirect("/manage");

  const id = nanoid(12);
  const inviteToken = nanoid(32);
  const inviteExpiresAt = Math.floor(Date.now() / 1000) + 48 * 3600; // 48h

  try {
    db.run(
      "INSERT INTO users (id, name, email, invite_token, invite_expires_at) VALUES (?, ?, ?, ?, ?)",
      [id, name, email, inviteToken, inviteExpiresAt]
    );
  } catch (err: any) {
    if (err.message?.includes("UNIQUE")) {
      return c.redirect("/manage");
    }
    throw err;
  }

  const inviteUrl = `${config.baseUrl}/set-password/${inviteToken}`;
  try {
    await sendInviteEmail(email, name, inviteUrl);
  } catch (err) {
    console.error("[email] Failed to send invite:", err);
  }

  return c.redirect("/manage");
});

admin.post("/delete/:id", adminGuard, (c) => {
  const userId = c.req.param("id");
  // Cascade will handle sessions, shares, etc.
  db.run("DELETE FROM users WHERE id = ?", [userId]);
  return c.redirect("/manage");
});

// --- WebAuthn API for admin ---
admin.post("/api/webauthn/register-options", adminSessionGuard, async (c) => {
  const options = await generateRegOptions("admin", "admin", true);
  return c.json(options);
});

admin.post("/api/webauthn/register-verify", adminSessionGuard, async (c) => {
  const body = await c.req.json();
  const ok = await verifyAndStoreRegistration("admin", true, body);
  if (ok) {
    db.run(
      "UPDATE admin_config SET webauthn_enabled = 1, tfa_setup_complete = 1 WHERE id = 1"
    );
    const session = getSessionFromCookie(c);
    if (session) markTfaVerified(session.id);
  }
  return c.json({ verified: ok });
});

admin.post("/api/webauthn/auth-options", adminSessionGuard, async (c) => {
  const options = await generateAuthOptions("admin", true);
  return c.json(options);
});

admin.post("/api/webauthn/auth-verify", adminSessionGuard, async (c) => {
  const body = await c.req.json();
  const ok = await verifyAuth("admin", true, body);
  if (ok) {
    const session = getSessionFromCookie(c);
    if (session) markTfaVerified(session.id);
  }
  return c.json({ verified: ok });
});

export default admin;
