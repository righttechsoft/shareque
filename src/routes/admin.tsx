import { Hono } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";
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
import { manageGuard, manageSessionGuard } from "../middleware/manage-guard";
import { sendInviteEmail } from "../services/email";
import { MinimalLayout } from "../views/layout";
import { nanoid } from "nanoid";

const manage = new Hono();

interface ManageConfig {
  totp_secret: string | null;
  webauthn_enabled: number;
  tfa_setup_complete: number;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string | null;
  tfa_method: string | null;
  created_at: number;
}

// --- Management Login ---
manage.get("/login", (c) => {
  return c.html(
    <MinimalLayout title="Management Console">
      <div style="max-width:400px;margin:4rem auto">
        <h2>Management Console</h2>
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

manage.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const password = body.password as string;

  const managePassword = config.adminPassword;
  if (!password || !managePassword) {
    return c.html(
      <MinimalLayout title="Management Console">
        <div style="max-width:400px;margin:4rem auto">
          <h2>Management Console</h2>
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

  // Timing-safe comparison: hash both and compare digests
  const enteredHash = createHash("sha256").update(password).digest();
  const storedHash = createHash("sha256").update(managePassword).digest();
  if (!timingSafeEqual(enteredHash, storedHash)) {
    return c.html(
      <MinimalLayout title="Management Console">
        <div style="max-width:400px;margin:4rem auto">
          <h2>Management Console</h2>
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

  const manageCfg = db
    .query<ManageConfig, []>("SELECT * FROM admin_config WHERE id = 1")
    .get();

  if (!manageCfg?.tfa_setup_complete) {
    return c.redirect("/manage/setup-2fa");
  }

  return c.redirect("/manage/verify-2fa");
});

// --- 2FA Setup ---
manage.get("/setup-2fa", manageSessionGuard, async (c) => {
  const manageCfg = db
    .query<ManageConfig, []>("SELECT * FROM admin_config WHERE id = 1")
    .get();

  let secret = manageCfg?.totp_secret;
  if (!secret) {
    secret = generateTotpSecret();
    db.run("UPDATE admin_config SET totp_secret = ? WHERE id = 1", [secret]);
  }

  const uri = getTotpUri(secret, "manage");
  const qrDataUrl = await generateQrDataUrl(uri);

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
          window.__webauthnContext = { isAdmin: true, userId: 'manage', setupMode: true };
        `,
        }}
      />
    </MinimalLayout>
  );
});

manage.post("/setup-2fa", manageSessionGuard, async (c) => {
  const body = await c.req.parseBody();
  const code = body.code as string;

  const manageCfg = db
    .query<ManageConfig, []>("SELECT * FROM admin_config WHERE id = 1")
    .get();

  if (!manageCfg?.totp_secret || !verifyTotp(manageCfg.totp_secret, code)) {
    return c.redirect("/manage/setup-2fa");
  }

  db.run("UPDATE admin_config SET tfa_setup_complete = 1 WHERE id = 1", []);

  const session = getSessionFromCookie(c);
  if (session) markTfaVerified(session.id);

  return c.redirect("/manage");
});

// --- 2FA Verify ---
manage.get("/verify-2fa", manageSessionGuard, async (c) => {
  const manageCfg = db
    .query<ManageConfig, []>("SELECT * FROM admin_config WHERE id = 1")
    .get();
  const hasWebauthn = getStoredCredentials(null, true).length > 0;

  return c.html(
    <MinimalLayout title="Verify 2FA">
      <div style="max-width:400px;margin:4rem auto">
        <h2>Two-Factor Verification</h2>
        {manageCfg?.totp_secret && (
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
          window.__webauthnContext = { isAdmin: true, userId: 'manage', verifyMode: true };
        `,
        }}
      />
    </MinimalLayout>
  );
});

manage.post("/verify-2fa", manageSessionGuard, async (c) => {
  const body = await c.req.parseBody();
  const code = body.code as string;

  const manageCfg = db
    .query<ManageConfig, []>("SELECT * FROM admin_config WHERE id = 1")
    .get();

  if (!manageCfg?.totp_secret || !verifyTotp(manageCfg.totp_secret, code)) {
    return c.redirect("/manage/verify-2fa");
  }

  const session = getSessionFromCookie(c);
  if (session) markTfaVerified(session.id);

  return c.redirect("/manage");
});

// --- User Management ---
manage.get("/", manageGuard, (c) => {
  const users = db
    .query<UserRow, []>(
      "SELECT id, name, email, password_hash, tfa_method, created_at FROM users ORDER BY created_at DESC"
    )
    .all();

  return c.html(
    <MinimalLayout title="Management Console">
      <nav>
        <ul>
          <li>
            <strong>Shareque Management</strong>
          </li>
        </ul>
        <ul>
          <li>
            <form method="POST" action="/manage/logout" style="margin:0">
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
            <th>Status</th>
            <th>2FA</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <td colSpan={6} class="text-center text-muted">
                No users yet. Invite someone!
              </td>
            </tr>
          ) : (
            users.map((user) => (
              <tr>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>{user.password_hash ? "Active" : "Pending"}</td>
                <td>{user.tfa_method ?? "Not set"}</td>
                <td>{new Date(user.created_at * 1000).toLocaleDateString()}</td>
                <td style="white-space:nowrap">
                  <div style="display:flex;gap:0.25rem">
                    <form
                      method="POST"
                      action={`/manage/resend-invite/${user.id}`}
                      style="margin:0"
                      onsubmit="return confirm('Re-send invite? This will reset their password and require them to set up again.')"
                    >
                      <button type="submit" class="outline btn-sm">
                        Re-send Invite
                      </button>
                    </form>
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
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </MinimalLayout>
  );
});

manage.post("/invite", manageGuard, async (c) => {
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

// --- Re-send Invite (password reset) ---
manage.post("/resend-invite/:id", manageGuard, async (c) => {
  const userId = c.req.param("id");

  const user = db
    .query<UserRow, [string]>("SELECT * FROM users WHERE id = ?")
    .get(userId);
  if (!user) return c.redirect("/manage");

  const inviteToken = nanoid(32);
  const inviteExpiresAt = Math.floor(Date.now() / 1000) + 48 * 3600;

  // Reset password, 2FA, and set new invite token
  db.run(
    `UPDATE users SET
       password_hash = NULL,
       totp_secret = NULL,
       tfa_method = NULL,
       invite_token = ?,
       invite_expires_at = ?
     WHERE id = ?`,
    [inviteToken, inviteExpiresAt, userId]
  );

  // Delete existing sessions for this user
  db.run("DELETE FROM sessions WHERE user_id = ?", [userId]);

  // Delete existing webauthn credentials for this user
  db.run("DELETE FROM webauthn_credentials WHERE user_id = ?", [userId]);

  const inviteUrl = `${config.baseUrl}/set-password/${inviteToken}`;
  try {
    await sendInviteEmail(user.email, user.name, inviteUrl);
  } catch (err) {
    console.error("[email] Failed to re-send invite:", err);
  }

  return c.redirect("/manage");
});

manage.post("/delete/:id", manageGuard, (c) => {
  const userId = c.req.param("id");
  db.run("DELETE FROM users WHERE id = ?", [userId]);
  return c.redirect("/manage");
});

// --- Management logout ---
manage.post("/logout", (c) => {
  const session = getSessionFromCookie(c);
  if (session) {
    deleteSession(session.id);
  }
  clearSessionCookie(c);
  return c.redirect("/manage/login");
});

// --- WebAuthn API for management console ---
manage.post("/api/webauthn/register-options", manageSessionGuard, async (c) => {
  const options = await generateRegOptions("manage", "manage", true);
  return c.json(options);
});

manage.post("/api/webauthn/register-verify", manageSessionGuard, async (c) => {
  const body = await c.req.json();
  const ok = await verifyAndStoreRegistration("manage", true, body);
  if (ok) {
    db.run(
      "UPDATE admin_config SET webauthn_enabled = 1, tfa_setup_complete = 1 WHERE id = 1"
    );
    const session = getSessionFromCookie(c);
    if (session) markTfaVerified(session.id);
  }
  return c.json({ verified: ok });
});

manage.post("/api/webauthn/auth-options", manageSessionGuard, async (c) => {
  const options = await generateAuthOptions("manage", true);
  return c.json(options);
});

manage.post("/api/webauthn/auth-verify", manageSessionGuard, async (c) => {
  const body = await c.req.json();
  const ok = await verifyAuth("manage", true, body);
  if (ok) {
    const session = getSessionFromCookie(c);
    if (session) markTfaVerified(session.id);
  }
  return c.json({ verified: ok });
});

export default manage;
