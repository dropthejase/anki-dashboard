"""Anki Leaderboard add-on: wires Anki's menus and sync hook to `core.Leaderboard`."""

from __future__ import annotations

import html
import webbrowser

from aqt import gui_hooks, mw
from aqt.qt import QAction, QApplication, QDialog, QFileDialog, QHBoxLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout
from aqt.utils import askUser, getText, showInfo, tooltip

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


def _warn(result) -> None:
    """The "wait before the next update" warning is larger and stays for 8 seconds, so it is hard to miss. The same
    style is used after an Anki sync and after Update My Count Now."""
    tooltip(f'<span style="font-size:20px"><b>{html.escape(result.message)}</b></span>', period=8000)


def _on_sync_did_finish() -> None:
    if mw.col is None:
        return
    try:
        board = _board()
    except ValueError:
        return
    _run(board.on_sync_finished, lambda r: _warn(r) if r.limited else (tooltip(r.message) if not r.ok else (tooltip(r.notice) if r.notice else None)))


def _sync_now() -> None:
    try:
        board = _board()
    except ValueError:
        return showInfo("The leaderboard server_url in the add-on config is not valid.")
    _run(lambda: board.push(force=True), lambda r: _warn(r) if r.limited else tooltip(r.message + (f" {r.notice}" if r.notice else "")))


def _choose(text: str, options: list[str]) -> int | None:
    """Shows a message with one button per option and returns the index of the one pressed, or None if closed."""
    dlg = QDialog(mw)
    dlg.setWindowTitle("Anki Leaderboard")
    layout = QVBoxLayout(dlg)
    label = QLabel(text)
    label.setWordWrap(True)
    layout.addWidget(label)
    chosen: dict = {"index": None}

    def pick(i: int) -> None:
        chosen["index"] = i
        dlg.accept()

    for i, option in enumerate(options):
        button = QPushButton(option)
        button.clicked.connect(lambda _checked=False, i=i: pick(i))
        layout.addWidget(button)
    dlg.exec()
    return chosen["index"]


def _open_in_browser(board: Leaderboard) -> None:
    def done(res: tuple) -> None:
        url, message = res
        if url:
            webbrowser.open(url)
        else:
            showInfo(message)

    _run(board.sign_in_url, done)


def _ask(prompt: str, title: str) -> str | None:
    text, ok = getText(prompt, parent=mw, title=title)
    return text if ok and text.strip() else None


def _link_this(board: Leaderboard) -> None:
    code = _ask("Type the code shown on your other computer (Tools, Leaderboard Settings, Show a code for my other computer).", "Enter the code from my other computer")
    if code is None:
        return

    def done(result) -> None:
        showInfo(result.message)
        if result.ok:
            board.a.forget_legacy_secret()  # on the main thread, because it touches the collection
            _open_in_browser(board)

    _run(lambda: board.link_this_computer(code), done)


def _open() -> None:
    try:
        board = _board()
    except ValueError:
        return showInfo("The leaderboard server_url in the add-on config is not valid.")
    if not board.is_set_up():
        # Ask, so a second computer never starts a duplicate account by accident.
        choice = _choose(
            "Do you already have a leaderboard account?",
            ["No, create one", "Yes, enter the code from my other computer", "Cancel"],
        )
        if choice == 0:
            board.set_up_first_computer()
        elif choice == 1:
            return _link_this(board)
        else:
            return
    _open_in_browser(board)


def _link_another() -> None:
    try:
        board = _board()
    except ValueError:
        return showInfo("The leaderboard server_url in the add-on config is not valid.")

    def done(result) -> None:
        if result.link_code:
            showInfo(
                f"Your code is:\n\n{result.link_code}\n\nOn your other computer, choose Tools, Open Leaderboard, then 'Yes, enter the code from my other computer', "
                "and type this code. It works once and expires in 10 minutes."
            )
        else:
            showInfo(result.message)

    _run(board.make_link_code, done)


def _reset() -> None:
    board = _board()
    _run(board.reset_identity, lambda r: showInfo(r.message))


def _save_code(code: str, parent) -> None:
    path, _ = QFileDialog.getSaveFileName(parent, "Save recovery code", "anki-leaderboard-recovery-code.txt", "Text files (*.txt)")
    if not path:
        return
    text = (
        "Anki Leaderboard recovery code\n\n"
        f"{code}\n\n"
        "Keep this file somewhere safe, such as a password manager. Anyone with this code can take over your leaderboard account.\n"
        "To use it, choose Tools > Leaderboard Settings > Restore with a recovery code in Anki. It works once, and then you are given a new code.\n"
    )
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
    except OSError:
        showInfo("Could not save the file. Copy the code instead.")


def _show_new_code(code: str) -> None:
    dlg = QDialog(mw)
    dlg.setWindowTitle("Your new recovery code")
    layout = QVBoxLayout(dlg)
    label = QLabel("The code you used is now spent. Save this new one somewhere safe, such as a password manager. It is shown only once.")
    label.setWordWrap(True)
    field = QLineEdit(code)
    field.setReadOnly(True)
    row = QHBoxLayout()
    copy, save, done = QPushButton("Copy"), QPushButton("Save to file..."), QPushButton("Done")
    copy.clicked.connect(lambda: QApplication.clipboard().setText(code))
    save.clicked.connect(lambda: _save_code(code, dlg))
    done.clicked.connect(dlg.accept)
    for button in (copy, save, done):
        row.addWidget(button)
    layout.addWidget(label)
    layout.addWidget(field)
    layout.addLayout(row)
    dlg.exec()


def _restore() -> None:
    try:
        board = _board()
    except ValueError:
        return showInfo("The leaderboard server_url in the add-on config is not valid.")
    text, ok = getText(
        "Paste your recovery code. This replaces this computer's leaderboard identity.",
        parent=mw,
        title="Restore with a recovery code",
    )
    if not ok or not text.strip():
        return

    def done(result) -> None:
        showInfo(result.message)
        if result.ok:
            board.a.forget_legacy_secret()  # on the main thread, because it touches the collection
        if result.recovery_code:
            _show_new_code(result.recovery_code)

    _run(lambda: board.restore_identity(text), done)


def _enter_code() -> None:
    try:
        _link_this(_board())
    except ValueError:
        showInfo("The leaderboard server_url in the add-on config is not valid.")


def _confirm_reset() -> None:
    if askUser(
        "Reset this computer's key?\n\nThis computer gets a new key, and your website sign-ins on this account are signed out. Other computers are not affected.",
        parent=mw,
        title="Reset this computer's key",
    ):
        _reset()


def _settings() -> None:
    """For each action: a bold title, a plain explanation, then its button."""
    actions = (
        ("Show a code for my other computer", "Gives a one-time code (valid for 10 minutes) so another computer can join your account.", "Show code", _link_another),
        ("Enter the code from my other computer", "Joins this computer to an account you already have.", "Enter code", _enter_code),
        ("Restore with a recovery code", "Use the recovery code from your account page if you lost every computer. This signs out your other computers.", "Restore", _restore),
        ("Reset this computer's key", "Use this if you think this computer's key was copied. Other computers are not affected.", "Reset key", _confirm_reset),
    )
    dlg = QDialog(mw)
    dlg.setWindowTitle("Leaderboard Settings")
    dlg.setMinimumWidth(460)
    layout = QVBoxLayout(dlg)
    layout.setSpacing(6)
    chosen: dict = {"fn": None}

    def pick(fn) -> None:
        chosen["fn"] = fn
        dlg.accept()

    for title, explanation, action, fn in actions:
        heading = QLabel(title)
        heading.setStyleSheet("font-weight: bold")
        text = QLabel(explanation)
        text.setWordWrap(True)
        button = QPushButton(action)
        button.clicked.connect(lambda _checked=False, fn=fn: pick(fn))
        layout.addWidget(heading)
        layout.addWidget(text)
        layout.addWidget(button)
        layout.addSpacing(18)
    close = QPushButton("Close")
    close.clicked.connect(dlg.reject)
    layout.addWidget(close)
    dlg.exec()
    if chosen["fn"] is not None:
        chosen["fn"]()


def _setup() -> None:
    for label, fn in (
        ("Open Leaderboard", _open),
        ("Update My Count Now", _sync_now),
        ("Leaderboard Settings...", _settings),
    ):
        action = QAction(label, mw)
        action.triggered.connect(fn)
        mw.form.menuTools.addAction(action)
    gui_hooks.sync_did_finish.append(_on_sync_did_finish)


_setup()
