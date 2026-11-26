"""Leaderboard logic with no dependency on Anki, so it can be tested in isolation.

Everything Anki-specific lives behind the `Adapter` protocol (see `anki_adapter.py`).
"""

from __future__ import annotations

import json
import os
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
from pathlib import Path
from typing import Any, Optional, Protocol
from urllib.parse import urlparse

ADDON_VERSION = "1.1.0"  # keep in step with ADDON_LATEST_VERSION in wrangler.jsonc when releasing (docs/RELEASING.md)
SECRET_KEY = "leaderboard_secret"  # where v0.2.x kept the key, in the synced collection. Now only removed, never read.
REGISTERED_KEY = "registered"  # machine-local: has the server ever accepted this computer?
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


# Anki's own statistics (the backend call behind its Statistics screen) over the whole collection. 30 days is enough for
# "days studied" and for the week and today retention figures.
STATS_DAYS = 30


def summarise_graphs(g: Any) -> Optional[dict]:
    """Turns Anki's graphs response into the small dict the server accepts, or None if it is not what we expect (for
    example an Anki version without these fields). Nothing here is computed by us beyond counting days and adding the
    young and mature figures Anki already reports.

    - days_studied: days in the last 30 (today included) on which any answer was recorded.
    - retention_today / retention_week: [passed, failed] review answers, from Anki's "true retention" figures.
    - retrievability: Anki's current average, or None unless FSRS is on.
    """
    try:
        t = g.true_retention

        def passed_failed(r: Any) -> list[int]:
            return [int(r.young_passed + r.mature_passed), int(r.young_failed + r.mature_failed)]

        days = sum(
            1
            for offset, r in g.reviews.count.items()
            if -STATS_DAYS < offset <= 0 and (r.learn + r.relearn + r.young + r.mature + r.filtered) > 0
        )
        average = float(g.retrievability.average)
        return {
            "days_studied": days,
            "retention_today": passed_failed(t.today),
            "retention_week": passed_failed(t.week),
            "retrievability": average if g.fsrs and 0 < average <= 1 else None,
        }
    except (AttributeError, TypeError, ValueError):
        return None


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


LINK_CODE_RE = re.compile(r"^[A-Z2-7]{12}$")


def normalise_link_code(text: Any) -> Optional[str]:
    """Accepts a link code as typed (any case, spaces or hyphens). None if it cannot be one."""
    if not isinstance(text, str) or len(text) > 32:
        return None
    code = "".join(text.upper().split()).replace("-", "")
    return code if LINK_CODE_RE.match(code) else None


def make_device_label(profile: str, system: str) -> str:
    """A short name for this computer, such as "Macbook (macOS)". It is only a label on the Account page."""
    os_name = {"Darwin": "macOS", "Windows": "Windows", "Linux": "Linux"}.get(system, "")
    base = default_display_name(profile)[:20].strip() or "Anki"
    return f"{base} ({os_name})" if os_name else base


class FileSecretStore:
    """Keeps this computer's key in a private file, outside the collection, so Anki's sync never touches it."""

    def __init__(self, path: Any):
        self.path = Path(path)

    def get(self) -> Optional[str]:
        try:
            return self.path.read_text(encoding="utf-8").strip() or None
        except OSError:
            return None

    def set(self, value: str) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)  # readable by this user only
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(value)
        os.replace(tmp, self.path)
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass  # some systems do not support this

    def clear(self) -> None:
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass


class Adapter(Protocol):
    def get_secret(self) -> Optional[str]: ...
    def set_secret(self, value: str) -> None: ...
    def clear_secret(self) -> None: ...
    def forget_legacy_secret(self) -> None:
        """Removes the copy that v0.2.x stored in the synced collection, so it stops travelling through AnkiWeb."""
    def get_local(self, key: str) -> Any: ...
    def set_local(self, key: str, value: Any) -> None: ...
    def today(self) -> tuple[str, int]:
        """Returns (local date, review count) for the current Anki day."""
    def profile_name(self) -> str: ...
    def device_label(self) -> str: ...


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
    recovery_code: Optional[str] = None  # a fresh recovery code to show the user once, after a restore
    link_code: Optional[str] = None  # a code to type on another computer
    limited: bool = False  # the server asked us to wait, so the add-on shows a larger, longer warning


RECOVERY_RE = re.compile(r"^[A-Z2-7]{32}$")


def normalise_recovery_code(text: Any) -> Optional[str]:
    """Accepts a recovery code as typed or pasted (any case, spaces or hyphens). None if it cannot be one."""
    if not isinstance(text, str) or len(text) > 64:
        return None
    code = "".join(text.upper().split()).replace("-", "")
    return code if RECOVERY_RE.match(code) else None


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
        s = self.a.get_secret()
        return s if isinstance(s, str) and SECRET_RE.match(s) else None

    def is_set_up(self) -> bool:
        return self.secret() is not None

    def set_up_first_computer(self) -> Result:
        """Makes this computer's key. Only ever called when the person says this is their first computer, so a second
        computer cannot start a duplicate account by accident. The server learns about the key on first use."""
        if self.secret() is None:
            self.a.set_secret(secrets.token_urlsafe(32))
            self.a.set_local(REGISTERED_KEY, False)
            self.a.set_local(STATE_KEY, None)
        self.a.forget_legacy_secret()
        return Result(True, "This computer is ready.")

    def on_sync_finished(self) -> Result:
        """Called from the `sync_did_finish` hook. Never creates an identity: until the person sets this computer up
        there is nothing to send."""
        if self.secret() is None:
            return Result(True, "")
        return self.push()

    def _use_new_key(self, new: str) -> None:
        self.a.set_secret(new)
        self.a.set_local(REGISTERED_KEY, True)
        self.a.set_local(STATE_KEY, None)

    def reset_identity(self) -> Result:
        old = self.secret()
        if old is None:
            return Result(False, "This computer is not set up yet. Choose Tools, Open Leaderboard first.")
        new = secrets.token_urlsafe(32)
        try:
            status, _ = self.t.post("/api/identity/rotate", old, {"new_secret": new})
        except ServerError as e:
            return Result(False, f"Could not reach the leaderboard ({e}).")
        if status != 200:
            return Result(False, "The leaderboard refused the reset.")
        self._use_new_key(new)
        return Result(True, "This computer has a new key, and every browser was signed out. Your other computers are not affected.")

    def restore_identity(self, text: str) -> Result:
        """Uses a recovery code to start over on this computer. Every other computer on the account is signed out."""
        code = normalise_recovery_code(text)
        if code is None:
            return Result(False, "That does not look like a recovery code. It has 32 letters and numbers, usually in groups of four.")
        new = secrets.token_urlsafe(32)
        body = {"recovery_code": code, "new_secret": new, "device_label": self.a.device_label()}
        try:
            status, data = self.t.post("/api/recover", None, body)
        except ServerError as e:
            return Result(False, f"Could not reach the leaderboard ({e}).")
        if status == 429:
            return Result(False, "Too many attempts. Try again later.")
        if status != 200:
            if status == 400 and data.get("error") == "invalid_recovery_code":
                return Result(False, "That recovery code was not recognised, or it has already been used.")
            return Result(False, "The leaderboard could not restore your identity.")
        # The server has already switched to the new key, so store it before anything else can fail.
        self._use_new_key(new)
        fresh = data.get("recovery_code")
        shown = fresh if normalise_recovery_code(fresh) else None
        message = "Your account is restored on this computer. Any other computers were signed out: link them again with Tools, Leaderboard Settings, Show a code for my other computer."
        if shown is None:
            message += " Create a new recovery code on your Account page, because the one just used is now spent."
        return Result(True, message, recovery_code=shown)

    def link_this_computer(self, text: str) -> Result:
        """Adds this computer to an existing account with a code made on another of its computers."""
        code = normalise_link_code(text)
        if code is None:
            return Result(False, "That does not look like a code from your other computer. It has 12 letters and numbers, in groups of four.")
        new = secrets.token_urlsafe(32)
        body = {"link_code": code, "new_secret": new, "device_label": self.a.device_label()}
        try:
            status, data = self.t.post("/api/link", None, body)
        except ServerError as e:
            return Result(False, f"Could not reach the leaderboard ({e}).")
        if status == 429:
            return Result(False, "Too many attempts. Try again later.")
        if status == 409 and data.get("error") == "too_many_devices":
            return Result(False, "This account already has the most computers it can hold. Remove one on your Account page, then make a new code.")
        if status != 201:
            if status == 400 and data.get("error") == "invalid_link_code":
                return Result(False, "That code was not recognised, has expired or was already used. Make a new one on your other computer.")
            return Result(False, "The leaderboard could not link this computer.")
        self._use_new_key(new)
        return Result(True, "This computer is now on your leaderboard account.")

    def make_link_code(self) -> Result:
        """Makes a code to type on another computer. Works once and expires in ten minutes."""
        secret = self.secret()
        if secret is None:
            return Result(False, "This computer is not set up yet. Choose Tools, Open Leaderboard first.")
        try:
            status, data = self.t.post("/api/link-code", secret, {})
            if status == 401 and data.get("error") == "unknown_identity":
                problem = self._handle_unknown(secret)
                if problem:
                    return Result(False, problem)
                status, data = self.t.post("/api/link-code", secret, {})
        except ServerError as e:
            return Result(False, f"Could not reach the leaderboard ({e}).")
        if status == 429:
            return Result(False, "You have made too many codes. Try again in a while.")
        code = data.get("code")
        if status != 201 or not isinstance(code, str) or normalise_link_code(code) is None:
            return Result(False, "The leaderboard could not make a code for your other computer.")
        return Result(True, "Code ready.", link_code=code)

    # --- first use ------------------------------------------------------------------------
    def _register(self, secret: str) -> bool:
        body = {"display_name": default_display_name(self.a.profile_name()), "device_label": self.a.device_label()}
        status, data = self.t.post("/api/register", secret, body)
        return status in (200, 201) and isinstance(data.get("user_id"), str)

    def _handle_unknown(self, secret: str) -> Optional[str]:
        """The server does not know this key. A computer that was never accepted registers itself, as a first computer.
        One that was accepted before has been removed from the account, so it must not quietly start a new one."""
        if self.a.get_local(REGISTERED_KEY) is True:
            self.a.clear_secret()
            self.a.set_local(REGISTERED_KEY, False)
            self.a.set_local(STATE_KEY, None)
            return "This computer was removed from your leaderboard account. Choose Tools, Open Leaderboard to set it up again."
        if not self._register(secret):
            return "Could not register with the leaderboard."
        self.a.set_local(REGISTERED_KEY, True)
        return None

    # --- pushing counts -------------------------------------------------------------------
    def push(self, force: bool = False) -> Result:
        secret = self.secret()
        if secret is None:
            return Result(False, "This computer is not set up yet. Choose Tools, Open Leaderboard first.")
        local_date, count = self.a.today()
        if not force and self.a.get_local(STATE_KEY) == [local_date, count]:
            return Result(True, "Leaderboard already up to date.")
        body: dict = {"local_date": local_date, "review_count": count}
        stats = self._stats()
        if stats is not None:
            body["stats"] = stats
        try:
            status, data = self.t.post("/api/sync", secret, body)
            if status == 401 and data.get("error") == "unknown_identity":
                problem = self._handle_unknown(secret)
                if problem:
                    return Result(False, problem)
                status, data = self.t.post("/api/sync", secret, body)
        except ServerError as e:
            return Result(False, f"Could not reach the leaderboard ({e}). It will retry after your next sync.")
        if status == 200:
            self.a.set_local(STATE_KEY, [local_date, count])
            self.a.set_local(REGISTERED_KEY, True)
            return Result(True, f"Leaderboard updated: {count} reviews today.", self._update_notice(data.get("addon_latest"), force))
        if status == 429:
            return Result(False, "Leaderboard updates are limited to one every 30 minutes. Try again later. And get back to revising!", limited=True)
        return Result(False, "The leaderboard could not accept the update.")

    def _stats(self) -> Optional[dict]:
        """Anki's statistics for the push, or None. A problem reading them never stops the review count being sent."""
        try:
            return self.a.stats() if hasattr(self.a, "stats") else None
        except Exception:
            return None

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
            return None, "This computer is not set up yet."
        try:
            status, data = self.t.post("/api/login-link", secret, {})
            if status == 401 and data.get("error") == "unknown_identity":
                problem = self._handle_unknown(secret)
                if problem:
                    return None, problem
                status, data = self.t.post("/api/login-link", secret, {})
        except ServerError as e:
            return None, f"Could not reach the leaderboard ({e})."
        token = data.get("token")
        if status != 201 or not isinstance(token, str) or not LINK_TOKEN_RE.match(token):
            return None, "The leaderboard did not return a valid sign-in link."
        self.a.set_local(REGISTERED_KEY, True)
        # Built only from our configured base URL and a validated token, never from a server-supplied URL.
        return f"{self.base_url}/signin#{token}", ""
