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
      key_verification TEXT NOT NULL,
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
  `);
}

export function runMigrations() {
  // Check if old schema has encryption_key column
  const tableInfo = db.query<{ name: string }, []>("PRAGMA table_info(shares)").all();
  const hasEncryptionKey = tableInfo.some((col) => col.name === "encryption_key");

  if (hasEncryptionKey) {
    console.log("[migration] Migrating shares table: removing encryption_key and password_hash columns");

    db.exec("UPDATE shares SET is_consumed = 1");

    db.exec(`CREATE TABLE shares_new (
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
      key_verification TEXT NOT NULL DEFAULT '',
      has_password INTEGER NOT NULL DEFAULT 0,
      max_views INTEGER,
      view_count INTEGER NOT NULL DEFAULT 0,
      is_consumed INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    db.exec(`INSERT INTO shares_new (id, user_id, type, encrypted_data, file_path, file_name, file_mime, file_size, iv, auth_tag, key_verification, has_password, max_views, view_count, is_consumed, expires_at, created_at)
      SELECT id, user_id, type, encrypted_data, file_path, file_name, file_mime, file_size, iv, auth_tag, '', has_password, max_views, view_count, 1, expires_at, created_at FROM shares`);

    db.exec("DROP TABLE shares");
    db.exec("ALTER TABLE shares_new RENAME TO shares");

    console.log("[migration] Shares table migrated. Old shares marked as consumed.");
  }

  // Drop user_preferences table if it exists
  const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='user_preferences'").all();
  if (tables.length > 0) {
    console.log("[migration] Dropping user_preferences table (moved to signed cookie)");
    db.exec("DROP TABLE user_preferences");
  }
}
