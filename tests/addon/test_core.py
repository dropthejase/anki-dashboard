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
    ADDON_VERSION,
    default_display_name,
    FileSecretStore,
    make_device_label,
    normalise_link_code,
    REGISTERED_KEY,
    normalise_recovery_code,
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
    def __init__(self, count=10, secret=None, day=None):
        self.config = {SECRET_KEY: secret} if secret else {}
        self.local = {}
        self.count, self.day = count, day or date.today().isoformat()

    # The key lives in `config` under SECRET_KEY so tests can read and set it directly.
    def get_config(self, k): return self.config.get(k)
    def set_config(self, k, v): self.config[k] = v
    def get_secret(self): return self.config.get(SECRET_KEY)
    def set_secret(self, v): self.config[SECRET_KEY] = v
    def clear_secret(self): self.config.pop(SECRET_KEY, None)
    def forget_legacy_secret(self): self.legacy_forgotten = True
    def device_label(self): return "User 1 (macOS)"
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
    def test_a_sync_never_creates_an_identity_or_touches_the_network_before_set_up(self):
        a = FakeAdapter()
        lb, t = board(a, {})
        result = lb.on_sync_finished()
        assert result.ok and result.message == ""
        assert lb.secret() is None and t.calls == [] and not lb.is_set_up()

    def test_setting_up_makes_one_key_and_never_replaces_it(self):
        a = FakeAdapter()
        lb, t = board(a, {})
        assert lb.set_up_first_computer().ok
        first = a.config[SECRET_KEY]
        assert len(first) == 43 and lb.is_set_up() and t.calls == []
        assert a.legacy_forgotten  # the old synced copy is removed
        lb.set_up_first_computer()
        assert a.config[SECRET_KEY] == first

    def test_an_existing_key_is_used_as_is(self):
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
        assert t.calls[1][2] == {"display_name": "User 1", "device_label": "User 1 (macOS)"}

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
        assert not r.ok and "30 minutes" in r.message and "get back to revising" in r.message and r.limited and a.local.get(STATE_KEY) is None

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


class TestReachability:
    def test_sends_a_named_user_agent_not_pythons_default(self):
        seen = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                seen.append(self.headers.get("User-Agent"))
                body = b"{}"
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            HttpTransport(f"http://127.0.0.1:{server.server_port}").post("/x", None, {})
        finally:
            server.shutdown()
            server.server_close()
        assert seen and seen[0].startswith("AnkiLeaderboard/") and "urllib" not in seen[0].lower()

    def test_a_non_json_block_page_names_the_http_status(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = b"error code: 1010"
                self.send_response(403)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with pytest.raises(ServerError, match="HTTP 403"):
                HttpTransport(f"http://127.0.0.1:{server.server_port}").post("/x", None, {})
        finally:
            server.shutdown()
            server.server_close()

    def test_failures_are_named_for_the_user(self):
        import socket
        import ssl
        import urllib.error

        from core import _reason

        assert _reason(urllib.error.URLError(ssl.SSLCertVerificationError("x"))) == "certificate problem"
        assert _reason(urllib.error.URLError(socket.gaierror(8, "x"))) == "address not found"
        assert _reason(TimeoutError()) == "timed out"
        assert _reason(urllib.error.URLError(ConnectionRefusedError())) == "connection refused"
        assert _reason(OSError("boom")) == "network error"

    def test_prefers_certifi_when_it_is_available(self, monkeypatch, tmp_path):
        import sys
        import types

        import core

        calls = []
        fake = types.ModuleType("certifi")
        fake.where = lambda: str(tmp_path / "bundle.pem")
        monkeypatch.setitem(sys.modules, "certifi", fake)
        monkeypatch.setattr(core.ssl, "create_default_context", lambda cafile=None: calls.append(cafile) or object())
        core._ssl_context()
        assert calls == [str(tmp_path / "bundle.pem")]

    def test_messages_say_why_the_server_was_unreachable(self):
        a = FakeAdapter()
        a.set_config(SECRET_KEY, "s" * 43)
        lb, _ = board(a, {"/api/login-link": [ServerError("certificate problem")]})
        assert lb.sign_in_url() == (None, "Could not reach the leaderboard (certificate problem).")


class TestUpdateNotice:
    def _lb(self, latest, adapter=None):
        a = adapter or FakeAdapter()
        a.set_config(SECRET_KEY, "s" * 43)
        lb, _ = board(a, {"/api/sync": [(200, {"ok": True, "addon_latest": latest} if latest is not None else {"ok": True})]})
        return lb, a

    def test_a_newer_version_is_announced_with_our_own_link(self):
        lb, _ = self._lb("99.0.0")
        notice = lb.push().notice
        assert "99.0.0" in notice and notice.endswith(lb.base_url + "/help")

    def test_announced_once_per_release_but_always_on_a_manual_sync(self):
        a = FakeAdapter()
        a.set_config(SECRET_KEY, "s" * 43)
        lb, _ = board(a, {"/api/sync": [(200, {"addon_latest": "99.0.0"})] * 3})
        assert lb.push(force=True).notice
        assert lb.push(force=True).notice  # a manual sync repeats it
        assert lb.push().notice is None  # an automatic one already told the user

    @pytest.mark.parametrize("latest", [None, ADDON_VERSION, "0.0.1", "garbage", "1.2", "1.2.3.4", 5, "99.0.0; rm -rf /", "<script>"])
    def test_nothing_is_announced_for_the_same_older_or_invalid_versions(self, latest):
        lb, _ = self._lb(latest)
        assert lb.push().notice is None

    def test_the_user_agent_carries_the_version(self):
        from core import USER_AGENT

        assert USER_AGENT.startswith(f"AnkiLeaderboard/{ADDON_VERSION} ")


class TestRestoreIdentity:
    CODE = "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567"
    FRESH = "BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH-JJJJ"

    def _lb(self, reply, adapter=None):
        a = adapter or FakeAdapter()
        lb, t = board(a, {"/api/recover": [reply]})
        return lb, a, t

    @pytest.mark.parametrize("raw", ["ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567", "abcd efgh ijkl mnop qrst uvwx yz23 4567", "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", "  ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567\n"])
    def test_accepts_the_code_as_typed(self, raw):
        assert normalise_recovery_code(raw) == "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

    @pytest.mark.parametrize("raw", ["", "short", None, 5, "ABCD-EFGH", "1" * 32, "A" * 33, "A" * 500, "<script>" + "A" * 24])
    def test_rejects_anything_that_cannot_be_a_code(self, raw):
        assert normalise_recovery_code(raw) is None

    def test_a_good_code_stores_the_new_secret_and_returns_the_fresh_code(self):
        lb, a, t = self._lb((200, {"ok": True, "recovery_code": self.FRESH}))
        a.set_local(STATE_KEY, ["2026-11-23", 5])
        result = lb.restore_identity(self.CODE.lower())
        assert result.ok and result.recovery_code == self.FRESH
        path, secret, body = t.calls[0]
        assert path == "/api/recover" and secret is None  # no old secret is sent
        assert body["recovery_code"] == "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        assert a.config[SECRET_KEY] == body["new_secret"] and len(body["new_secret"]) == 43
        assert a.local.get(STATE_KEY) is None  # the next sync pushes again

    def test_a_refused_code_leaves_the_existing_secret_alone(self):
        a = FakeAdapter()
        a.set_config(SECRET_KEY, "o" * 43)
        lb, _, _ = self._lb((400, {"error": "invalid_recovery_code"}), a)
        result = lb.restore_identity(self.CODE)
        assert not result.ok and "not recognised" in result.message
        assert a.config[SECRET_KEY] == "o" * 43

    def test_a_malformed_code_never_reaches_the_network(self):
        lb, _, t = self._lb((200, {}))
        assert not lb.restore_identity("nonsense").ok
        assert t.calls == []

    def test_limits_and_outages_have_their_own_messages(self):
        assert "Too many attempts" in self._lb((429, {}))[0].restore_identity(self.CODE).message
        assert "Could not reach" in self._lb(ServerError("timed out"))[0].restore_identity(self.CODE).message
        assert "could not restore" in self._lb((500, {}))[0].restore_identity(self.CODE).message

    def test_if_the_fresh_code_is_missing_the_new_secret_is_still_kept(self):
        a = FakeAdapter()
        lb, _, _ = self._lb((200, {"ok": True, "recovery_code": "<script>"}), a)
        result = lb.restore_identity(self.CODE)
        assert result.ok and result.recovery_code is None and "Account page" in result.message
        assert len(a.config[SECRET_KEY]) == 43  # the server already switched, so we must keep the new secret


class TestRemovedComputer:
    """A computer the server has forgotten must not quietly start a new account."""

    def _lb(self, registered, script):
        a = FakeAdapter(secret=GOOD_SECRET)
        a.local[REGISTERED_KEY] = registered
        lb, t = board(a, script)
        return lb, a, t

    def test_a_computer_never_accepted_registers_itself_once(self):
        lb, a, t = self._lb(False, {"/api/sync": [(401, {"error": "unknown_identity"}), (200, {})], "/api/register": [(201, {"user_id": "u"})]})
        assert lb.push().ok
        assert a.local[REGISTERED_KEY] is True
        assert [c[0] for c in t.calls] == ["/api/sync", "/api/register", "/api/sync"]

    def test_a_removed_computer_forgets_its_key_instead_of_registering(self):
        lb, a, t = self._lb(True, {"/api/sync": [(401, {"error": "unknown_identity"})]})
        result = lb.push()
        assert not result.ok and "removed from your leaderboard account" in result.message
        assert SECRET_KEY not in a.config and a.local[REGISTERED_KEY] is False
        assert [c[0] for c in t.calls] == ["/api/sync"]  # no registration

    def test_the_same_guard_covers_sign_in_and_link_codes(self):
        lb, a, t = self._lb(True, {"/api/login-link": [(401, {"error": "unknown_identity"})]})
        url, message = lb.sign_in_url()
        assert url is None and "removed" in message and "/api/register" not in [c[0] for c in t.calls]
        lb, a, t = self._lb(True, {"/api/link-code": [(401, {"error": "unknown_identity"})]})
        assert "removed" in lb.make_link_code().message and SECRET_KEY not in a.config


class TestLinking:
    CODE = "abcd-efgh-jklm"

    def _lb(self, reply, adapter=None):
        a = adapter or FakeAdapter()
        lb, t = board(a, {"/api/link": [reply]})
        return lb, a, t

    @pytest.mark.parametrize("raw", ["ABCD-EFGH-JKLM", "abcd efgh jklm", "ABCDEFGHJKLM", " abcd-efgh-jklm\n"])
    def test_accepts_the_code_as_typed(self, raw):
        assert normalise_link_code(raw) == "ABCDEFGHJKLM"

    @pytest.mark.parametrize("raw", ["", "short", None, 7, "ABCD-EFGH", "1" * 12, "A" * 13, "A" * 99, "<script>aaaa"])
    def test_rejects_anything_that_cannot_be_a_code(self, raw):
        assert normalise_link_code(raw) is None

    def test_a_good_code_stores_a_new_key_and_marks_the_computer_known(self):
        lb, a, t = self._lb((201, {"ok": True}))
        a.local[STATE_KEY] = ["old", 1]
        assert lb.link_this_computer(self.CODE).ok
        path, secret, body = t.calls[0]
        assert path == "/api/link" and secret is None
        assert body["link_code"] == "ABCDEFGHJKLM" and body["device_label"] == "User 1 (macOS)"
        assert a.config[SECRET_KEY] == body["new_secret"] and len(body["new_secret"]) == 43
        assert a.local[REGISTERED_KEY] is True and a.local.get(STATE_KEY) is None

    def test_a_refused_code_leaves_any_existing_key_alone(self):
        a = FakeAdapter(secret=GOOD_SECRET)
        lb, _, _ = self._lb((400, {"error": "invalid_link_code"}), a)
        result = lb.link_this_computer(self.CODE)
        assert not result.ok and "expired" in result.message
        assert a.config[SECRET_KEY] == GOOD_SECRET

    def test_a_malformed_code_never_reaches_the_network(self):
        lb, _, t = self._lb((201, {}))
        assert not lb.link_this_computer("nonsense").ok and t.calls == []

    def test_limits_and_outages_have_their_own_messages(self):
        assert "Too many attempts" in self._lb((429, {}))[0].link_this_computer(self.CODE).message
        assert "most computers" in self._lb((409, {"error": "too_many_devices"}))[0].link_this_computer(self.CODE).message
        assert "Could not reach" in self._lb(ServerError("timed out"))[0].link_this_computer(self.CODE).message
        assert "could not link" in self._lb((500, {}))[0].link_this_computer(self.CODE).message

    def test_making_a_code_for_another_computer(self):
        a = FakeAdapter(secret=GOOD_SECRET)
        lb, t = board(a, {"/api/link-code": [(201, {"code": "ABCD-EFGH-JKLM", "expires_in_seconds": 600})]})
        result = lb.make_link_code()
        assert result.ok and result.link_code == "ABCD-EFGH-JKLM"
        assert t.calls[0][:2] == ("/api/link-code", GOOD_SECRET)

    def test_a_hostile_reply_is_not_shown_as_a_code(self):
        a = FakeAdapter(secret=GOOD_SECRET)
        for bad in ({"code": "<script>alert(1)</script>"}, {"code": 5}, {}):
            lb, _ = board(a, {"/api/link-code": [(201, bad)]})
            assert lb.make_link_code().link_code is None

    def test_a_computer_that_is_not_set_up_cannot_make_a_code(self):
        lb, t = board(FakeAdapter(), {})
        assert not lb.make_link_code().ok and t.calls == []


class TestKeyStorage:
    def test_round_trips_and_clears(self, tmp_path):
        store = FileSecretStore(tmp_path / "user_files" / "device_key")
        assert store.get() is None
        store.set("k" * 43)
        assert store.get() == "k" * 43
        store.set("n" * 43)
        assert store.get() == "n" * 43
        store.clear()
        store.clear()  # clearing twice is fine
        assert store.get() is None

    def test_the_file_is_private_to_the_user(self, tmp_path):
        import os
        import stat

        store = FileSecretStore(tmp_path / "key")
        store.set("k" * 43)
        if os.name == "posix":
            assert stat.S_IMODE(os.stat(tmp_path / "key").st_mode) == 0o600
        assert not (tmp_path / "key.tmp").exists()  # the temporary file is gone

    def test_an_unreadable_or_empty_file_counts_as_no_key(self, tmp_path):
        (tmp_path / "key").write_text("  \n")
        assert FileSecretStore(tmp_path / "key").get() is None
        assert FileSecretStore(tmp_path / "missing" / "key").get() is None


class TestDeviceLabel:
    @pytest.mark.parametrize(
        "profile, system, expected",
        [("Macbook", "Darwin", "Macbook (macOS)"), ("Work PC", "Windows", "Work PC (Windows)"), ("<b>x</b>", "Linux", "bx/b (Linux)"), ("", "Darwin", "Anki user (macOS)"), ("Pi", "Plan9", "Pi"), ("x" * 90, "Windows", "x" * 20 + " (Windows)")],
    )
    def test_is_short_clean_and_names_the_system(self, profile, system, expected):
        label = make_device_label(profile, system)
        assert label == expected and len(label) <= 30
