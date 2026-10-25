"""Leaderboard logic with no dependency on Anki, so it can be tested in isolation.

Everything Anki-specific lives behind the `Adapter` protocol (see `anki_adapter.py`).
"""

from __future__ import annotations

import json
import re
import secrets
import sqlite3
import ssl
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date
from typing import Any, Optional, Protocol
from urllib.parse import urlparse

SECRET_KEY = "leaderboard_secret"
STATE_KEY = "last_pushed"  # machine-local, never synced
MAX_RESPONSE_BYTES = 64 * 1024
LINK_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{22}$")
SECRET_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")

# Matches Anki's own "Today" statistic: every answer since the day cutoff, excluding
# manual (4) and rescheduled (5) entries. Source: rslib/src/storage/revlog/studied_today.sql
COUNT_SQL = "SELECT COUNT() FROM revlog WHERE id > ? AND type != 4 AND type != 5"


def count_reviews(db: sqlite3.Connection, day_cutoff: int) -> int:
    """`day_cutoff` is the Unix time (seconds) at which the next Anki day starts."""
    return int(db.execute(COUNT_SQL, ((day_cutoff - 86400) * 1000,)).fetchone()[0])


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
    pass


class HttpTransport:
    def __init__(self, base_url: str):
        u = urlparse(base_url)
        local = u.hostname in ("localhost", "127.0.0.1")
        if u.scheme != "https" and not (u.scheme == "http" and local):
            raise ValueError("server_url must be https")
        self.base = base_url.rstrip("/")
        self._ctx = ssl.create_default_context()  # verifies certificates and hostnames

    def post(self, path: str, secret: str | None, body: dict) -> tuple[int, dict]:
        headers = {"Content-Type": "application/json"}
        if secret:
            headers["Authorization"] = f"Bearer {secret}"
        req = urllib.request.Request(
            self.base + path, data=json.dumps(body).encode(), headers=headers, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=10, context=self._ctx) as r:
                status, raw = r.status, r.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read(MAX_RESPONSE_BYTES + 1)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise ServerError("network") from e
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ServerError("response too large")
        try:
            data = json.loads(raw)
        except ValueError as e:
            raise ServerError("invalid response") from e
        if not isinstance(data, dict):
            raise ServerError("invalid response")
        return status, data


@dataclass
class Result:
    ok: bool
    message: str


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
        except ServerError:
            return Result(False, "Could not reach the leaderboard.")
        if status != 200:
            return Result(False, "The leaderboard refused the reset.")
        self.a.set_config(SECRET_KEY, new)
        self.a.set_local(STATE_KEY, None)
        return Result(True, "Leaderboard identity reset. Sync Anki to share the new identity with your other computers.")

    # --- pushing counts -------------------------------------------------------------------
    def _register(self, secret: str) -> bool:
        status, data = self.t.post("/api/register", secret, {"display_name": self.a.profile_name()[:30] or "Anki user"})
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
        except ServerError:
            return Result(False, "Could not reach the leaderboard. It will retry after your next sync.")
        if status == 200:
            self.a.set_local(STATE_KEY, [local_date, count])
            return Result(True, f"Leaderboard updated: {count} reviews today.")
        if status == 429:
            return Result(False, "Leaderboard updates are limited to one every 5 minutes. Try again shortly.")
        return Result(False, "The leaderboard could not accept the update.")

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
        except ServerError:
            return None, "Could not reach the leaderboard."
        token = data.get("token")
        if status != 201 or not isinstance(token, str) or not LINK_TOKEN_RE.match(token):
            return None, "The leaderboard did not return a valid sign-in link."
        # Built only from our configured base URL and a validated token, never from a server-supplied URL.
        return f"{self.base_url}/signin#{token}", ""
