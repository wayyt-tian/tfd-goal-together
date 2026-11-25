-- 保留旧 credential 字段及所有历史；旧校验值不再参与正式登录。
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE departments ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE account_tokens (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, purpose TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX account_tokens_user ON account_tokens(user_id);
CREATE TABLE directory_imports (
  id TEXT PRIMARY KEY, actor INTEGER NOT NULL, revision INTEGER NOT NULL,
  contacts JSONB NOT NULL, summary JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  applied_at TIMESTAMPTZ
);
CREATE TABLE backups (
  id TEXT PRIMARY KEY, actor INTEGER, filename TEXT, label TEXT NOT NULL,
  status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), bytes BIGINT,
  error TEXT
);
CREATE INDEX audit_created ON audit(created_at DESC,id DESC);
CREATE INDEX backups_created ON backups(created_at DESC);
DELETE FROM sessions;
