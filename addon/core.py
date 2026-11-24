"""Leaderboard logic with no dependency on Anki, so it can be tested in isolation.

Everything Anki-specific lives behind the `Adapter` protocol (see `anki_adapter.py`).
"""

from __future__ import annotations

import json
import re
import secrets
import socket
import sqlite3
import ssl
import unicodedata
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date
from typing import Any, Optional, Protocol
from urllib.parse import urlparse

ADDON_VERSION = "0.2.0"  # keep in step with ADDON_LATEST_VERSION in wrangler.jsonc when releasing (docs/RELEASING.md)
SECRET_KEY = "leaderboard_secret"
STATE_KEY = "last_pushed"  # machine-local, never synced
NOTICE_KEY = "update_notice_for"  # machine-local: the newest version we already told the user about
MAX_RESPONSE_BYTES = 64 * 1024
# Cloudflare blocks Python's default "Python-urllib" User-Agent (error 1010), so say who we are.
USER_AGENT = f"AnkiLeaderboard/{ADDON_VERSION} (+https://github.com/dropthejase/anki-dashboard)"
LINK_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{22}$")
SECRET_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")

# Matches Anki's own "Today" statistic: every answer since the day cutoff, excluding
# manual (4) and rescheduled (5) entries. Source: rslib/src/storage/revlog/studied_today.sql
COUNT_SQL = "SELECT COUNT() FROM revlog WHERE id > ? AND type != 4 AND type != 5"


def count_reviews(db: sqlite3.Connection, day_cutoff: int) -> int:
    """`day_cutoff` is the Unix time (seconds) at which the next Anki day starts."""
    return int(db.execute(COUNT_SQL, ((day_cutoff - 86400) * 1000,)).fetchone()[0])


MAX_NAME_CHARS = 30
MAX_STACKED_MARKS = 3


def default_display_name(raw: str) -> str:
    """Turns an Anki profile name into something the server will accept, so registration never fails on a name.

    Drops control and invisible characters and angle brackets, limits stacked combining marks, collapses
    whitespace and caps the length. The server applies the same rules and is the authority.
    """
    text = unicodedata.normalize("NFC", raw or "")
    kept: list[str] = []
    marks = 0
    for ch in text:
        if ch in "<>" or unicodedata.category(ch).startswith("C"):
            continue
        if unicodedata.category(ch).startswith("M"):
            marks += 1
            if marks > MAX_STACKED_MARKS:
                continue
        else:
            marks = 0
        kept.append(ch)
    name = " ".join("".join(kept).split())[:MAX_NAME_CHARS].strip()
    return name or "Anki user"


def anki_day(day_cutoff: int) -> str:
    """The calendar date on which the current Anki day began, in local time."""
    return date.fromtimestamp(day_cutoff - 86400).isoformat()


class Adapter(Protocol):
    def get_config(self, key: str) -> Any: ...
    def set_config(self, key: str, value: Any) -> None: ...
    def get_local(self, key: str) -> Any: ...
    def set_local(self, key: str, value: Any) -> None: ...
    def today(self) -> tuple[str, int]:
        """Returns (local date, review count) for the current Anki day."""
    def profile_name(self) -> str: ...


class Transport(Protocol):
    def post(self, path: str, secret: str | None, body: dict) -> tuple[int, dict]: ...


class ServerError(Exception):
    """A failed call. The text is a short reason that can be shown to the user."""


def _reason(e: BaseException) -> str:
    """Names why a request failed, without leaking details such as addresses."""
    chain = []
    cur: BaseException | None = e
    while cur is not None and cur not in chain:
        chain.append(cur)
        cur = cur.reason if isinstance(cur, urllib.error.URLError) and isinstance(cur.reason, BaseException) else cur.__cause__
    if any(isinstance(x, ssl.SSLCertVerificationError) for x in chain):
        return "certificate problem"
    if any(isinstance(x, socket.gaierror) for x in chain):
        return "address not found"
    if any(isinstance(x, (TimeoutError, socket.timeout)) for x in chain):
        return "timed out"
    if any(isinstance(x, ConnectionRefusedError) for x in chain):
        return "connection refused"
    return "network error"


def _ssl_context() -> ssl.SSLContext:
    """Anki ships certifi's certificate bundle. Prefer it, because some Python builds ship no trusted roots."""
    try:
        import certifi  # type: ignore[import-not-found]

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """The server never redirects. Following one would forward the Authorization header (our identity secret)
    to wherever it points, possibly over plain http, so any redirect is treated as an error instead."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


class HttpTransport:
    def __init__(self, base_url: str):
        u = urlparse(base_url)
        local = u.hostname in ("localhost", "127.0.0.1")
        if u.scheme != "https" and not (u.scheme == "http" and local):
            raise ValueError("server_url must be https")
        self.base = base_url.rstrip("/")
        self._ctx = _ssl_context()  # verifies certificates and hostnames
        self._opener = urllib.request.build_opener(_NoRedirect, urllib.request.HTTPSHandler(context=self._ctx))

    def post(self, path: str, secret: str | None, body: dict) -> tuple[int, dict]:
        headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
        if secret:
            headers["Authorization"] = f"Bearer {secret}"
        req = urllib.request.Request(
            self.base + path, data=json.dumps(body).encode(), headers=headers, method="POST"
        )
        try:
            try:
                with self._opener.open(req, timeout=10) as r:
                    status, raw = r.status, r.read(MAX_RESPONSE_BYTES + 1)
            except urllib.error.HTTPError as e:
                status, raw = e.code, e.read(MAX_RESPONSE_BYTES + 1)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise ServerError(_reason(e)) from e
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ServerError("reply too large")
        try:
            data = json.loads(raw)
        except ValueError as e:
            raise ServerError(f"unexpected reply, HTTP {status}") from e
        if not isinstance(data, dict):
            raise ServerError(f"unexpected reply, HTTP {status}")
        return status, data


@dataclass
class Result:
    ok: bool
    message: str
    notice: Optional[str] = None  # shown separately, for example "a newer add-on is available"


VERSION_RE = re.compile(r"^\d{1,4}\.\d{1,4}\.\d{1,4}$")


def _version(text: Any) -> Optional[tuple[int, ...]]:
    return tuple(int(p) for p in text.split(".")) if isinstance(text, str) and VERSION_RE.match(text) else None


class Leaderboard:
    def __init__(self, adapter: Adapter, transport: Transport, base_url: str):
        self.a = adapter
        self.t = transport
        self.base_url = base_url.rstrip("/")

    # --- identity -------------------------------------------------------------------------
    def secret(self) -> Optional[str]:
        s = self.a.get_config(SECRET_KEY)
        return s if isinstance(s, str) and SECRET_RE.match(s) else None

    def on_sync_finished(self) -> Result:
        """Called from the `sync_did_finish` hook. The only place a new identity is created, so a
        second machine always adopts the secret that the sync just delivered."""
        if self.secret() is None:
            self.a.set_config(SECRET_KEY, secrets.token_urlsafe(32))
        return self.push()

    def reset_identity(self) -> Result:
        old = self.secret()
        if old is None:
            return Result(False, "Sync Anki first.")
        new = secrets.token_urlsafe(32)
        try:
            status, _ = self.t.post("/api/identity/rotate", old, {"new_secret": new})
        except ServerError as e:
            return Result(False, f"Could not reach the leaderboard ({e}).")
        if status != 200:
            return Result(False, "The leaderboard refused the reset.")
        self.a.set_config(SECRET_KEY, new)
        self.a.set_local(STATE_KEY, None)
        return Result(True, "Leaderboard identity reset. Sync Anki to share the new identity with your other computers.")

    # --- pushing counts -------------------------------------------------------------------
    def _register(self, secret: str) -> bool:
        status, data = self.t.post("/api/register", secret, {"display_name": default_display_name(self.a.profile_name())})
        return status in (200, 201) and isinstance(data.get("user_id"), str)

    def push(self, force: bool = False) -> Result:
        secret = self.secret()
        if secret is None:
            return Result(False, "Sync Anki first so the leaderboard can create your identity.")
        local_date, count = self.a.today()
        if not force and self.a.get_local(STATE_KEY) == [local_date, count]:
            return Result(True, "Leaderboard already up to date.")
        body = {"local_date": local_date, "review_count": count}
        try:
            status, data = self.t.post("/api/sync", secret, body)
            if status == 401 and data.get("error") == "unknown_identity":
                if not self._register(secret):
                    return Result(False, "Could not register with the leaderboard.")
                status, data = self.t.post("/api/sync", secret, body)
        except ServerError as e:
            return Result(False, f"Could not reach the leaderboard ({e}). It will retry after your next sync.")
        if status == 200:
            self.a.set_local(STATE_KEY, [local_date, count])
            return Result(True, f"Leaderboard updated: {count} reviews today.", self._update_notice(data.get("addon_latest"), force))
        if status == 429:
            return Result(False, "Leaderboard updates are limited to one every 5 minutes. Try again shortly.")
        return Result(False, "The leaderboard could not accept the update.")

    def _update_notice(self, latest: Any, always: bool) -> Optional[str]:
        """Tells the user once per release when the server reports a newer add-on. The server only supplies a version
        number: the link in the message is built from our own configured address."""
        newest, mine = _version(latest), _version(ADDON_VERSION)
        if newest is None or mine is None or newest <= mine:
            return None
        if not always and self.a.get_local(NOTICE_KEY) == latest:
            return None
        self.a.set_local(NOTICE_KEY, latest)
        return f"A newer Leaderboard add-on ({latest}) is available. Download it from {self.base_url}/help"

    # --- website sign-in ------------------------------------------------------------------
    def sign_in_url(self) -> tuple[Optional[str], str]:
        secret = self.secret()
        if secret is None:
            return None, "Sync Anki first so the leaderboard can create your identity."
        try:
            status, data = self.t.post("/api/login-link", secret, {})
            if status == 401:  # not registered yet
                if not self._register(secret):
                    return None, "Could not register with the leaderboard."
                status, data = self.t.post("/api/login-link", secret, {})
        except ServerError as e:
            return None, f"Could not reach the leaderboard ({e})."
        token = data.get("token")
        if status != 201 or not isinstance(token, str) or not LINK_TOKEN_RE.match(token):
            return None, "The leaderboard did not return a valid sign-in link."
        # Built only from our configured base URL and a validated token, never from a server-supplied URL.
        return f"{self.base_url}/signin#{token}", ""
