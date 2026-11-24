-- All timestamps are Unix milliseconds. Dates are 'YYYY-MM-DD' text.
-- Every token stored here is a SHA-256 hash; plaintext is never persisted.

CREATE TABLE users (
  id               TEXT PRIMARY KEY,
  secret_hash      TEXT NOT NULL UNIQUE,
  display_name     TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  last_active_date TEXT NOT NULL,
  last_push_at     INTEGER
) STRICT;

CREATE TABLE daily_stats (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date   TEXT NOT NULL,
  review_count INTEGER NOT NULL CHECK (review_count BETWEEN 0 AND 10000),
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, local_date)
) STRICT, WITHOUT ROWID;

CREATE TABLE boards (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  invite_enabled INTEGER NOT NULL DEFAULT 1,
  invite_epoch   INTEGER NOT NULL DEFAULT 0,
  member_cap     INTEGER,
  created_at     INTEGER NOT NULL
) STRICT;

CREATE TABLE memberships (
  board_id  TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (board_id, user_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX memberships_user ON memberships (user_id);

CREATE TABLE login_links (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
) STRICT;

CREATE TABLE sessions (
  id_hash    TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_user ON sessions (user_id);

-- Fixed-window counters keyed by a hash of (limit name, subject), so no IP addresses are stored.
CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
) STRICT;
