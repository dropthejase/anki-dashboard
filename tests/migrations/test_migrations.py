"""Applies the real migration files to a scratch SQLite database, the way D1 would, with foreign keys on."""

import sqlite3
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[2] / "migrations"


def apply(db, name):
    db.executescript((MIGRATIONS / name).read_text())


def fresh():
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys = ON")
    return db


def test_device_migration_keeps_every_existing_row_and_turns_each_key_into_a_device():
    db = fresh()
    apply(db, "0001_init.sql")
    apply(db, "0002_recovery.sql")
    db.executescript(
        """
        INSERT INTO users (id, secret_hash, display_name, created_at, last_active_date, recovery_hash, recovery_created_at)
          VALUES ('u1', 'hash-one', 'One', 100, '2026-11-24', 'rec1', 150), ('u2', 'hash-two', 'Two', 200, '2026-11-24', NULL, NULL);
        INSERT INTO boards (id, name, created_at) VALUES ('b1', 'Board', 1);
        INSERT INTO memberships (board_id, user_id, role, joined_at) VALUES ('b1', 'u1', 'admin', 1), ('b1', 'u2', 'member', 2);
        INSERT INTO daily_stats (user_id, local_date, review_count, updated_at) VALUES ('u1', '2026-11-24', 50, 1), ('u2', '2026-11-24', 70, 2);
        INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES ('s1', 'u1', 1, 9999999999999);
        INSERT INTO login_links (token_hash, user_id, expires_at) VALUES ('l1', 'u2', 9999999999999);
        """
    )
    apply(db, "0003_devices.sql")

    assert db.execute("SELECT id, display_name, recovery_hash FROM users ORDER BY id").fetchall() == [("u1", "One", "rec1"), ("u2", "Two", None)]
    assert db.execute("SELECT COUNT(*) FROM memberships").fetchone()[0] == 2
    assert db.execute("SELECT user_id, review_count FROM daily_stats ORDER BY user_id").fetchall() == [("u1", 50), ("u2", 70)]
    assert db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 1
    assert db.execute("SELECT COUNT(*) FROM login_links").fetchone()[0] == 1
    assert db.execute("SELECT user_id, secret_hash, label FROM devices ORDER BY user_id").fetchall() == [
        ("u1", "hash-one", "Original computer"),
        ("u2", "hash-two", "Original computer"),
    ]
    assert "secret_hash" not in [row[1] for row in db.execute("PRAGMA table_info(users)")]
    assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    assert not [r for r in db.execute("SELECT name FROM sqlite_master WHERE name LIKE '\\_keep%' ESCAPE '\\'")]


def test_the_rebuilt_tables_still_cascade_and_stay_unique():
    db = fresh()
    for name in ("0001_init.sql", "0002_recovery.sql", "0003_devices.sql"):
        apply(db, name)
    db.executescript(
        """
        INSERT INTO users (id, display_name, created_at, last_active_date) VALUES ('u1', 'One', 1, '2026-11-24');
        INSERT INTO devices (id, user_id, secret_hash, label, created_at) VALUES ('d1', 'u1', 'h1', 'A', 1);
        INSERT INTO link_codes (code_hash, user_id, expires_at) VALUES ('c1', 'u1', 5);
        """
    )
    try:
        db.execute("INSERT INTO devices (id, user_id, secret_hash, label, created_at) VALUES ('d2', 'u1', 'h1', 'B', 1)")
        raise AssertionError("two devices shared a key")
    except sqlite3.IntegrityError:
        pass
    db.execute("DELETE FROM users WHERE id = 'u1'")
    assert db.execute("SELECT COUNT(*) FROM devices").fetchone()[0] == 0
    assert db.execute("SELECT COUNT(*) FROM link_codes").fetchone()[0] == 0


def test_a_new_database_gets_the_same_final_shape():
    db = fresh()
    for name in sorted(p.name for p in MIGRATIONS.glob("*.sql")):
        apply(db, name)
    cols = [row[1] for row in db.execute("PRAGMA table_info(users)")]
    assert cols == ["id", "display_name", "created_at", "last_active_date", "last_push_at", "recovery_hash", "recovery_created_at"]
