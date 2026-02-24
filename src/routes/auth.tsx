import { Hono } from "hono";
import { db } from "../db/connection";
import {
  createSession,
  setSessionCookie,
  getSessionFromCookie,
  deleteSession,
  clearSessionCookie,
  markTfaVerified,
} from "../auth/session";
import { generateTotpSecret, getTotpUri, generateQrDataUrl, verifyTotp } from "../auth/totp";
import {
  generateRegOptions,
  verifyAndStoreRegistration,
  generateAuthOptions,
  verifyAuth,
  getStoredCredentials,
} from "../auth/webauthn";
import { sessionGuard } from "../middleware/auth-guard";
import { MinimalLayout } from "../views/layout";
import { config } from "../config";

const auth = new Hono();

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string | null;
  totp_secret: string | null;
  tfa_method: string | null;
  invite_token: string | null;
  invite_expires_at: number | null;
}

// --- User Login ---
auth.get("/login", (c) => {
  return c.html(
    <MinimalLayout title="Login">
      <div style="max-width:400px;margin:4rem auto">
        <h2>Login</h2>
        <form method="POST" action="/login">
          <label>
            Email
            <input type="email" name="email" required autofocus />
          </label>
          <label>
            Password
            <input type="password" name="password" required />
          </label>
          <button type="submit">Login</button>
        </form>
      </div>
    </MinimalLayout>
  );
});

auth.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const email = (body.email as string)?.trim();
  const password = body.password as string;

  if (!email || !password) {
    return c.html(
      <MinimalLayout title="Login">
        <div style="max-width:400px;margin:4rem auto">
          <h2>Login</h2>
          <div class="alert alert-error">Email and password required</div>
          <form method="POST" action="/login">
            <label>
              Email
              <input type="email" name="email" required autofocus value={email || ""} />
            </label>
            <label>
              Password
              <input type="password" name="password" required />
            </label>
            <button type="submit">Login</button>
          </form>
        </div>
      </MinimalLayout>
    );
  }

  const user = db
    .query<UserRow, [string]>("SELECT * FROM users WHERE email = ?")
    .get(email);

  if (!user || !user.password_hash) {
    return c.html(
      <MinimalLayout title="Login">
        <div style="max-width:400px;margin:4rem auto">
          <h2>Login</h2>
          <div class="alert alert-error">Invalid credentials</div>
          <form method="POST" action="/login">
            <label>
              Email
              <input type="email" name="email" required autofocus value={email} />
            </label>
            <label>
              Password
              <input type="password" name="password" required />
            </label>
            <button type="submit">Login</button>
          </form>
        </div>
      </MinimalLayout>
    );
  }

  const valid = await Bun.password.verify(password, user.password_hash);
  if (!valid) {
    return c.html(
      <MinimalLayout title="Login">
        <div style="max-width:400px;margin:4rem auto">
          <h2>Login</h2>
          <div class="alert alert-error">Invalid credentials</div>
          <form method="POST" action="/login">
            <label>
              Email
              <input type="email" name="email" required autofocus value={email} />
            </label>
            <label>
              Password
              <input type="password" name="password" required />
            </label>
            <button type="submit">Login</button>
          </form>
        </div>
      </MinimalLayout>
    );
  }

  const sessionId = createSession(user.id, false);
  setSessionCookie(c, sessionId);

  if (!user.tfa_method) {
    return c.redirect("/setup-2fa");
  }

  return c.redirect("/verify-2fa");
});

// --- Logout ---
auth.post("/logout", (c) => {
  const session = getSessionFromCookie(c);
  if (session) {
    deleteSession(session.id);
  }
  clearSessionCookie(c);
  return c.redirect("/login");
});

// --- Set Password (from invite) ---
auth.get("/set-password/:token", (c) => {
  const token = c.req.param("token");
  const now = Math.floor(Date.now() / 1000);
  const user = db
    .query<UserRow, [string, number]>(
      "SELECT * FROM users WHERE invite_token = ? AND invite_expires_at > ?"
    )
    .get(token, now);

  if (!user) {
    return c.html(
      <MinimalLayout title="Invalid Link">
        <div style="max-width:400px;margin:4rem auto" class="text-center">
          <h2>Invalid or Expired Link</h2>
          <p>This invite link is no longer valid.</p>
        </div>
      </MinimalLayout>
    );
  }

  return c.html(
    <MinimalLayout title="Set Password">
      <div style="max-width:400px;margin:4rem auto">
        <h2>Welcome, {user.name}!</h2>
        <p>Set your password to activate your account.</p>
        <form method="POST" action={`/set-password/${token}`}>
          <label>
            Password
            <input type="password" name="password" required minLength={8} autofocus />
          </label>
          <label>
            Confirm Password
            <input type="password" name="confirm" required minLength={8} />
          </label>
          <button type="submit">Set Password</button>
        </form>
      </div>
    </MinimalLayout>
  );
});

auth.post("/set-password/:token", async (c) => {
  const token = c.req.param("token");
  const now = Math.floor(Date.now() / 1000);
  const user = db
    .query<UserRow, [string, number]>(
      "SELECT * FROM users WHERE invite_token = ? AND invite_expires_at > ?"
    )
    .get(token, now);

  if (!user) {
    return c.html(
      <MinimalLayout title="Invalid Link">
        <div style="max-width:400px;margin:4rem auto" class="text-center">
          <h2>Invalid or Expired Link</h2>
          <p>This invite link is no longer valid.</p>
        </div>
      </MinimalLayout>
    );
  }

  const body = await c.req.parseBody();
  const password = body.password as string;
  const confirm = body.confirm as string;

  if (!password || password.length < 8 || password !== confirm) {
    return c.html(
      <MinimalLayout title="Set Password">
        <div style="max-width:400px;margin:4rem auto">
          <h2>Welcome, {user.name}!</h2>
          <div class="alert alert-error">
            Passwords must match and be at least 8 characters.
          </div>
          <form method="POST" action={`/set-password/${token}`}>
            <label>
              Password
              <input type="password" name="password" required minLength={8} autofocus />
            </label>
            <label>
              Confirm Password
              <input type="password" name="confirm" required minLength={8} />
            </label>
            <button type="submit">Set Password</button>
          </form>
        </div>
      </MinimalLayout>
    );
  }

  const hash = await Bun.password.hash(password);
  db.run(
    "UPDATE users SET password_hash = ?, invite_token = NULL, invite_expires_at = NULL WHERE id = ?",
    [hash, user.id]
  );

  // Create session and redirect to 2FA setup
  const sessionId = createSession(user.id, false);
  setSessionCookie(c, sessionId);

  return c.redirect("/setup-2fa");
});

// --- 2FA Setup for Users ---
auth.get("/setup-2fa", sessionGuard, async (c) => {
  const session = getSessionFromCookie(c)!;
  const userId = session.user_id!;
  const user = db
    .query<UserRow, [string]>("SELECT * FROM users WHERE id = ?")
    .get(userId);
  if (!user) return c.redirect("/login");

  let secret = user.totp_secret;
  if (!secret) {
    secret = generateTotpSecret();
    db.run("UPDATE users SET totp_secret = ? WHERE id = ?", [secret, userId]);
  }

  const uri = getTotpUri(secret, user.email);
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
        <form method="POST" action="/setup-2fa">
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
          window.__webauthnContext = { isAdmin: false, userId: '${userId}', setupMode: true };
        `,
        }}
      />
    </MinimalLayout>
  );
});

auth.post("/setup-2fa", sessionGuard, async (c) => {
  const session = getSessionFromCookie(c)!;
  const userId = session.user_id!;
  const user = db
    .query<UserRow, [string]>("SELECT * FROM users WHERE id = ?")
    .get(userId);

  if (!user?.totp_secret) return c.redirect("/setup-2fa");

  const body = await c.req.parseBody();
  const code = body.code as string;

  if (!verifyTotp(user.totp_secret, code)) {
    return c.redirect("/setup-2fa");
  }

  db.run("UPDATE users SET tfa_method = 'totp' WHERE id = ?", [userId]);
  markTfaVerified(session.id);

  return c.redirect("/dashboard");
});

// --- 2FA Verify for Users ---
auth.get("/verify-2fa", sessionGuard, (c) => {
  const session = getSessionFromCookie(c)!;
  const userId = session.user_id!;
  const hasWebauthn = getStoredCredentials(userId, false).length > 0;
  const user = db
    .query<UserRow, [string]>("SELECT * FROM users WHERE id = ?")
    .get(userId);

  return c.html(
    <MinimalLayout title="Verify 2FA">
      <div style="max-width:400px;margin:4rem auto">
        <h2>Two-Factor Verification</h2>
        {user?.totp_secret && (
          <form method="POST" action="/verify-2fa">
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
          window.__webauthnContext = { isAdmin: false, userId: '${userId}', verifyMode: true };
        `,
        }}
      />
    </MinimalLayout>
  );
});

auth.post("/verify-2fa", sessionGuard, async (c) => {
  const session = getSessionFromCookie(c)!;
  const userId = session.user_id!;
  const user = db
    .query<UserRow, [string]>("SELECT * FROM users WHERE id = ?")
    .get(userId);

  if (!user?.totp_secret) return c.redirect("/verify-2fa");

  const body = await c.req.parseBody();
  const code = body.code as string;

  if (!verifyTotp(user.totp_secret, code)) {
    return c.redirect("/verify-2fa");
  }

  markTfaVerified(session.id);
  return c.redirect("/dashboard");
});

// --- WebAuthn API for users ---
auth.post("/api/webauthn/register-options", sessionGuard, async (c) => {
  const session = getSessionFromCookie(c)!;
  const userId = session.user_id!;
  const user = db
    .query<UserRow, [string]>("SELECT * FROM users WHERE id = ?")
    .get(userId);
  if (!user) return c.json({ error: "User not found" }, 400);

  const options = await generateRegOptions(userId, user.email, false);
  return c.json(options);
});

auth.post("/api/webauthn/register-verify", sessionGuard, async (c) => {
  const session = getSessionFromCookie(c)!;
  const userId = session.user_id!;
  const body = await c.req.json();
  const ok = await verifyAndStoreRegistration(userId, false, body);
  if (ok) {
    db.run("UPDATE users SET tfa_method = 'webauthn' WHERE id = ?", [userId]);
    markTfaVerified(session.id);
  }
  return c.json({ verified: ok });
});

auth.post("/api/webauthn/auth-options", sessionGuard, async (c) => {
  const session = getSessionFromCookie(c)!;
  const userId = session.user_id!;
  const options = await generateAuthOptions(userId, false);
  return c.json(options);
});

auth.post("/api/webauthn/auth-verify", sessionGuard, async (c) => {
  const session = getSessionFromCookie(c)!;
  const userId = session.user_id!;
  const body = await c.req.json();
  const ok = await verifyAuth(userId, false, body);
  if (ok) markTfaVerified(session.id);
  return c.json({ verified: ok });
});

export default auth;
