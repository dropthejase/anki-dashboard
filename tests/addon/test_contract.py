"""Runs the real add-on logic against a running local Worker. Skipped unless LEADERBOARD_URL is set."""

import json
import os
import urllib.request

import pytest

from core import SECRET_KEY, HttpTransport, Leaderboard
from test_core import FakeAdapter

URL = os.environ.get("LEADERBOARD_URL")
pytestmark = pytest.mark.skipif(not URL, reason="LEADERBOARD_URL not set")


def call(path, body=None, headers=None, method="POST"):
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json", **(headers or {})}, method=method)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read()), r.headers


def test_full_flow_against_the_worker():
    a = FakeAdapter(count=42)
    lb = Leaderboard(a, HttpTransport(URL), URL)
    assert lb.on_sync_finished().ok  # creates identity, registers on 401, pushes
    secret = a.config[SECRET_KEY]
    url, err = lb.sign_in_url()
    assert url and not err
    token = url.split("#")[1]
    origin = URL
    data, headers = call("/api/login-link/consume", {"token": token}, {"Origin": origin})
    cookie = headers["Set-Cookie"].split(";")[0]
    board, _ = call("/api/boards", {"name": "Contract"}, {"Cookie": cookie, "Origin": origin})
    view, _ = call(f"/api/boards/{board['id']}", headers={"Cookie": cookie}, method="GET")
    assert view["members"][0]["today"] == 42
    assert lb.push().message == "Leaderboard already up to date."
    assert lb.reset_identity().ok and a.config[SECRET_KEY] != secret
