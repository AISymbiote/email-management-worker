-- Worker 版账号登录与自动云同步。
-- 注意：这里不创建任何邮件内容、邮件缓存或附件表。

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cloud_accounts (
  user_id TEXT NOT NULL,
  email_address TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'microsoft',
  group_name TEXT NOT NULL DEFAULT '默认分组',
  status TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  oauth_status TEXT NOT NULL DEFAULT '',
  oauth_email TEXT NOT NULL DEFAULT '',
  oauth_updated_at TEXT NOT NULL DEFAULT '',
  import_sequence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, email_address),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cloud_account_secrets (
  user_id TEXT NOT NULL,
  email_address TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  iv TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'AES-GCM-256',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, email_address),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  ip_hash TEXT NOT NULL DEFAULT '',
  success INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_cloud_accounts_user_sequence ON cloud_accounts(user_id, import_sequence);
CREATE INDEX IF NOT EXISTS idx_cloud_account_secrets_user ON cloud_account_secrets(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_email_created ON auth_login_attempts(email, created_at);
