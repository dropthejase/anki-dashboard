import http.server
import sqlite3
import threading
from datetime import date, datetime

import pytest

from core import (
    COUNT_SQL,
    STATE_KEY,
    SECRET_KEY,
    HttpTransport,
    Leaderboard,
    ServerError,
    anki_day,
    default_display_name,
    count_reviews,
)

CUTOFF = 1_800_000_000  # arbitrary day cutoff, seconds


def revlog(rows):
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE revlog (id INTEGER PRIMARY KEY, cid INTEGER, type INTEGER)")
    db.executemany("INSERT INTO revlog (id, cid, type) VALUES (?, 1, ?)", rows)
    return db


class TestCount:
    def test_counts_only_the_current_anki_day(self):
        start_ms = (CUTOFF - 86400) * 1000
        db = revlog([(start_ms - 1, 1), (start_ms, 1), (start_ms + 1, 1), (CUTOFF * 1000 - 1, 0)])
        # id > start is exclusive, matching Anki.
        assert count_reviews(db, CUTOFF) == 2

    def test_excludes_manual_and_rescheduled_entries(self):
        t = (CUTOFF - 3600) * 1000
        db = revlog([(t + i, ty) for i, ty in enumerate([0, 1, 2, 3, 4, 5, 5, 4])])
        assert count_reviews(db, CUTOFF) == 4  # learning, review, relearning, filtered

    def test_counts_every_answer_not_unique_cards(self):
        t = (CUTOFF - 100) * 1000
        db = revlog([(t, 1), (t + 1, 1), (t + 2, 1)])  # same card answered three times
        assert count_reviews(db, CUTOFF) == 3

    def test_empty_collection(self):
        assert count_reviews(revlog([]), CUTOFF) == 0

    def test_sql_is_the_documented_one(self):
        assert "type != 4" in COUNT_SQL and "type != 5" in COUNT_SQL


def test_anki_day_is_the_date_the_day_started():
    assert anki_day(CUTOFF) == date.fromtimestamp(CUTOFF - 86400).isoformat()


class FakeAdapter:
    def __init__(self, count=10, secret=None, day="2026-10-25"):
        self.config = {SECRET_KEY: secret} if secret else {}
        self.local = {}
        self.count, self.day = count, day

    def get_config(self, k): return self.config.get(k)
    def set_config(self, k, v): self.config[k] = v
    def get_local(self, k): return self.local.get(k)
    def set_local(self, k, v): self.local[k] = v
    def today(self): return self.day, self.count
    def profile_name(self): return "User 1"


class FakeTransport:
    """Scripted server: a dict of path -> list of (status, body) responses, consumed in order."""

    def __init__(self, script):
        self.script, self.calls = script, []

    def post(self, path, secret, body):
        self.calls.append((path, secret, body))
        r = self.script[path].pop(0)
        if isinstance(r, Exception):
            raise r
        return r


GOOD_SECRET = "A" * 43


def board(adapter, script):
    t = FakeTransport(script)
    return Leaderboard(adapter, t, "https://lb.example"), t


class TestIdentity:
    def test_creates_a_secret_only_in_the_sync_hook_and_only_if_none_exists(self):
        a = FakeAdapter()
        lb, t = board(a, {"/api/sync": [(200, {"ok": True})]})
        assert lb.secret() is None
        lb.on_sync_finished()
        s = a.config[SECRET_KEY]
        assert len(s) == 43 and lb.secret() == s

    def test_adopts_an_existing_synced_secret(self):
        a = FakeAdapter(secret=GOOD_SECRET)
        lb, _ = board(a, {"/api/sync": [(200, {"ok": True})]})
        lb.on_sync_finished()
        assert a.config[SECRET_KEY] == GOOD_SECRET

    def test_no_identity_is_created_by_push_or_sign_in(self):
        a = FakeAdapter()
        lb, t = board(a, {})
        assert lb.push().ok is False
        assert lb.sign_in_url()[0] is None
        assert SECRET_KEY not in a.config and t.calls == []

    def test_a_malformed_stored_secret_is_ignored(self):
        a = FakeAdapter(secret="short")
        lb, _ = board(a, {})
        assert lb.secret() is None

    def test_reset_rotates_and_stores_the_new_secret_only_on_success(self):
        a = FakeAdapter(secret=GOOD_SECRET)
        lb, t = board(a, {"/api/identity/rotate": [(500, {})]})
        assert lb.reset_identity().ok is False
        assert a.config[SECRET_KEY] == GOOD_SECRET
        lb, t = board(a, {"/api/identity/rotate": [(200, {"ok": True})]})
        assert lb.reset_identity().ok is True
        assert a.config[SECRET_KEY] != GOOD_SECRET
        assert t.calls[0][2]["new_secret"] == a.config[SECRET_KEY]


class TestPush:
    def test_registers_on_first_use_then_retries_the_sync(self):
        a = FakeAdapter(secret=GOOD_SECRET, count=7)
        lb, t = board(a, {
            "/api/sync": [(401, {"error": "unknown_identity"}), (200, {"ok": True})],
            "/api/register": [(201, {"user_id": "abc", "display_name": "User 1"})],
        })
        assert lb.push().ok
        assert [c[0] for c in t.calls] == ["/api/sync", "/api/register", "/api/sync"]
        assert t.calls[1][2] == {"display_name": "User 1"}

    def test_skips_the_network_when_nothing_changed(self):
        a = FakeAdapter(secret=GOOD_SECRET, count=7)
        lb, t = board(a, {"/api/sync": [(200, {"ok": True})]})
        lb.push()
        assert lb.push().ok and len(t.calls) == 1
        a.count = 8
        lb.t.script["/api/sync"].append((200, {"ok": True}))
        lb.push()
        assert len(t.calls) == 2

    def test_manual_sync_forces_a_push(self):
        a = FakeAdapter(secret=GOOD_SECRET)
        lb, t = board(a, {"/api/sync": [(200, {}), (200, {})]})
        lb.push(); lb.push(force=True)
        assert len(t.calls) == 2

    def test_a_failed_push_is_retried_next_time(self):
        a = FakeAdapter(secret=GOOD_SECRET)
        lb, t = board(a, {"/api/sync": [ServerError("network"), (200, {})]})
        assert lb.push().ok is False and a.local.get(STATE_KEY) is None
        assert lb.push().ok is True

    def test_rate_limit_response_is_reported_and_not_recorded(self):
        a = FakeAdapter(secret=GOOD_SECRET)
        lb, _ = board(a, {"/api/sync": [(429, {"error": "too_soon"})]})
        r = lb.push()
        assert not r.ok and "5 minutes" in r.message and a.local.get(STATE_KEY) is None

    def test_sends_the_anki_day_and_count(self):
        a = FakeAdapter(secret=GOOD_SECRET, count=33, day="2026-10-24")
        lb, t = board(a, {"/api/sync": [(200, {})]})
        lb.push()
        assert t.calls[0] == ("/api/sync", GOOD_SECRET, {"local_date": "2026-10-24", "review_count": 33})


class TestHostileServer:
    @pytest.mark.parametrize("token", [None, 5, "", "short", "x" * 23, "../../etc/passwd" + "a" * 6, "<script>alert(1)</script>"[:22], {"a": 1}])
    def test_rejects_malformed_login_tokens(self, token):
        a = FakeAdapter(secret=GOOD_SECRET)
        lb, _ = board(a, {"/api/login-link": [(201, {"token": token})]})
        url, msg = lb.sign_in_url()
        assert url is None and msg

    def test_ignores_server_supplied_urls(self):
        a = FakeAdapter(secret=GOOD_SECRET)
        tok = "B" * 22
        lb, _ = board(a, {"/api/login-link": [(201, {"token": tok, "url": "https://evil.example/x", "open": "file:///etc"})]})
        assert lb.sign_in_url() == (f"https://lb.example/signin#{tok}", "")

    def test_non_201_login_response_is_not_trusted(self):
        a = FakeAdapter(secret=GOOD_SECRET)
        lb, _ = board(a, {"/api/login-link": [(200, {"token": "B" * 22})]})
        assert lb.sign_in_url()[0] is None

    def test_network_errors_become_messages_not_exceptions(self):
        a = FakeAdapter(secret=GOOD_SECRET)
        lb, _ = board(a, {"/api/login-link": [ServerError("network")]})
        assert lb.sign_in_url()[0] is None


class TestTransport:
    def test_requires_https_except_for_localhost(self):
        HttpTransport("https://example.com")
        HttpTransport("http://localhost:8787")
        for bad in ("http://example.com", "ftp://example.com", "javascript:alert(1)", ""):
            with pytest.raises(ValueError):
                HttpTransport(bad)


class TestRedirects:
    def test_a_redirect_is_an_error_and_never_forwards_the_secret(self):
        seen = []

        class Target(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                seen.append(self.headers.get("Authorization"))
                self.send_response(200)
                self.send_header("Content-Length", "0")
                self.end_headers()

            do_POST = do_GET

            def log_message(self, *a):
                pass

        target = http.server.HTTPServer(("127.0.0.1", 0), Target)

        class Redirector(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.send_response(302)
                self.send_header("Location", f"http://127.0.0.1:{target.server_port}/steal")
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *a):
                pass

        redirector = http.server.HTTPServer(("127.0.0.1", 0), Redirector)
        threads = [threading.Thread(target=s.serve_forever, daemon=True) for s in (target, redirector)]
        for t in threads:
            t.start()
        try:
            transport = HttpTransport(f"http://127.0.0.1:{redirector.server_port}")
            with pytest.raises(ServerError):
                transport.post("/api/sync", "s" * 43, {})
            assert seen == []
        finally:
            for s in (target, redirector):
                s.shutdown()
                s.server_close()


class TestDefaultDisplayName:
    @pytest.mark.parametrize(
        "raw, expected",
        [
            ("Jason", "Jason"),
            ("<Jason>", "Jason"),
            ("  Jason \t Lee  ", "Jason Lee"),
            ("Ja\u202eson\x00", "Jason"),  # bidi override and a control character
            ("", "Anki user"),
            ("<>", "Anki user"),
            ("x" * 80, "x" * 30),
            ("Z" + "\u0300\u0301\u0302\u0303\u0304" + "a", "Z\u0300\u0301\u0302a"),  # marks capped at three
            ("José", "José"),
            ("日本語", "日本語"),
        ],
    )
    def test_cleans_what_the_server_would_refuse(self, raw, expected):
        assert default_display_name(raw) == expected
