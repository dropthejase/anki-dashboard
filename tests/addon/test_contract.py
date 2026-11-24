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
    assert lb.on_sync_finished().message == ""  # not set up yet: nothing is sent and no identity is made
    lb.set_up_first_computer()
    assert lb.on_sync_finished().ok  # registers on 401, pushes
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


def _cookie_for(lb):
    url, err = lb.sign_in_url()
    assert url and not err
    _, headers = call("/api/login-link/consume", {"token": url.split("#")[1]}, {"Origin": URL})
    return headers["Set-Cookie"].split(";")[0]


def test_two_computers_on_one_account_and_removing_one():
    a, b = FakeAdapter(count=10), FakeAdapter(count=25)
    first = Leaderboard(a, HttpTransport(URL), URL)
    first.set_up_first_computer()
    assert first.push().ok
    code = first.make_link_code().link_code
    assert code
    second = Leaderboard(b, HttpTransport(URL), URL)
    assert second.link_this_computer(code).ok
    assert second.link_this_computer(code).ok is False  # a code works once
    # The 30 minute update limit is per account, so the second computer is told to wait. It is still a known computer.
    assert "one every 30 minutes" in second.push().message

    cookie1, cookie2 = _cookie_for(first), _cookie_for(second)
    me1, _ = call("/api/me", headers={"Cookie": cookie1}, method="GET")
    me2, _ = call("/api/me", headers={"Cookie": cookie2}, method="GET")
    assert me1["user"]["id"] == me2["user"]["id"]  # one account
    devices, _ = call("/api/devices", headers={"Cookie": cookie1}, method="GET")
    assert len(devices["devices"]) == 2

    # The list is oldest first, so the second computer is the last one. Remove it from the website.
    second_id = devices["devices"][-1]["id"]
    req = urllib.request.Request(f"{URL}/api/devices/{second_id}", method="DELETE", headers={"Cookie": cookie1, "Origin": URL})
    urllib.request.urlopen(req)

    # The removed computer must not quietly start a new account. The other one carries on.
    cut = second.push(force=True)
    assert not cut.ok and "removed" in cut.message
    assert SECRET_KEY not in b.config
    assert "removed" not in first.push(force=True).message  # the other computer is unaffected
