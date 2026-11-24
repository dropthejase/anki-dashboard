-- A recovery code lets someone restore their account after losing the identity secret.
-- Only a hash of the code is stored, like every other token here. The code is shown to its owner once.
ALTER TABLE users ADD COLUMN recovery_hash TEXT;
ALTER TABLE users ADD COLUMN recovery_created_at INTEGER;
CREATE UNIQUE INDEX users_recovery ON users (recovery_hash) WHERE recovery_hash IS NOT NULL;
