import { db } from "./connection";

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      totp_secret TEXT,
      webauthn_enabled INTEGER NOT NULL DEFAULT 0,
      tfa_setup_complete INTEGER NOT NULL DEFAULT 0
    );

    INSERT OR IGNORE INTO admin_config (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      totp_secret TEXT,
      tfa_method TEXT DEFAULT NULL,
      invite_token TEXT UNIQUE,
      invite_expires_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      credential_id TEXT PRIMARY KEY,
      user_id TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      tfa_verified INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('text', 'file')),
      encrypted_data BLOB,
      file_path TEXT,
      file_name TEXT,
      file_mime TEXT,
      file_size INTEGER,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      encryption_key TEXT NOT NULL,
      password_hash TEXT,
      has_password INTEGER NOT NULL DEFAULT 0,
      max_views INTEGER,
      view_count INTEGER NOT NULL DEFAULT 0,
      is_consumed INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS upload_requests (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      is_consumed INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      text_use_password INTEGER NOT NULL DEFAULT 0,
      text_ttl_value INTEGER NOT NULL DEFAULT 24,
      text_ttl_unit TEXT NOT NULL DEFAULT 'hours',
      text_one_time INTEGER NOT NULL DEFAULT 0,
      file_use_password INTEGER NOT NULL DEFAULT 0,
      file_ttl_value INTEGER NOT NULL DEFAULT 24,
      file_ttl_unit TEXT NOT NULL DEFAULT 'hours',
      file_one_time INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}
