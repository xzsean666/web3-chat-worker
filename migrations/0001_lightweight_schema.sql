-- Lightweight Web3 Chat Worker SQLite Schema

CREATE TABLE IF NOT EXISTS nonces (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nonces_wallet ON nonces(wallet_address);
CREATE INDEX IF NOT EXISTS idx_nonces_expires ON nonces(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nonces_wallet_nonce ON nonces(wallet_address, nonce);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('text', 'voice', 'image', 'file')),
  content TEXT,
  retention TEXT NOT NULL DEFAULT 'permanent' CHECK(retention IN ('permanent', 'on_read')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'delivered', 'read')),
  expires_at INTEGER NOT NULL,
  delivered_at INTEGER,
  read_at INTEGER,
  created_at INTEGER NOT NULL,
  recalled_at INTEGER,
  burn_after_seconds INTEGER DEFAULT 30,
  mentions TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_content ON messages(content);

CREATE TABLE IF NOT EXISTS message_receipts (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('delivered', 'read')),
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receipts_msg_user ON message_receipts(message_id, user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_msg_status ON message_receipts(message_id, status);

CREATE TABLE IF NOT EXISTS voice_messages (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL,
  duration REAL NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voice_msg ON voice_messages(message_id);

CREATE TABLE IF NOT EXISTS image_messages (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_msg ON image_messages(message_id);

CREATE TABLE IF NOT EXISTS file_messages (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_msg ON file_messages(message_id);
