"""Remindly — Full backend API tests.
Covers: health, auth (signup/login/me/push-token), reminders CRUD + scheduling,
contacts CRUD, ownership enforcement, firing behaviour.
"""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://remind-everywhere.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _unique_email(tag=""):
    # lowercase because backend lowercases on save
    return f"test_{tag}_{uuid.uuid4().hex[:10]}@example.com"


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def user_a(api_client):
    email = _unique_email("a")
    r = api_client.post(f"{API}/auth/signup", json={
        "email": email, "phone": "9876500001", "password": "pass1234",
        "full_name": "User A", "country_code": "+91",
    })
    assert r.status_code == 200, r.text
    data = r.json()
    return {"email": email, "token": data["access_token"], "user": data["user"], "password": "pass1234"}


@pytest.fixture(scope="session")
def user_b(api_client):
    email = _unique_email("b")
    r = api_client.post(f"{API}/auth/signup", json={
        "email": email, "phone": "9876500002", "password": "pass1234",
        "full_name": "User B", "country_code": "+91",
    })
    assert r.status_code == 200, r.text
    data = r.json()
    return {"email": email, "token": data["access_token"], "user": data["user"]}


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------------- Health ----------------
class TestHealth:
    def test_health(self, api_client):
        r = api_client.get(f"{API}/health")
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["scheduler_running"] is True


# ---------------- Auth ----------------
class TestAuth:
    def test_signup_duplicate_rejected(self, api_client, user_a):
        r = api_client.post(f"{API}/auth/signup", json={
            "email": user_a["email"], "phone": "9876500099", "password": "pass1234",
            "full_name": "Dup", "country_code": "+91",
        })
        assert r.status_code == 400

    def test_login_success(self, api_client, user_a):
        r = api_client.post(f"{API}/auth/login", json={"email": user_a["email"], "password": user_a["password"]})
        assert r.status_code == 200
        body = r.json()
        assert "access_token" in body and body["user"]["email"] == user_a["email"]

    def test_login_wrong_password(self, api_client, user_a):
        r = api_client.post(f"{API}/auth/login", json={"email": user_a["email"], "password": "badpass"})
        assert r.status_code == 401

    def test_me(self, api_client, user_a):
        r = api_client.get(f"{API}/auth/me", headers=_auth(user_a["token"]))
        assert r.status_code == 200
        assert r.json()["email"] == user_a["email"]

    def test_me_no_auth(self, api_client):
        r = api_client.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_push_token(self, api_client, user_a):
        r = api_client.post(f"{API}/auth/push-token", headers=_auth(user_a["token"]),
                            json={"token": "ExponentPushToken[TEST_FAKE]"})
        assert r.status_code == 200
        assert r.json()["ok"] is True
        # verify stored
        me = api_client.get(f"{API}/auth/me", headers=_auth(user_a["token"])).json()
        assert me["expo_push_token"] == "ExponentPushToken[TEST_FAKE]"


# ---------------- Reminders CRUD ----------------
class TestReminders:
    def test_create_and_list_reminder(self, api_client, user_a):
        future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        payload = {
            "title": "TEST_Meeting", "message": "Prep deck",
            "scheduled_at": future, "timezone": "UTC",
            "channels": ["push", "email"],
            "repeat_count": 1, "repeat_interval_hours": 24, "lead_minutes": 0,
            "target": {"is_self": True},
        }
        r = api_client.post(f"{API}/reminders", headers=_auth(user_a["token"]), json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"] and data["status"] == "pending"
        assert data["next_fire_at"] is not None
        assert data["title"] == "TEST_Meeting"

        # GET verifies persistence
        g = api_client.get(f"{API}/reminders/{data['id']}", headers=_auth(user_a["token"]))
        assert g.status_code == 200
        assert g.json()["id"] == data["id"]

        # list active
        lst = api_client.get(f"{API}/reminders", headers=_auth(user_a["token"])).json()
        assert any(x["id"] == data["id"] for x in lst)

    def test_list_sorted_ascending(self, api_client, user_a):
        t1 = (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()
        t2 = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
        for t in [t1, t2]:
            api_client.post(f"{API}/reminders", headers=_auth(user_a["token"]), json={
                "title": "TEST_Sort", "scheduled_at": t, "channels": ["push"],
                "target": {"is_self": True},
            })
        lst = api_client.get(f"{API}/reminders", headers=_auth(user_a["token"])).json()
        times = [x["scheduled_at"] for x in lst]
        assert times == sorted(times)

    def test_update_reminder(self, api_client, user_a):
        future = (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat()
        c = api_client.post(f"{API}/reminders", headers=_auth(user_a["token"]), json={
            "title": "TEST_Old", "scheduled_at": future, "channels": ["push"],
            "target": {"is_self": True},
        }).json()
        new_time = (datetime.now(timezone.utc) + timedelta(hours=6)).isoformat()
        u = api_client.patch(f"{API}/reminders/{c['id']}", headers=_auth(user_a["token"]),
                             json={"title": "TEST_New", "scheduled_at": new_time})
        assert u.status_code == 200
        assert u.json()["title"] == "TEST_New"
        assert u.json()["scheduled_at"] == new_time

    def test_action_postpone_complete_cancel(self, api_client, user_a):
        future = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
        def _mk(title):
            return api_client.post(f"{API}/reminders", headers=_auth(user_a["token"]), json={
                "title": title, "scheduled_at": future, "channels": ["push"],
                "target": {"is_self": True},
            }).json()

        # postpone
        r1 = _mk("TEST_Postpone")
        before = r1["scheduled_at"]
        res = api_client.post(f"{API}/reminders/{r1['id']}/action", headers=_auth(user_a["token"]),
                              json={"action": "postpone", "postpone_minutes": 5})
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "pending"
        assert body["scheduled_at"] != before

        # complete
        r2 = _mk("TEST_Complete")
        res2 = api_client.post(f"{API}/reminders/{r2['id']}/action", headers=_auth(user_a["token"]),
                               json={"action": "complete"})
        assert res2.json()["status"] == "completed"

        # cancel
        r3 = _mk("TEST_Cancel")
        res3 = api_client.post(f"{API}/reminders/{r3['id']}/action", headers=_auth(user_a["token"]),
                               json={"action": "cancel"})
        assert res3.json()["status"] == "cancelled"

    def test_history_endpoint(self, api_client, user_a):
        hist = api_client.get(f"{API}/reminders/history", headers=_auth(user_a["token"]))
        assert hist.status_code == 200
        statuses = {x["status"] for x in hist.json()}
        assert statuses.issubset({"completed", "cancelled"})

    def test_delete_reminder(self, api_client, user_a):
        future = (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat()
        c = api_client.post(f"{API}/reminders", headers=_auth(user_a["token"]), json={
            "title": "TEST_Del", "scheduled_at": future, "channels": ["push"],
            "target": {"is_self": True},
        }).json()
        d = api_client.delete(f"{API}/reminders/{c['id']}", headers=_auth(user_a["token"]))
        assert d.status_code == 200
        g = api_client.get(f"{API}/reminders/{c['id']}", headers=_auth(user_a["token"]))
        assert g.status_code == 404

    def test_near_future_firing(self, api_client, user_a):
        scheduled = (datetime.now(timezone.utc) + timedelta(seconds=8)).isoformat()
        c = api_client.post(f"{API}/reminders", headers=_auth(user_a["token"]), json={
            "title": "TEST_FireSoon", "message": "ping",
            "scheduled_at": scheduled, "channels": ["push", "email"],
            "repeat_count": 1, "target": {"is_self": True},
        }).json()
        rid = c["id"]
        triggered = 0
        status = "pending"
        for _ in range(12):  # poll ~24s
            time.sleep(2)
            cur = api_client.get(f"{API}/reminders/{rid}", headers=_auth(user_a["token"])).json()
            triggered = cur["triggered_count"]
            status = cur["status"]
            if status == "completed":
                break
        assert triggered >= 1, f"Expected triggered>=1, got {triggered}, status={status}"
        assert status == "completed", f"Expected completed, got {status}"


# ---------------- Contacts ----------------
class TestContacts:
    def test_contact_crud(self, api_client, user_a):
        r = api_client.post(f"{API}/contacts", headers=_auth(user_a["token"]),
                            json={"name": "TEST_Alice", "phone": "9991110000", "email": "alice@x.com"})
        assert r.status_code == 200
        cid = r.json()["id"]

        lst = api_client.get(f"{API}/contacts", headers=_auth(user_a["token"])).json()
        assert any(c["id"] == cid for c in lst)

        d = api_client.delete(f"{API}/contacts/{cid}", headers=_auth(user_a["token"]))
        assert d.status_code == 200

        # delete missing -> 404
        d2 = api_client.delete(f"{API}/contacts/{cid}", headers=_auth(user_a["token"]))
        assert d2.status_code == 404


# ---------------- Ownership ----------------
class TestOwnership:
    def test_cross_user_reminder_access_denied(self, api_client, user_a, user_b):
        future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        c = api_client.post(f"{API}/reminders", headers=_auth(user_a["token"]), json={
            "title": "TEST_Private", "scheduled_at": future, "channels": ["push"],
            "target": {"is_self": True},
        }).json()
        # user B tries to access
        g = api_client.get(f"{API}/reminders/{c['id']}", headers=_auth(user_b["token"]))
        assert g.status_code == 404
        d = api_client.delete(f"{API}/reminders/{c['id']}", headers=_auth(user_b["token"]))
        assert d.status_code == 404

    def test_cross_user_contact_access_denied(self, api_client, user_a, user_b):
        c = api_client.post(f"{API}/contacts", headers=_auth(user_a["token"]),
                            json={"name": "TEST_Owner", "phone": "5", "email": "o@x.com"}).json()
        d = api_client.delete(f"{API}/contacts/{c['id']}", headers=_auth(user_b["token"]))
        assert d.status_code == 404
