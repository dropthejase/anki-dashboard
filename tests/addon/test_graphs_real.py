"""Checks summarise_graphs against Anki's real backend. Skipped unless the `anki` package is installed
(`pip install anki` into a throwaway environment): the add-on itself runs inside Anki, which supplies it."""

import time

import pytest

anki = pytest.importorskip("anki")

from anki.collection import Collection  # noqa: E402

from core import STATS_DAYS, summarise_graphs  # noqa: E402


def test_real_graphs_response_is_summarised(tmp_path):
    col = Collection(str(tmp_path / "c.anki2"))
    try:
        note = col.new_note(col.models.by_name("Basic"))
        note["Front"], note["Back"] = "q", "a"
        col.add_note(note, col.decks.id("Test"))
        cid = col.db.scalar("select id from cards")
        now = int(time.time() * 1000)

        def review(days_ago, ease, k=0):
            col.db.execute(
                "insert into revlog (id,cid,usn,ease,ivl,lastIvl,factor,time,type) values (?,?,?,?,?,?,?,?,1)",
                now - days_ago * 86_400_000 - 600_000 - k, cid, -1, ease, 5, 5, 2500, 5000,
            )

        for k, ease in enumerate([3, 3, 2, 1]):
            review(0, ease, k)  # today: 3 passed, 1 failed
        for k in range(2):
            review(3, 3, k)
        review(20, 3)
        for k in range(5):
            review(45, 3, k)  # outside the window
        summary = summarise_graphs(col._backend.graphs(search="", days=STATS_DAYS))
    finally:
        col.close()
    assert summary == {"days_studied": 3, "retention_today": [3, 1], "retention_week": [5, 1]}

