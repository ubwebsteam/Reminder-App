"""Backend tests for Remindly auto-delivery for SELF reminders.

Tests:
1. Health check shows integrations active (twilio + resend)
2. SELF reminder auto-fires email via Resend (last_results.email == true)
3. SELF reminder with multiple channels (push + email)
4. OTHER reminder still queues for manual send (pending_channels has 'email')
5. SMS path called for SELF when included (no error)
6. Twilio failure (whatsapp without sandbox opt-in) doesn't crash scheduler
"""
import os
import sys
import time
import uuid
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from pymongo import MongoClient

# Resolve external base URL from frontend .env
FRONTEND_ENV = Path("/app/frontend/.env")
BASE_URL = None
for line in FRONTEND_ENV.read_text().splitlines():
    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
        BASE_URL = line.split("=", 1)[1].strip().strip('"')
        break

assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not found in frontend/.env"
API = f"{BASE_URL}/api"
print(f"[setup] Using API base: {API}")

# Direct Mongo connection to inspect last_results / reminder_logs (not exposed via API)
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "remindly_db"
mclient = MongoClient(MONGO_URL)
mdb = mclient[DB_NAME]


def fetch_last_results(rid: str):
    doc = mdb.reminders.find_one({"id": rid}, {"_id": 0, "last_results": 1, "status": 1, "triggered_count": 1, "pending_channels": 1})
    return doc or {}


def fetch_log(rid: str):
    return list(mdb.reminder_logs.find({"reminder_id": rid}, {"_id": 0}))


results: dict[str, dict] = {}


def record(name: str, ok: bool, detail: str = "", data=None):
    status = "PASS" if ok else "FAIL"
    results[name] = {"status": status, "detail": detail, "data": data}
    print(f"[{status}] {name}: {detail}")


def signup_user():
    """Create a new unique user for the test run."""
    suffix = uuid.uuid4().hex[:8]
    email = f"reva.sharma+{suffix}@rymind.com"
    phone = "9876543210"
    payload = {
        "email": email,
        "phone": phone,
        "password": "Saral@1234",
        "full_name": f"Reva Sharma {suffix[:4]}",
        "country_code": "+91",
    }
    r = requests.post(f"{API}/auth/signup", json=payload, timeout=30)
    r.raise_for_status()
    data = r.json()
    return data["access_token"], data["user"], email


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def iso_in(seconds: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def get_reminder(token, rid):
    r = requests.get(f"{API}/reminders/{rid}", headers=auth_headers(token), timeout=20)
    r.raise_for_status()
    return r.json()


# ---------------- Test 1: Health ----------------
def test_health():
    try:
        r = requests.get(f"{API}/health", timeout=15)
        r.raise_for_status()
        body = r.json()
        integ = body.get("integrations", {})
        ok = body.get("ok") and integ.get("twilio") is True and integ.get("resend") is True
        record(
            "health_integrations_active",
            ok,
            f"twilio={integ.get('twilio')} resend={integ.get('resend')} scheduler_running={body.get('scheduler_running')}",
            body,
        )
        return body
    except Exception as e:
        record("health_integrations_active", False, f"exception: {e}")
        return None


# ---------------- Test 2: SELF reminder email auto-fire ----------------
def test_self_email(token):
    body = {
        "title": "Auto-test SELF email",
        "message": "This should arrive automatically",
        "scheduled_at": iso_in(10),
        "timezone": "Asia/Kolkata",
        "channels": ["email"],
        "repeat_count": 1,
        "repeat_interval_hours": 1,
        "lead_minutes": 0,
        "target": {"is_self": True},
    }
    try:
        r = requests.post(f"{API}/reminders", json=body, headers=auth_headers(token), timeout=20)
        r.raise_for_status()
        rid = r.json()["id"]
    except Exception as e:
        record("self_email_create", False, f"create failed: {e}")
        return None

    record("self_email_create", True, f"reminder id={rid}")

    # Wait up to ~25 seconds for fire
    final = None
    for i in range(13):
        time.sleep(2)
        final = get_reminder(token, rid)
        if final.get("triggered_count", 0) >= 1:
            break

    if not final or final.get("triggered_count", 0) < 1:
        record("self_email_fired", False, f"never fired. final={final}")
        return final

    # Need raw doc for last_results — it's not in ReminderOut, so query the detail
    # Look at logs collection via history endpoint — but easier: hit /reminders/{id} detail.
    # The ReminderOut model doesn't include last_results; we need to check via a side-channel.
    # We'll inspect by calling the detail and additionally checking via DB indirectly:
    # Actually last_results IS persisted but NOT exposed. Use direct mongo through health? No.
    # We can verify status + triggered_count + pending_channels emptiness.
    triggered = final.get("triggered_count", 0) if final else 0
    status = final.get("status") if final else None
    pending = (final or {}).get("pending_channels") or []
    needs_user_send = (final or {}).get("needs_user_send")
    db_doc = fetch_last_results(rid)
    last_results = (db_doc or {}).get("last_results", {})
    logs = fetch_log(rid)
    ok = (
        triggered >= 1
        and status == "completed"
        and len(pending) == 0
        and last_results.get("email") is True
        and len(logs) >= 1
    )
    record(
        "self_email_fired",
        ok,
        f"triggered={triggered} status={status} pending={pending} last_results={last_results} log_count={len(logs)}",
        {"reminder": final, "last_results": last_results, "logs": logs},
    )
    return final


# ---------------- Test 3: SELF reminder with multiple channels (push + email) ----------------
def test_self_multichannel(token):
    body = {
        "title": "Auto-test SELF multi",
        "message": "push and email",
        "scheduled_at": iso_in(10),
        "timezone": "Asia/Kolkata",
        "channels": ["push", "email"],
        "repeat_count": 1,
        "repeat_interval_hours": 1,
        "lead_minutes": 0,
        "target": {"is_self": True},
    }
    try:
        r = requests.post(f"{API}/reminders", json=body, headers=auth_headers(token), timeout=20)
        r.raise_for_status()
        rid = r.json()["id"]
    except Exception as e:
        record("self_multichannel_create", False, f"create failed: {e}")
        return None
    record("self_multichannel_create", True, f"id={rid}")

    final = None
    for i in range(13):
        time.sleep(2)
        final = get_reminder(token, rid)
        if final.get("triggered_count", 0) >= 1:
            break

    triggered = final.get("triggered_count", 0) if final else 0
    status = final.get("status") if final else None
    pending = (final or {}).get("pending_channels") or []
    db_doc = fetch_last_results(rid)
    last_results = (db_doc or {}).get("last_results", {})
    ok = triggered >= 1 and status == "completed" and len(pending) == 0 and last_results.get("email") is True
    record(
        "self_multichannel_fired",
        ok,
        f"triggered={triggered} status={status} pending={pending} last_results={last_results}",
        {"reminder": final, "last_results": last_results},
    )
    return final


# ---------------- Test 4: OTHER reminder queues for manual send ----------------
def test_other_queues(token):
    body = {
        "title": "Auto-test OTHER",
        "message": "for friend",
        "scheduled_at": iso_in(10),
        "timezone": "Asia/Kolkata",
        "channels": ["email"],
        "repeat_count": 1,
        "repeat_interval_hours": 1,
        "lead_minutes": 0,
        "target": {
            "is_self": False,
            "name": "Friend",
            "phone": "+919999999999",
            "email": "friend@example.com",
        },
    }
    try:
        r = requests.post(f"{API}/reminders", json=body, headers=auth_headers(token), timeout=20)
        r.raise_for_status()
        rid = r.json()["id"]
    except Exception as e:
        record("other_create", False, f"{e}")
        return None
    record("other_create", True, f"id={rid}")

    final = None
    for i in range(13):
        time.sleep(2)
        final = get_reminder(token, rid)
        if final.get("triggered_count", 0) >= 1:
            break

    triggered = final.get("triggered_count", 0) if final else 0
    status = final.get("status") if final else None
    pending = (final or {}).get("pending_channels") or []
    needs_user_send = (final or {}).get("needs_user_send")
    db_doc = fetch_last_results(rid)
    last_results = (db_doc or {}).get("last_results", {})
    # Expected: email is in pending_channels, status remains pending, needs_user_send true,
    # AND last_results.email should NOT be set (or be falsy) — backend should not auto-send for OTHER
    email_auto_sent = bool(last_results.get("email"))
    ok = (
        triggered >= 1
        and "email" in pending
        and status == "pending"
        and needs_user_send is True
        and not email_auto_sent
    )
    record(
        "other_queues_email_pending",
        ok,
        f"triggered={triggered} status={status} pending={pending} needs_user_send={needs_user_send} last_results={last_results}",
        {"reminder": final, "last_results": last_results},
    )
    return final


# ---------------- Test 5: SELF SMS path (Twilio call attempted) ----------------
def test_self_sms(token):
    body = {
        "title": "Auto-test SELF SMS",
        "message": "sms please",
        "scheduled_at": iso_in(10),
        "timezone": "Asia/Kolkata",
        "channels": ["sms"],
        "repeat_count": 1,
        "repeat_interval_hours": 1,
        "lead_minutes": 0,
        "target": {"is_self": True},
    }
    try:
        r = requests.post(f"{API}/reminders", json=body, headers=auth_headers(token), timeout=20)
        r.raise_for_status()
        rid = r.json()["id"]
    except Exception as e:
        record("self_sms_create", False, f"{e}")
        return None
    record("self_sms_create", True, f"id={rid}")

    final = None
    for i in range(13):
        time.sleep(2)
        final = get_reminder(token, rid)
        if final.get("triggered_count", 0) >= 1:
            break

    triggered = final.get("triggered_count", 0) if final else 0
    status = final.get("status") if final else None
    pending = (final or {}).get("pending_channels") or []
    db_doc = fetch_last_results(rid)
    last_results = (db_doc or {}).get("last_results", {})
    # SMS may fail (unverified Twilio trial) but it shouldn't crash scheduler — reminder must still fire
    # and complete (since repeat_count=1 and SELF auto-completes regardless of channel result).
    ok = triggered >= 1 and status == "completed" and len(pending) == 0 and "sms" in last_results
    record(
        "self_sms_fired_no_crash",
        ok,
        f"triggered={triggered} status={status} pending={pending} last_results={last_results}",
        {"reminder": final, "last_results": last_results},
    )
    return final


# ---------------- Test 6: SELF WhatsApp resilience ----------------
def test_self_whatsapp(token):
    body = {
        "title": "Auto-test SELF WA",
        "message": "wa please",
        "scheduled_at": iso_in(10),
        "timezone": "Asia/Kolkata",
        "channels": ["whatsapp"],
        "repeat_count": 1,
        "repeat_interval_hours": 1,
        "lead_minutes": 0,
        "target": {"is_self": True},
    }
    try:
        r = requests.post(f"{API}/reminders", json=body, headers=auth_headers(token), timeout=20)
        r.raise_for_status()
        rid = r.json()["id"]
    except Exception as e:
        record("self_whatsapp_create", False, f"{e}")
        return None
    record("self_whatsapp_create", True, f"id={rid}")

    final = None
    for i in range(13):
        time.sleep(2)
        final = get_reminder(token, rid)
        if final.get("triggered_count", 0) >= 1:
            break

    triggered = final.get("triggered_count", 0) if final else 0
    status = final.get("status") if final else None
    db_doc = fetch_last_results(rid)
    last_results = (db_doc or {}).get("last_results", {})
    ok = triggered >= 1 and status == "completed" and "whatsapp" in last_results
    record(
        "self_whatsapp_no_crash",
        ok,
        f"triggered={triggered} status={status} last_results={last_results}",
        {"reminder": final, "last_results": last_results},
    )
    return final


def main():
    h = test_health()
    if not h or not h.get("integrations", {}).get("resend"):
        print("[warn] Resend not active; continuing tests anyway.")

    token, user, email = signup_user()
    print(f"[auth] signed up {email} → user_id={user['id']}")

    test_self_email(token)
    test_self_multichannel(token)
    test_other_queues(token)
    test_self_sms(token)
    test_self_whatsapp(token)

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    failures = []
    for name, info in results.items():
        marker = "OK " if info["status"] == "PASS" else "FAIL"
        print(f"  [{marker}] {name}  -> {info['detail']}")
        if info["status"] != "PASS":
            failures.append(name)

    print(f"\nTotal: {len(results)}  Passed: {len(results) - len(failures)}  Failed: {len(failures)}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
