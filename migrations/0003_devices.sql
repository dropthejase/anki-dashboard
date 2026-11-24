-- Each computer now has its own key, and an account can have several computers.
-- Existing accounts keep working: the single key they had becomes their first computer's key.
-- link_codes holds the short codes used to add a computer to an account. Only hashes are stored.

CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret_hash  TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER
) STRICT;
CREATE INDEX devices_user ON devices (user_id);

CREATE TABLE link_codes (
  code_hash  TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
) STRICT;
CREATE INDEX link_codes_user ON link_codes (user_id);

INSERT INTO devices (id, user_id, secret_hash, label, created_at)
  SELECT lower(hex(randomblob(16))), id, secret_hash, 'Original computer', created_at FROM users;

-- users.secret_hash is no longer used. SQLite cannot drop a UNIQUE column, so rebuild the table.
-- Dropping users also deletes the rows that reference it, so keep copies and put them back.
CREATE TABLE _keep_daily_stats AS SELECT * FROM daily_stats;
CREATE TABLE _keep_memberships AS SELECT * FROM memberships;
CREATE TABLE _keep_sessions AS SELECT * FROM sessions;
CREATE TABLE _keep_login_links AS SELECT * FROM login_links;
CREATE TABLE _keep_devices AS SELECT * FROM devices;

CREATE TABLE users_new (
  id                  TEXT PRIMARY KEY,
  display_name        TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  last_active_date    TEXT NOT NULL,
  last_push_at        INTEGER,
  recovery_hash       TEXT,
  recovery_created_at INTEGER
) STRICT;
INSERT INTO users_new SELECT id, display_name, created_at, last_active_date, last_push_at, recovery_hash, recovery_created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE UNIQUE INDEX users_recovery ON users (recovery_hash) WHERE recovery_hash IS NOT NULL;

INSERT INTO daily_stats SELECT * FROM _keep_daily_stats;
INSERT INTO memberships SELECT * FROM _keep_memberships;
INSERT INTO sessions SELECT * FROM _keep_sessions;
INSERT INTO login_links SELECT * FROM _keep_login_links;
INSERT INTO devices SELECT * FROM _keep_devices;

DROP TABLE _keep_daily_stats;
DROP TABLE _keep_memberships;
DROP TABLE _keep_sessions;
DROP TABLE _keep_login_links;
DROP TABLE _keep_devices;
