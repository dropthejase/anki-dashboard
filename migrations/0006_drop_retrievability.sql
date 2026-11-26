-- Average retrievability is no longer shared (it only exists with FSRS), so the column is not needed.
ALTER TABLE users DROP COLUMN stats_retrievability;
