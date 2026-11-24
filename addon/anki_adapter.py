"""The only module that touches Anki. Kept thin: everything testable lives in core.py."""

from __future__ import annotations

import platform
import sqlite3  # noqa: F401  (documentation: the collection DB is SQLite)
from pathlib import Path
from typing import Any, Optional

from .core import COUNT_SQL, SECRET_KEY, FileSecretStore, anki_day, make_device_label


class AnkiAdapter:
    def __init__(self, mw: Any, addon_name: str):
        self.mw = mw
        self.addon_name = addon_name
        # `user_files` is the folder Anki keeps when the add-on is updated. It is not part of the collection, so syncing never touches it.
        self._store = FileSecretStore(Path(mw.addonManager.addonsFolder(addon_name)) / "user_files" / "device_key")

    def get_secret(self) -> Optional[str]:
        return self._store.get()

    def set_secret(self, value: str) -> None:
        self._store.set(value)

    def clear_secret(self) -> None:
        self._store.clear()

    def forget_legacy_secret(self) -> None:
        """v0.2.x kept the key in the collection settings, which AnkiWeb syncs. Remove it so it stops travelling."""
        try:
            if self.mw.col is not None and self.mw.col.get_config(SECRET_KEY, None) is not None:
                self.mw.col.remove_config(SECRET_KEY)
        except Exception:
            pass  # cleanup only: never let it get in the way

    def _local(self) -> dict:
        return self.mw.addonManager.getConfig(self.addon_name) or {}

    def get_local(self, key: str) -> Any:
        return self._local().get(key)

    def set_local(self, key: str, value: Any) -> None:
        cfg = self._local()
        cfg[key] = value
        self.mw.addonManager.writeConfig(self.addon_name, cfg)

    def today(self) -> tuple[str, int]:
        cutoff = self.mw.col.sched.day_cutoff
        count = self.mw.col.db.scalar(COUNT_SQL, (cutoff - 86400) * 1000)
        return anki_day(cutoff), int(count or 0)

    def profile_name(self) -> str:
        return self.mw.pm.name or "Anki user"

    def device_label(self) -> str:
        return make_device_label(self.profile_name(), platform.system())
