# Shareque

Secure sharing of text snippets and files with end-to-end encryption, invite-only access, and 2FA.

## Features

- **Encrypted sharing** — AES-256-GCM encryption. The decryption key lives in the URL fragment (`#`) and never reaches the server in HTTP requests.
- **Text & file sharing** — Share text snippets or upload files with optional password protection, view limits, and TTL expiry.
- **Smart previews** — Images, video, audio, and text files preview inline. Everything else gets a download button.
- **One-time shares** — Shares that self-destruct after a single view.
- **Request data** — Generate a one-time upload link for someone to send you data securely. You get an email with the view link and auto-generated password.
- **Invite-only users** — No self-registration. Users are created via the management console and receive an invite email to set their password and 2FA.
- **2FA everywhere** — TOTP (authenticator app) or hardware security key (WebAuthn) for both users and the management console.
- **Management console** — Protected by an environment variable password + 2FA. Manage users, send invites, re-send invites (password reset).
- **Auto-cleanup** — Background job removes expired shares, consumed upload requests, and stale sessions.

## Quick Start

```bash
# Install dependencies
bun install

# Configure (edit values as needed)
cp .env.example .env

# Start the server
bun run dev
```

Visit `http://localhost:3000/manage/login` to access the management console with the password from your `.env` file, set up 2FA, and invite your first user.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ADMIN_PASSWORD` | Yes | — | Management console login password |
| `PORT` | No | `3000` | Server port |
| `HOST` | No | `0.0.0.0` | Server bind address |
| `BASE_URL` | No | `http://localhost:3000` | Public URL (used in emails and share links) |
| `SMTP_HOST` | Yes | — | SMTP server hostname |
| `SMTP_PORT` | No | `587` | SMTP server port |
| `SMTP_USER` | Yes | — | SMTP username |
| `SMTP_PASS` | Yes | — | SMTP password |
| `SMTP_FROM` | No | `shareque@localhost` | Sender email address |
| `WEBAUTHN_RP_NAME` | No | `Shareque` | WebAuthn relying party name |
| `WEBAUTHN_RP_ID` | No | `localhost` | WebAuthn relying party ID (your domain) |
| `WEBAUTHN_ORIGIN` | No | `http://localhost:3000` | WebAuthn expected origin |
| `CLEANUP_INTERVAL` | No | `5` | Minutes between cleanup runs |
| `MAX_FILE_SIZE` | No | `100` | Max upload size in MB |

## Docker

```bash
docker build -t shareque .
docker run -p 3000:3000 \
  -e ADMIN_PASSWORD=your-password \
  -e SMTP_HOST=smtp.example.com \
  -e SMTP_USER=user@example.com \
  -e SMTP_PASS=smtp-password \
  -e BASE_URL=https://share.example.com \
  -v shareque-data:/app/data \
  shareque
```

## Tech Stack

Bun, Hono, bun:sqlite, node:crypto (AES-256-GCM), otpauth, @simplewebauthn/server, nodemailer, Pico CSS.
