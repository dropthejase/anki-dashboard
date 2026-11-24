"""Anki Leaderboard add-on: wires Anki's menus and sync hook to `core.Leaderboard`."""

from __future__ import annotations

import webbrowser

from aqt import gui_hooks, mw
from aqt.qt import QAction
from aqt.utils import showInfo, tooltip

from .anki_adapter import AnkiAdapter
from .core import HttpTransport, Leaderboard

_ADDON = __name__.split(".")[0]


def _board() -> Leaderboard:
    cfg = mw.addonManager.getConfig(_ADDON) or {}
    url = cfg.get("server_url", "")
    return Leaderboard(AnkiAdapter(mw, _ADDON), HttpTransport(url), url)


def _run(task, done) -> None:
    # The collection is read on the main thread (one fast query); only the network call runs
    # in the background so Anki's UI never freezes.
    mw.taskman.run_in_background(task, lambda fut: done(fut.result()))


def _on_sync_did_finish() -> None:
    if mw.col is None:
        return
    try:
        board = _board()
    except ValueError:
        return
    _run(board.on_sync_finished, lambda r: tooltip(r.message) if not r.ok else (tooltip(r.notice) if r.notice else None))


def _sync_now() -> None:
    try:
        board = _board()
    except ValueError:
        return showInfo("The leaderboard server_url in the add-on config is not valid.")
    _run(lambda: board.push(force=True), lambda r: tooltip(r.message + (f" {r.notice}" if r.notice else "")))


def _open() -> None:
    try:
        board = _board()
    except ValueError:
        return showInfo("The leaderboard server_url in the add-on config is not valid.")

    def done(res: tuple) -> None:
        url, message = res
        if url:
            webbrowser.open(url)
        else:
            showInfo(message)

    _run(board.sign_in_url, done)


def _reset() -> None:
    board = _board()
    _run(board.reset_identity, lambda r: showInfo(r.message))


def _setup() -> None:
    for label, fn in (
        ("Open Leaderboard", _open),
        ("Sync Leaderboard Now", _sync_now),
        ("Reset Leaderboard Identity", _reset),
    ):
        action = QAction(label, mw)
        action.triggered.connect(fn)
        mw.form.menuTools.addAction(action)
    gui_hooks.sync_did_finish.append(_on_sync_did_finish)


_setup()
