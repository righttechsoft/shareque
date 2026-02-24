# Shareque - Secure Sharing App

## Overview
Shareque is a web app for secure sharing of text snippets and files. It features admin user management behind password+2FA, invite-only user registration, AES-256-GCM encrypted text/file sharing with unique URLs, and a "request data" feature for receiving uploads from external users.

## Tech Stack
- **Runtime**: Bun
- **Framework**: Hono (with JSX for SSR)
- **Database**: bun:sqlite (WAL mode)
- **Encryption**: node:crypto AES-256-GCM
- **Password hashing**: Bun.password (bcrypt/argon2)
- **TOTP**: otpauth
- **WebAuthn**: @simplewebauthn/server + @simplewebauthn/browser (CDN)
- **Email**: nodemailer
- **QR codes**: qrcode
- **IDs**: nanoid
- **CSS**: Pico CSS (CDN) + custom stylesheet
- **Docker**: oven/bun:1-slim

## Commands
- `bun install` - Install dependencies
- `bun run dev` - Start dev server with watch mode
- `bun run start` - Start production server
- `docker build -t shareque .` - Build Docker image

## Project Structure
```
src/
├── index.tsx              # Hono app entry, middleware, route mounting, cleanup job
├── config.ts              # Loads .env, deletes .env after read, exports config object
├── db/
│   ├── connection.ts      # bun:sqlite instance (WAL mode, foreign keys)
│   └── schema.ts          # 7 CREATE TABLE statements, run on startup
├── crypto/
│   └── encryption.ts      # AES-256-GCM encrypt/decrypt for text and file buffers
├── auth/
│   ├── session.ts         # Session CRUD (64-hex IDs), cookie helpers
│   ├── totp.ts            # TOTP secret generation, QR code, verification
│   └── webauthn.ts        # WebAuthn registration/authentication with in-memory challenge store
├── services/
│   ├── share.ts           # Create/view/delete shares, atomic view count, file storage
│   ├── upload-request.ts  # Upload request lifecycle, auto-password, email notification
│   └── email.ts           # Nodemailer transport, invite + upload notification emails
├── middleware/
│   ├── auth-guard.ts      # Require user session + 2FA verified
│   └── admin-guard.ts     # Require admin session + 2FA verified
├── routes/
│   ├── admin.tsx           # /manage/* - admin login, 2FA setup/verify, user CRUD
│   ├── auth.tsx            # /login, /logout, /set-password/:token, /setup-2fa, /verify-2fa
│   ├── dashboard.tsx       # /dashboard, /share/text, /share/file, /request-data
│   ├── view.tsx            # /view/:id - HTML shell + POST /content + POST /delete
│   └── upload.tsx          # /upload/:token - public upload form
├── views/
│   └── layout.tsx          # Layout + MinimalLayout base HTML components
└── jobs/
    └── cleanup.ts          # setInterval cleanup for expired shares, requests, sessions

public/
├── style.css               # Pico CSS overrides, tabs, share-url, previews, utilities
└── client.js               # Tab switching, clipboard, fragment-based decryption,
                            # WebAuthn browser ceremonies, file preview rendering

data/                       # Runtime directory (gitignored)
├── shareque.db             # SQLite database
└── uploads/{YYYY-MM}/*.enc # Encrypted file storage
```

## Database Schema (7 tables)
1. **admin_config** - Single-row: admin TOTP secret, webauthn flag, tfa_setup_complete
2. **users** - id, name, email, password_hash, totp_secret, tfa_method, invite_token, invite_expires_at
3. **webauthn_credentials** - credential_id, user_id (nullable for admin), is_admin, public_key, counter, transports
4. **sessions** - id (random 64-hex), user_id (nullable for admin), is_admin, tfa_verified, expires_at
5. **shares** - id (nanoid 12), user_id, type, encrypted_data/file_path, iv, auth_tag, encryption_key, password_hash, max_views, view_count, is_consumed, expires_at
6. **upload_requests** - id, token (nanoid 16), user_id, is_consumed, expires_at
7. **user_preferences** - user_id, per-type settings for password/ttl/one-time

## Key Architecture Decisions

### Encryption Flow
- Server generates random 32-byte key per share, encrypts with AES-256-GCM
- Key is base64url-encoded and placed in URL fragment (`#`): never sent to server in HTTP requests
- View page: JS reads `location.hash`, sends key to server via POST body for decryption
- Server decrypts and returns plaintext content

### Password-Protected Shares
- Password bcrypt hash stored in DB for verification
- On view: verify password first, then decrypt with URL key
- One-time shares: consumed via atomic SQL `UPDATE ... SET view_count=view_count+1, is_consumed=CASE... RETURNING *`

### File Storage
- Encrypted files stored at `data/uploads/{YYYY-MM}/{shareId}.enc`
- Original filename, MIME type, size stored in DB
- Smart preview: images as `<img>`, video as `<video>`, audio as `<audio>`, text as `<pre>`, else download

### Request Data Flow
1. User creates upload request -> gets `/upload/{token}` link
2. External person opens link, uploads text or file
3. System encrypts upload, generates random password, creates share
4. System emails requesting user: view link + generated password
5. Upload link is consumed (one-time)

### Admin Auth
- Password from .env -> 2FA (TOTP or WebAuthn)
- First login: forced 2FA setup
- .env is deleted after values loaded into memory

## Route Map
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET/POST | `/manage/login` | None | Admin password login |
| GET/POST | `/manage/setup-2fa` | Admin session | First-time 2FA config |
| GET/POST | `/manage/verify-2fa` | Admin session | 2FA verification |
| GET | `/manage` | Admin+2FA | User management dashboard |
| POST | `/manage/invite` | Admin+2FA | Create user + send invite email |
| POST | `/manage/delete/:id` | Admin+2FA | Delete user + cascade data |
| GET/POST | `/login` | None | User email+password login |
| POST | `/logout` | Session | Destroy session |
| GET/POST | `/set-password/:token` | None | Set password from invite link |
| GET/POST | `/setup-2fa` | Session | 2FA setup (TOTP QR or WebAuthn) |
| GET/POST | `/verify-2fa` | Session | 2FA verification |
| GET | `/dashboard` | User+2FA | Main dashboard with tabs |
| POST | `/share/text` | User+2FA | Create text share |
| POST | `/share/file` | User+2FA | Create file share |
| POST | `/request-data` | User+2FA | Create upload request |
| GET | `/view/:id` | None | View page shell |
| POST | `/view/:id/content` | None | Decrypt + return content |
| POST | `/view/:id/delete` | None | Delete share |
| GET/POST | `/upload/:token` | None | Public upload form |
| POST | `/api/webauthn/*` | Session | WebAuthn registration/auth |
| POST | `/manage/api/webauthn/*` | Admin session | Admin WebAuthn |

## Environment Variables
See `.env.example` for all variables. Key ones:
- `ADMIN_PASSWORD` - Required, admin login password
- `PORT` / `HOST` / `BASE_URL` - Server config
- `SMTP_*` - Email sending config
- `WEBAUTHN_*` - WebAuthn relying party config
- `CLEANUP_INTERVAL` - Minutes between cleanup runs (default: 5)
- `MAX_FILE_SIZE` - Max upload in MB (default: 100)
