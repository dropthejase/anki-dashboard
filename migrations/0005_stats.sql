-- Optional Anki statistics the add-on sends with a push. Kept on the user row that each push already updates,
-- so they cost no extra rows written. `stats_date` is the add-on's local date for the push.
ALTER TABLE users ADD COLUMN stats_date TEXT;
ALTER TABLE users ADD COLUMN stats_days INTEGER;
ALTER TABLE users ADD COLUMN stats_today_passed INTEGER;
ALTER TABLE users ADD COLUMN stats_today_failed INTEGER;
ALTER TABLE users ADD COLUMN stats_week_passed INTEGER;
ALTER TABLE users ADD COLUMN stats_week_failed INTEGER;
ALTER TABLE users ADD COLUMN stats_retrievability REAL;
