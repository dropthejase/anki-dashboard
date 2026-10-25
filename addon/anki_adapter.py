"""The only module that touches Anki. Kept thin: everything testable lives in core.py."""

from __future__ import annotations

import sqlite3  # noqa: F401  (documentation: the collection DB is SQLite)
from typing import Any

from .core import COUNT_SQL, anki_day


class AnkiAdapter:
    def __init__(self, mw: Any, addon_name: str):
        self.mw = mw
        self.addon_name = addon_name

    def get_config(self, key: str) -> Any:
        return self.mw.col.get_config(key, None)

    def set_config(self, key: str, value: Any) -> None:
        self.mw.col.set_config(key, value)

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
