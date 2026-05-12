"""Remindly — Full-featured reminder app backend.

Features:
- JWT + bcrypt auth (email + phone)
- Reminders CRUD with scheduling via APScheduler
- Contacts (saved persons)
- Multi-channel delivery: Expo push, WhatsApp, SMS, Email
- Graceful fallback when 3rd-party credentials are absent
"""
import os
import re
import logging
import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional, Literal

import bcrypt
import httpx
import jwt
import pytz
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.date import DateTrigger
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Header, status
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ---------------- Logging ----------------
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("remindly")

# ---------------- Config ----------------
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET_KEY"]
JWT_ALG = os.environ.get("JWT_ALGORITHM", "HS256")
ACCESS_EXPIRES_MIN = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "10080"))

TWILIO_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_PHONE = os.environ.get("TWILIO_PHONE_NUMBER", "")
TWILIO_WA_FROM = os.environ.get("TWILIO_WHATSAPP_FROM", "")
TWILIO_WA_CONTENT_SID = os.environ.get("TWILIO_WA_CONTENT_SID", "")
RESEND_KEY = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM = os.environ.get("RESEND_FROM_EMAIL", "onboarding@resend.dev")

# ---------------- DB ----------------
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# ---------------- Scheduler ----------------
scheduler = AsyncIOScheduler(timezone=pytz.UTC)


# ---------------- Models ----------------
class UserSignup(BaseModel):
    email: EmailStr
    phone: str = Field(..., min_length=6)
    password: str = Field(..., min_length=6)
    full_name: str = Field(..., min_length=1)
    country_code: str = Field(default="+91")


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    phone: str
    full_name: str
    country_code: str
    expo_push_token: Optional[str] = None
    created_at: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class PushTokenIn(BaseModel):
    token: str


Channel = Literal["push", "whatsapp", "email", "sms"]


class ReminderTarget(BaseModel):
    # who is the reminder for
    is_self: bool = True
    name: Optional[str] = None
    phone: Optional[str] = None  # for whatsapp/sms
    email: Optional[str] = None  # for email


class ReminderCreate(BaseModel):
    title: str = Field(..., min_length=1)
    message: Optional[str] = ""
    scheduled_at: str  # ISO string with timezone
    timezone: str = "UTC"
    channels: List[Channel]
    repeat_count: int = Field(default=1, ge=1, le=50)
    repeat_interval_hours: float = Field(default=24, ge=0.0167)  # min 1 minute
    lead_minutes: int = Field(default=0, ge=0)  # reminder N minutes before
    target: ReminderTarget
    contact_id: Optional[str] = None


class ReminderUpdate(BaseModel):
    title: Optional[str] = None
    message: Optional[str] = None
    scheduled_at: Optional[str] = None
    channels: Optional[List[Channel]] = None
    repeat_count: Optional[int] = None
    repeat_interval_hours: Optional[float] = None
    lead_minutes: Optional[int] = None


class ReminderOut(BaseModel):
    id: str
    user_id: str
    title: str
    message: str
    scheduled_at: str
    timezone: str
    channels: List[str]
    repeat_count: int
    repeat_interval_hours: float
    lead_minutes: int
    target: ReminderTarget
    status: str
    triggered_count: int
    created_at: str
    next_fire_at: Optional[str] = None
    last_fired_at: Optional[str] = None
    pending_channels: List[str] = []
    needs_user_send: bool = False


class MarkSentIn(BaseModel):
    channel: Literal["whatsapp", "email", "sms"]


class StatusUpdate(BaseModel):
    action: Literal["complete", "cancel", "postpone"]
    postpone_minutes: Optional[int] = 30


class ContactCreate(BaseModel):
    name: str = Field(..., min_length=1)
    phone: Optional[str] = None
    email: Optional[str] = None


class ContactOut(BaseModel):
    id: str
    user_id: str
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    created_at: str


# ---------------- Security helpers ----------------
def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt(rounds=10)).decode()


def _phone_suffix(value: Optional[str]) -> Optional[str]:
    """Normalize any phone string to last-10-digits for cross-user matching.
    Strips '+', spaces, dashes, parentheses, country-code prefix if present.
    Returns None for empty / too-short numbers."""
    if not value:
        return None
    digits = "".join(c for c in str(value) if c.isdigit())
    if len(digits) < 7:
        return None
    return digits[-10:] if len(digits) >= 10 else digits


def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False


def create_access_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_EXPIRES_MIN),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ---------------- Senders (all graceful) ----------------
async def send_expo_push(token: str, title: str, body: str, data: dict | None = None) -> bool:
    if not token:
        logger.info("[push] skip — no token")
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as http:
            resp = await http.post(
                "https://exp.host/--/api/v2/push/send",
                json={
                    "to": token,
                    "sound": "default",
                    "title": title,
                    "body": body,
                    "data": data or {},
                },
                headers={"Content-Type": "application/json"},
            )
        logger.info("[push] -> %s %s", resp.status_code, resp.text[:120])
        return resp.status_code == 200
    except Exception as e:
        logger.warning("[push] failed: %s", e)
        return False


def _twilio_ready() -> bool:
    return bool(TWILIO_SID and TWILIO_TOKEN)


async def send_whatsapp(
    to_phone: str,
    body: str,
    template_vars: Optional[dict] = None,
) -> bool:
    """Send WhatsApp message via Twilio.

    If TWILIO_WA_CONTENT_SID is configured AND template_vars provided, sends
    using the approved Content Template (required for proactive sends to users
    outside the 24-hour conversation window).

    Otherwise falls back to free-form text (works only inside the 24-hr window
    or for sandbox-joined numbers).
    """
    if not _twilio_ready() or not TWILIO_WA_FROM:
        logger.info("[whatsapp MOCK] to=%s body=%s", to_phone, body[:80])
        return False
    try:
        import json as _json
        from twilio.rest import Client  # type: ignore

        use_template = bool(TWILIO_WA_CONTENT_SID and template_vars)

        def _send():
            c = Client(TWILIO_SID, TWILIO_TOKEN)
            to = to_phone if to_phone.startswith("whatsapp:") else f"whatsapp:{to_phone}"
            if use_template:
                c.messages.create(
                    from_=TWILIO_WA_FROM,
                    to=to,
                    content_sid=TWILIO_WA_CONTENT_SID,
                    content_variables=_json.dumps(template_vars),
                )
            else:
                c.messages.create(from_=TWILIO_WA_FROM, to=to, body=body)

        await asyncio.to_thread(_send)
        logger.info(
            "[whatsapp] sent to=%s via=%s", to_phone, "template" if use_template else "freeform"
        )
        return True
    except Exception as e:
        logger.warning("[whatsapp] failed: %s", e)
        return False


async def send_sms(to_phone: str, body: str) -> bool:
    if not _twilio_ready() or not TWILIO_PHONE:
        logger.info("[sms MOCK] to=%s body=%s", to_phone, body[:80])
        return False
    try:
        from twilio.rest import Client  # type: ignore

        def _send():
            c = Client(TWILIO_SID, TWILIO_TOKEN)
            c.messages.create(from_=TWILIO_PHONE, to=to_phone, body=body)

        await asyncio.to_thread(_send)
        return True
    except Exception as e:
        logger.warning("[sms] failed: %s", e)
        return False


async def send_email(to_email: str, subject: str, html: str) -> bool:
    if not RESEND_KEY:
        logger.info("[email MOCK] to=%s subject=%s", to_email, subject)
        return False
    try:
        import resend  # type: ignore

        resend.api_key = RESEND_KEY

        def _send():
            resend.Emails.send({
                "from": RESEND_FROM,
                "to": [to_email],
                "subject": subject,
                "html": html,
            })

        await asyncio.to_thread(_send)
        return True
    except Exception as e:
        logger.warning("[email] failed: %s", e)
        return False


# ---------------- Scheduling core ----------------
def _parse_iso(s: str) -> datetime:
    # Accept ISO with or without tz; default to UTC
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _compute_next_fire(r: dict) -> Optional[datetime]:
    """Compute the next UTC fire time considering lead_minutes, repeat_count, repeat_interval, triggered_count."""
    base = _parse_iso(r["scheduled_at"])
    lead = timedelta(minutes=r.get("lead_minutes", 0))
    first = base - lead
    triggered = r.get("triggered_count", 0)
    if triggered >= r.get("repeat_count", 1):
        return None
    interval = timedelta(hours=float(r.get("repeat_interval_hours", 24)))
    return first + interval * triggered


def _job_id(reminder_id: str) -> str:
    return f"reminder:{reminder_id}"


async def _schedule_reminder_job(reminder: dict) -> None:
    rid = reminder["id"]
    try:
        scheduler.remove_job(_job_id(rid))
    except Exception:
        pass
    if reminder.get("status") not in (None, "pending", "active"):
        return
    nxt = _compute_next_fire(reminder)
    if not nxt:
        await db.reminders.update_one({"id": rid}, {"$set": {"status": "completed", "next_fire_at": None}})
        return
    # if in past, run after 2 seconds
    if nxt <= datetime.now(timezone.utc):
        run_at = datetime.now(timezone.utc) + timedelta(seconds=2)
    else:
        run_at = nxt
    scheduler.add_job(
        _fire_reminder,
        trigger=DateTrigger(run_date=run_at),
        args=[rid],
        id=_job_id(rid),
        replace_existing=True,
        misfire_grace_time=3600,
    )
    await db.reminders.update_one({"id": rid}, {"$set": {"next_fire_at": nxt.isoformat()}})


async def _fire_reminder(reminder_id: str) -> None:
    r = await db.reminders.find_one({"id": reminder_id}, {"_id": 0})
    if not r or r.get("status") not in ("pending", "active"):
        return
    user = await db.users.find_one({"id": r["user_id"]}, {"_id": 0})
    if not user:
        return
    title = r["title"]
    msg = r.get("message") or title
    target = r.get("target", {})
    is_self = target.get("is_self", True)
    channels = r.get("channels", [])
    results = {}
    pending_for_others = []  # channels awaiting manual user-send

    # ---------- Push delivery ----------
    if "push" in channels:
        if is_self:
            # Self reminder → notify the owner only
            if user.get("expo_push_token"):
                results["push"] = await send_expo_push(
                    user["expo_push_token"], title, msg, {"reminder_id": reminder_id}
                )
        else:
            # Reminder for another person — try to match them by phone (last 10 digits)
            target_suffix = _phone_suffix(target.get("phone"))
            other_user = None
            other_count = 0
            if target_suffix:
                # Use find with a small limit to handle the rare "multiple users with same number" case safely
                cursor = db.users.find(
                    {"phone_suffix": target_suffix, "id": {"$ne": user["id"]}},
                    {"_id": 0},
                ).limit(5)
                async for u in cursor:
                    other_count += 1
                    if other_user is None:
                        other_user = u  # use the first match for primary delivery

            if other_user and other_user.get("expo_push_token"):
                # Match found → deliver the actual reminder to the OTHER user's device
                results["push_other"] = await send_expo_push(
                    other_user["expo_push_token"],
                    title,
                    msg,
                    {"reminder_id": reminder_id, "from_user_id": user["id"]},
                )
                # Owner gets a complementary "tap to send the rest" notification
                if user.get("expo_push_token"):
                    owner_body = (
                        f"Notification delivered to {target.get('name') or 'them'}. "
                        f"Tap Send for WhatsApp/SMS/Email if selected."
                    )
                    await send_expo_push(
                        user["expo_push_token"],
                        f"⏰ {title}",
                        owner_body,
                        {"reminder_id": reminder_id},
                    )
                results["push_other_match_count"] = other_count
            else:
                # No matching user → fall back to delivering to OWNER so they know to open & send
                if user.get("expo_push_token"):
                    body = msg if not target.get("name") else f"For {target['name']}: {msg}"
                    results["push"] = await send_expo_push(
                        user["expo_push_token"], title, body, {"reminder_id": reminder_id}
                    )

    # ---------- WhatsApp / SMS / Email ----------
    # - self: auto-send via server
    # - other: add to pending_channels; user will tap Send inside the reminder
    tz_name = r.get("timezone") or "UTC"
    try:
        local_tz = pytz.timezone(tz_name)
    except Exception:
        local_tz = pytz.UTC
    fired_local = datetime.now(timezone.utc).astimezone(local_tz)
    when_str = fired_local.strftime("%a, %d %b %Y · %I:%M %p")

    wa_body = f"*⏰ {title}*\n{msg}\n\n_Triggered: {when_str}_"
    sms_body = f"⏰ {title}: {msg} ({when_str})"
    email_html = f"""
    <div style=\"font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;background:#F8F9F7;padding:32px 16px\">
      <div style=\"background:#fff;border-radius:16px;padding:32px;border:1px solid #E5E7E0\">
        <div style=\"background:#2A4B41;color:#fff;display:inline-block;padding:6px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:1.2px\">REMINDER</div>
        <h1 style=\"font-size:24px;color:#1B1F1A;margin:16px 0 8px;letter-spacing:-0.5px\">{title}</h1>
        <p style=\"color:#4A5147;font-size:15px;line-height:1.55;white-space:pre-wrap;margin:0 0 24px\">{msg}</p>
        <div style=\"background:#EAF2EE;border-radius:10px;padding:14px 16px;color:#2A4B41;font-size:13px;font-weight:600\">⏰ Triggered: {when_str}</div>
        <p style=\"color:#94978F;font-size:11px;margin-top:24px;text-align:center\">Sent automatically by Remindly · You created this reminder for yourself.</p>
      </div>
    </div>
    """.strip()

    for ch in ("whatsapp", "sms", "email"):
        if ch not in channels:
            continue
        if is_self:
            try:
                if ch == "whatsapp" and user.get("phone_full"):
                    # Pass template variables; send_whatsapp will use Content SID if configured
                    results[ch] = await send_whatsapp(
                        user["phone_full"],
                        wa_body,
                        template_vars={"1": title, "2": msg, "3": when_str},
                    )
                elif ch == "sms" and user.get("phone_full"):
                    results[ch] = await send_sms(user["phone_full"], sms_body)
                elif ch == "email" and user.get("email"):
                    results[ch] = await send_email(user["email"], f"⏰ {title}", email_html)
                else:
                    results[ch] = False
                    logger.warning("[fire] self %s skipped: missing user contact for %s", ch, user.get("id"))
            except Exception as e:
                # Never let a 3rd-party failure crash the engine
                results[ch] = False
                logger.warning("[fire] self %s exception: %s", ch, e)
        else:
            pending_for_others.append(ch)

    now = datetime.now(timezone.utc).isoformat()
    new_triggered = r.get("triggered_count", 0) + 1
    update = {
        "triggered_count": new_triggered,
        "last_fired_at": now,
        "last_results": results,
    }
    if pending_for_others:
        existing = set(r.get("pending_channels", []) or [])
        existing.update(pending_for_others)
        update["pending_channels"] = sorted(existing)

    log_entry = {
        "id": str(uuid.uuid4()),
        "reminder_id": reminder_id,
        "fired_at": now,
        "results": results,
    }
    await db.reminder_logs.insert_one(log_entry)

    # Completion logic:
    # - self: complete when triggered_count reaches repeat_count
    # - other: never auto-complete; user must tap Send for each pending channel
    if is_self:
        if new_triggered >= r.get("repeat_count", 1):
            update["status"] = "completed"
            update["next_fire_at"] = None

    await db.reminders.update_one({"id": reminder_id}, {"$set": update})

    # Reschedule next occurrence ONLY for self-reminders with remaining repeats
    updated = await db.reminders.find_one({"id": reminder_id}, {"_id": 0})
    if (
        updated
        and updated.get("status") in ("pending", "active")
        and is_self
        and new_triggered < r.get("repeat_count", 1)
    ):
        await _schedule_reminder_job(updated)


# ---------------- Lifespan ----------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.users.create_index("email", unique=True)
    await db.users.create_index("phone_full")
    await db.users.create_index("phone_suffix")
    await db.reminders.create_index("user_id")
    await db.contacts.create_index("user_id")
    # Migration: backfill phone_suffix on existing users
    async for u in db.users.find({"phone_suffix": {"$exists": False}}, {"_id": 0, "id": 1, "phone_full": 1, "phone": 1}):
        suffix = _phone_suffix(u.get("phone_full") or u.get("phone"))
        if suffix:
            await db.users.update_one({"id": u["id"]}, {"$set": {"phone_suffix": suffix}})
    scheduler.start()
    # reschedule all active reminders
    async for r in db.reminders.find({"status": {"$in": ["pending", "active"]}}, {"_id": 0}):
        await _schedule_reminder_job(r)
    logger.info("Remindly started. Scheduler running.")
    yield
    scheduler.shutdown(wait=False)
    client.close()


app = FastAPI(title="Remindly API", lifespan=lifespan)
api = APIRouter(prefix="/api")


# ---------------- Helpers ----------------
def _user_to_out(u: dict) -> UserOut:
    return UserOut(
        id=u["id"],
        email=u["email"],
        phone=u["phone"],
        full_name=u["full_name"],
        country_code=u.get("country_code", "+91"),
        expo_push_token=u.get("expo_push_token"),
        created_at=u.get("created_at", ""),
    )


def _reminder_to_out(r: dict) -> ReminderOut:
    pending = r.get("pending_channels", []) or []
    return ReminderOut(
        id=r["id"],
        user_id=r["user_id"],
        title=r["title"],
        message=r.get("message", ""),
        scheduled_at=r["scheduled_at"],
        timezone=r.get("timezone", "UTC"),
        channels=r.get("channels", []),
        repeat_count=r.get("repeat_count", 1),
        repeat_interval_hours=r.get("repeat_interval_hours", 24),
        lead_minutes=r.get("lead_minutes", 0),
        target=ReminderTarget(**r.get("target", {"is_self": True})),
        status=r.get("status", "pending"),
        triggered_count=r.get("triggered_count", 0),
        created_at=r.get("created_at", ""),
        next_fire_at=r.get("next_fire_at"),
        last_fired_at=r.get("last_fired_at"),
        pending_channels=pending,
        needs_user_send=len(pending) > 0,
    )


# ---------------- Routes ----------------
@api.get("/")
async def root():
    return {"app": "Remindly", "status": "ok"}


@api.get("/health")
async def health():
    return {
        "ok": True,
        "scheduler_running": scheduler.running,
        "integrations": {
            "twilio": _twilio_ready(),
            "resend": bool(RESEND_KEY),
        },
    }


# ------- Auth -------
@api.post("/auth/signup", response_model=TokenOut)
async def signup(payload: UserSignup):
    email = payload.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(400, "Email already registered")
    phone_raw = re.sub(r"[^\d]", "", payload.phone)
    if not phone_raw:
        raise HTTPException(400, "Invalid phone number")
    phone_full = f"{payload.country_code}{phone_raw}"
    user_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": user_id,
        "email": email,
        "phone": phone_raw,
        "phone_full": phone_full,
        "phone_suffix": _phone_suffix(phone_full),
        "country_code": payload.country_code,
        "full_name": payload.full_name.strip(),
        "password_hash": hash_password(payload.password),
        "expo_push_token": None,
        "created_at": now,
    }
    await db.users.insert_one(doc)
    token = create_access_token(user_id)
    return TokenOut(access_token=token, user=_user_to_out(doc))


@api.post("/auth/login", response_model=TokenOut)
async def login(payload: UserLogin):
    u = await db.users.find_one({"email": payload.email.lower().strip()})
    if not u or not verify_password(payload.password, u["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    token = create_access_token(u["id"])
    return TokenOut(access_token=token, user=_user_to_out(u))


@api.get("/auth/me", response_model=UserOut)
async def me(current=Depends(get_current_user)):
    return _user_to_out(current)


@api.post("/auth/push-token")
async def set_push_token(body: PushTokenIn, current=Depends(get_current_user)):
    await db.users.update_one({"id": current["id"]}, {"$set": {"expo_push_token": body.token}})
    return {"ok": True}


# ------- Reminders -------
@api.post("/reminders", response_model=ReminderOut)
async def create_reminder(payload: ReminderCreate, current=Depends(get_current_user)):
    # validate scheduled_at parses
    try:
        _parse_iso(payload.scheduled_at)
    except Exception:
        raise HTTPException(400, "Invalid scheduled_at ISO datetime")
    rid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": rid,
        "user_id": current["id"],
        "title": payload.title.strip(),
        "message": (payload.message or "").strip(),
        "scheduled_at": payload.scheduled_at,
        "timezone": payload.timezone,
        "channels": list(dict.fromkeys(payload.channels)),
        "repeat_count": payload.repeat_count,
        "repeat_interval_hours": payload.repeat_interval_hours,
        "lead_minutes": payload.lead_minutes,
        "target": payload.target.model_dump(),
        "contact_id": payload.contact_id,
        "status": "pending",
        "triggered_count": 0,
        "created_at": now,
        "next_fire_at": None,
        "last_fired_at": None,
    }
    await db.reminders.insert_one(doc)
    await _schedule_reminder_job(doc)
    doc_fresh = await db.reminders.find_one({"id": rid}, {"_id": 0})
    return _reminder_to_out(doc_fresh)


@api.get("/reminders", response_model=List[ReminderOut])
async def list_active_reminders(current=Depends(get_current_user)):
    items = await db.reminders.find(
        {"user_id": current["id"], "status": {"$in": ["pending", "active"]}},
        {"_id": 0},
    ).sort("scheduled_at", 1).to_list(500)
    return [_reminder_to_out(x) for x in items]


@api.get("/reminders/history", response_model=List[ReminderOut])
async def list_history(current=Depends(get_current_user)):
    items = await db.reminders.find(
        {"user_id": current["id"], "status": {"$in": ["completed", "cancelled"]}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    return [_reminder_to_out(x) for x in items]


@api.get("/reminders/{rid}", response_model=ReminderOut)
async def get_reminder(rid: str, current=Depends(get_current_user)):
    r = await db.reminders.find_one({"id": rid, "user_id": current["id"]}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Reminder not found")
    return _reminder_to_out(r)


@api.post("/reminders/{rid}/mark-sent", response_model=ReminderOut)
async def mark_channel_sent(rid: str, body: MarkSentIn, current=Depends(get_current_user)):
    """User tapped Send for a WhatsApp/SMS/Email channel for a reminder-for-others.
    Removes the channel from pending_channels. When empty, move reminder to completed."""
    r = await db.reminders.find_one({"id": rid, "user_id": current["id"]}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Reminder not found")
    pending = list(r.get("pending_channels", []) or [])
    if body.channel in pending:
        pending.remove(body.channel)
    update: dict = {"pending_channels": pending}
    if not pending:
        update["status"] = "completed"
        update["next_fire_at"] = None
        try:
            scheduler.remove_job(_job_id(rid))
        except Exception:
            pass
    await db.reminders.update_one({"id": rid}, {"$set": update})
    fresh = await db.reminders.find_one({"id": rid}, {"_id": 0})
    return _reminder_to_out(fresh)


@api.patch("/reminders/{rid}", response_model=ReminderOut)
async def update_reminder(rid: str, body: ReminderUpdate, current=Depends(get_current_user)):
    r = await db.reminders.find_one({"id": rid, "user_id": current["id"]}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Reminder not found")
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "scheduled_at" in updates:
        _parse_iso(updates["scheduled_at"])  # validate
    if updates:
        await db.reminders.update_one({"id": rid}, {"$set": updates})
    fresh = await db.reminders.find_one({"id": rid}, {"_id": 0})
    if fresh.get("status") in ("pending", "active"):
        await _schedule_reminder_job(fresh)
    return _reminder_to_out(fresh)


@api.post("/reminders/{rid}/action", response_model=ReminderOut)
async def reminder_action(rid: str, body: StatusUpdate, current=Depends(get_current_user)):
    r = await db.reminders.find_one({"id": rid, "user_id": current["id"]}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Reminder not found")
    if body.action == "complete":
        await db.reminders.update_one({"id": rid}, {"$set": {"status": "completed", "next_fire_at": None}})
        try:
            scheduler.remove_job(_job_id(rid))
        except Exception:
            pass
    elif body.action == "cancel":
        await db.reminders.update_one({"id": rid}, {"$set": {"status": "cancelled", "next_fire_at": None}})
        try:
            scheduler.remove_job(_job_id(rid))
        except Exception:
            pass
    elif body.action == "postpone":
        mins = body.postpone_minutes or 30
        new_time = datetime.now(timezone.utc) + timedelta(minutes=mins)
        await db.reminders.update_one(
            {"id": rid},
            {"$set": {"scheduled_at": new_time.isoformat(), "status": "pending"}},
        )
        fresh = await db.reminders.find_one({"id": rid}, {"_id": 0})
        await _schedule_reminder_job(fresh)
    fresh = await db.reminders.find_one({"id": rid}, {"_id": 0})
    return _reminder_to_out(fresh)


@api.delete("/reminders/{rid}")
async def delete_reminder(rid: str, current=Depends(get_current_user)):
    res = await db.reminders.delete_one({"id": rid, "user_id": current["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Reminder not found")
    try:
        scheduler.remove_job(_job_id(rid))
    except Exception:
        pass
    return {"ok": True}


# ------- Contacts -------
@api.post("/contacts", response_model=ContactOut)
async def create_contact(payload: ContactCreate, current=Depends(get_current_user)):
    cid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": cid,
        "user_id": current["id"],
        "name": payload.name.strip(),
        "phone": payload.phone,
        "email": payload.email,
        "created_at": now,
    }
    await db.contacts.insert_one(doc)
    return ContactOut(**{k: v for k, v in doc.items() if k != "_id"})


@api.get("/contacts", response_model=List[ContactOut])
async def list_contacts(current=Depends(get_current_user)):
    items = await db.contacts.find({"user_id": current["id"]}, {"_id": 0}).sort("name", 1).to_list(500)
    return [ContactOut(**c) for c in items]


@api.delete("/contacts/{cid}")
async def delete_contact(cid: str, current=Depends(get_current_user)):
    res = await db.contacts.delete_one({"id": cid, "user_id": current["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Contact not found")
    return {"ok": True}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
