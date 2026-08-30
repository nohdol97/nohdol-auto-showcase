PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE consent_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  required_service INTEGER NOT NULL CHECK (required_service = 1),
  marketing INTEGER NOT NULL CHECK (marketing IN (0, 1)),
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE email_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_digest TEXT NOT NULL,
  required_service INTEGER NOT NULL CHECK (required_service = 1),
  marketing INTEGER NOT NULL CHECK (marketing IN (0, 1)),
  privacy_version TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX email_challenges_email_created ON email_challenges(email, created_at DESC);

CREATE TABLE sessions (
  token_digest TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX sessions_user_id ON sessions(user_id);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'collecting' CHECK (status IN ('collecting', 'review_ready', 'completed')),
  title TEXT NOT NULL DEFAULT '새 프로그램 문의',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  retention_expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX conversations_user_updated ON conversations(user_id, updated_at DESC);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  client_message_id TEXT,
  generation_status TEXT NOT NULL DEFAULT 'completed' CHECK (generation_status IN ('pending', 'completed', 'failed')),
  model TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  UNIQUE (conversation_id, client_message_id)
);
CREATE INDEX messages_conversation_created ON messages(conversation_id, created_at);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  openai_file_id TEXT,
  openai_expires_at TEXT,
  created_at TEXT NOT NULL,
  retention_expires_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX attachments_conversation ON attachments(conversation_id, created_at);

CREATE TABLE message_attachments (
  message_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  PRIMARY KEY (message_id, attachment_id),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
);

CREATE TABLE requirement_specs (
  conversation_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  ready_for_review INTEGER NOT NULL DEFAULT 0 CHECK (ready_for_review IN (0, 1)),
  spec_json TEXT NOT NULL,
  spec_markdown TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finalized_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE delivery_jobs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_class TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE rate_limits (
  limit_key TEXT NOT NULL,
  bucket_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (limit_key, bucket_start)
);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);
