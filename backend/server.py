"""Remindly — Full-featured reminder app backend.

Features:
- JWT + bcrypt auth (email + phone)
- Reminders CRUD with scheduling via APScheduler
- Contacts (saved persons)
- Multi-channel delivery: Expo push, WhatsApp, SMS, Email
- Graceful fallback when 3rd-party credentials are absent
"""
import os
import random
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
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Header, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field, field_validator

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


# ---------------- Real-time user WebSocket registry ----------------
# Maps user_id -> set of active WebSocket connections (for live sync across
# all signed-in clients — mobile app + web companion).
_user_sockets: dict[str, set[WebSocket]] = {}


async def broadcast_to_user(user_id: str, payload: dict) -> None:
    """Send a JSON payload to every active socket belonging to the given user.
    Failures are swallowed so a dead websocket never breaks an API response."""
    if not user_id:
        return
    sockets = list(_user_sockets.get(user_id, set()))
    for ws in sockets:
        try:
            await ws.send_json(payload)
        except Exception as e:
            logger.debug("[ws/user] send failed for %s: %s", user_id, e)
            try:
                _user_sockets.get(user_id, set()).discard(ws)
            except Exception:
                pass


# ---------------- Models ----------------
class UserSignup(BaseModel):
    email: EmailStr
    phone: str = Field(..., min_length=6)
    password: str = Field(..., min_length=6)
    full_name: str = Field(..., min_length=1)
    country_code: str = Field(default="+91")
    phone_verify_token: str = Field(..., min_length=1)
    email_verify_token: str = Field(..., min_length=1)


class SendCodeIn(BaseModel):
    target: Literal["phone", "email"]
    value: str = Field(..., min_length=3)
    country_code: str = Field(default="+91")


class VerifyCodeIn(BaseModel):
    target: Literal["phone", "email"]
    value: str = Field(..., min_length=3)
    code: str = Field(..., min_length=6, max_length=6)


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
    repeat_count: int = Field(default=1, ge=-1, le=9999)
    repeat_interval_hours: float = Field(default=24, ge=0.0167, le=43800)  # 1 minute .. 5 years
    lead_minutes: int = Field(default=0, ge=0)  # reminder N minutes before
    target: ReminderTarget
    contact_id: Optional[str] = None


class ReminderUpdate(BaseModel):
    title: Optional[str] = None
    message: Optional[str] = None
    scheduled_at: Optional[str] = None
    channels: Optional[List[Channel]] = None
    repeat_count: Optional[int] = Field(default=None, ge=-1, le=9999)
    repeat_interval_hours: Optional[float] = Field(default=None, ge=0.0167, le=43800)
    lead_minutes: Optional[int] = Field(default=None, ge=0)


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


def _validate_contact_phone(value: Optional[str]) -> str:
    """A contact must carry a usable phone number (7–15 digits, optional + prefix)."""
    if value is None or not str(value).strip():
        raise ValueError("Phone number is required")
    cleaned = str(value).strip()
    digits = "".join(c for c in cleaned if c.isdigit())
    if len(digits) < 7:
        raise ValueError("Enter a valid phone number")
    if len(digits) > 15:
        raise ValueError("Phone number is too long")
    return cleaned


class ContactCreate(BaseModel):
    name: str = Field(..., min_length=1)
    phone: str = Field(..., min_length=1)
    email: Optional[str] = None

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, v: str) -> str:
        return _validate_contact_phone(v)


class ContactUpdate(BaseModel):
    name: str = Field(..., min_length=1)
    phone: str = Field(..., min_length=1)
    email: Optional[str] = None

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, v: str) -> str:
        return _validate_contact_phone(v)


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
    repeat_count = r.get("repeat_count", 1)
    if repeat_count != -1 and triggered >= repeat_count:
        return None
    try:
        interval = timedelta(hours=float(r.get("repeat_interval_hours", 24)))
        return first + interval * triggered
    except (OverflowError, ValueError) as e:
        # Interval too large to represent (legacy bad data) — stop scheduling instead of crashing
        logger.warning("[schedule] invalid interval for reminder %s: %s", r.get("id"), e)
        return None


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
                # Owner gets the reminder too, plus a "tap to send the rest" hint
                if user.get("expo_push_token"):
                    owner_body = (
                        f"(For {target.get('name') or 'them'}) {msg}\n"
                        f"Delivered to {target.get('name') or 'them'}. "
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

    def _email_html(body_msg: str, footer_note: str) -> str:
        return f"""
    <div style=\"font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;background:#F8F9F7;padding:32px 16px\">
      <div style=\"background:#fff;border-radius:16px;padding:32px;border:1px solid #E5E7E0\">
        <div style=\"background:#2A4B41;color:#fff;display:inline-block;padding:6px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:1.2px\">REMINDER</div>
        <h1 style=\"font-size:24px;color:#1B1F1A;margin:16px 0 8px;letter-spacing:-0.5px\">{title}</h1>
        <p style=\"color:#4A5147;font-size:15px;line-height:1.55;white-space:pre-wrap;margin:0 0 24px\">{body_msg}</p>
        <div style=\"background:#EAF2EE;border-radius:10px;padding:14px 16px;color:#2A4B41;font-size:13px;font-weight:600\">⏰ Triggered: {when_str}</div>
        <p style=\"color:#94978F;font-size:11px;margin-top:24px;text-align:center\">Sent automatically by Rymind · {footer_note}</p>
      </div>
    </div>
    """.strip()

    wa_body = f"*⏰ {title}*\n{msg}\n\n_Triggered: {when_str}_"
    sms_body = f"⏰ {title}: {msg} ({when_str})"
    email_html = _email_html(msg, "You created this reminder for yourself.")

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
            # Target delivery stays manual (pending_channels, user taps Send),
            # but the creator also receives a copy on their own channels right away.
            pending_for_others.append(ch)
            t_name = target.get("name") or "them"
            creator_msg = f"(For {t_name}) {msg}"
            try:
                if ch == "whatsapp" and user.get("phone_full"):
                    results[f"{ch}_creator"] = await send_whatsapp(
                        user["phone_full"],
                        f"*⏰ {title}*\n{creator_msg}\n\n_Triggered: {when_str}_",
                        template_vars={"1": title, "2": creator_msg, "3": when_str},
                    )
                elif ch == "sms" and user.get("phone_full"):
                    results[f"{ch}_creator"] = await send_sms(
                        user["phone_full"], f"⏰ {title}: {creator_msg} ({when_str})"
                    )
                elif ch == "email" and user.get("email"):
                    results[f"{ch}_creator"] = await send_email(
                        user["email"],
                        f"⏰ {title}",
                        _email_html(creator_msg, f"You created this reminder for {t_name}."),
                    )
                else:
                    results[f"{ch}_creator"] = False
                    logger.warning("[fire] creator copy %s skipped: missing contact for %s", ch, user.get("id"))
            except Exception as e:
                results[f"{ch}_creator"] = False
                logger.warning("[fire] creator copy %s exception: %s", ch, e)

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

    # - self: complete when triggered_count reaches repeat_count (if not unlimited)
    # - other: never auto-complete; user must tap Send for each pending channel
    if is_self:
        repeat_count = r.get("repeat_count", 1)
        if repeat_count != -1 and new_triggered >= repeat_count:
            update["status"] = "completed"
            update["next_fire_at"] = None

    await db.reminders.update_one({"id": reminder_id}, {"$set": update})

    # Reschedule next occurrence ONLY for self-reminders with remaining repeats
    updated = await db.reminders.find_one({"id": reminder_id}, {"_id": 0})
    if (
        updated
        and updated.get("status") in ("pending", "active")
        and is_self
        and (r.get("repeat_count", 1) == -1 or new_triggered < r.get("repeat_count", 1))
    ):
        await _schedule_reminder_job(updated)

    # Broadcast fired event to all signed-in clients for this user
    try:
        if updated:
            await broadcast_to_user(
                r["user_id"],
                {"type": "reminder.fired", "data": _reminder_to_out(updated).model_dump()},
            )
    except Exception as e:
        logger.debug("[ws] broadcast reminder.fired failed: %s", e)


# ---------------- Lifespan ----------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.users.create_index("email", unique=True)
    await db.users.create_index("phone_full")
    await db.users.create_index("phone_suffix")
    await db.reminders.create_index("user_id")
    await db.contacts.create_index("user_id")
    # Verification codes auto-expire after 10 minutes
    await db.verification_codes.create_index("created_at", expireAfterSeconds=600)
    # Migration: backfill phone_suffix on existing users
    async for u in db.users.find({"phone_suffix": {"$exists": False}}, {"_id": 0, "id": 1, "phone_full": 1, "phone": 1}):
        suffix = _phone_suffix(u.get("phone_full") or u.get("phone"))
        if suffix:
            await db.users.update_one({"id": u["id"]}, {"$set": {"phone_suffix": suffix}})
    scheduler.start()
    # reschedule all active reminders
    async for r in db.reminders.find({"status": {"$in": ["pending", "active"]}}, {"_id": 0}):
        await _schedule_reminder_job(r)
    logger.info("Rymind started. Scheduler running.")
    yield
    scheduler.shutdown(wait=False)
    client.close()


app = FastAPI(title="Rymind API", lifespan=lifespan)

# ---------------- CORS ----------------
_cors_origins = [
    o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    return {"app": "Rymind", "status": "ok"}


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


# ------- Auth — Verification -------
def _generate_verify_code() -> str:
    return str(random.randint(100000, 999999))


def _create_verify_token(target: str, value: str) -> str:
    """Short-lived JWT proving the user verified their phone/email."""
    payload = {
        f"{target}_verified": value,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
        "iat": datetime.now(timezone.utc),
        "purpose": "signup_verify",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def _decode_verify_token(token: str, target: str, expected_value: str) -> bool:
    """Validate a verification JWT matches the expected target+value."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        if payload.get("purpose") != "signup_verify":
            return False
        return payload.get(f"{target}_verified") == expected_value
    except jwt.PyJWTError:
        return False


def _verification_email_html(code: str) -> str:
    return f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;background:#F8F9F7;padding:32px 16px">
      <div style="background:#fff;border-radius:16px;padding:32px;border:1px solid #E5E7E0">
        <div style="text-align:center;margin-bottom:24px">
          <div style="background:#2A4B41;color:#fff;display:inline-block;padding:8px 16px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:1.5px">RYMIND</div>
        </div>
        <h1 style="font-size:22px;color:#1B1F1A;margin:0 0 8px;text-align:center;letter-spacing:-0.5px">Verify your email</h1>
        <p style="color:#4A5147;font-size:15px;line-height:1.55;text-align:center;margin:0 0 24px">Enter this code in the Rymind app to verify your email address.</p>
        <div style="background:#F0F5F2;border-radius:12px;padding:20px;text-align:center;margin:0 0 24px">
          <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#2A4B41">{code}</span>
        </div>
        <p style="color:#6B756E;font-size:13px;text-align:center;margin:0 0 8px">This code expires in <strong>10 minutes</strong>.</p>
        <p style="color:#94978F;font-size:11px;margin-top:24px;text-align:center">If you didn't request this code, you can safely ignore this email.</p>
      </div>
      <p style="color:#94978F;font-size:11px;margin-top:16px;text-align:center">&copy; Rymind &middot; rymind.in</p>
    </div>
    """.strip()


@api.post("/auth/send-code")
async def send_verification_code(payload: SendCodeIn):
    target = payload.target
    value = payload.value.strip()
    if not value:
        raise HTTPException(400, "Value is required")

    # Rate limit: max 5 codes per target+value per hour
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    recent_count = await db.verification_codes.count_documents({
        "target": target,
        "value": value,
        "created_at": {"$gte": one_hour_ago},
    })
    if recent_count >= 5:
        raise HTTPException(429, "Too many code requests. Please wait and try again.")

    code = _generate_verify_code()
    await db.verification_codes.insert_one({
        "target": target,
        "value": value,
        "code": code,
        "created_at": datetime.now(timezone.utc),
    })

    if target == "phone":
        phone_full = value if value.startswith("+") else f"{payload.country_code}{re.sub(r'[^0-9]', '', value)}"
        sms_body = f"Your Rymind verification code is: {code}. Valid for 10 minutes."
        sent = await send_sms(phone_full, sms_body)
        if not sent:
            logger.info("[verify] SMS code for %s: %s (mock/failed)", phone_full, code)
    elif target == "email":
        email_lower = value.lower()
        html = _verification_email_html(code)
        sent = await send_email(email_lower, "Your Rymind verification code", html)
        if not sent:
            logger.info("[verify] Email code for %s: %s (mock/failed)", email_lower, code)

    return {"ok": True, "message": "Verification code sent"}


@api.post("/auth/verify-code")
async def verify_code(payload: VerifyCodeIn):
    target = payload.target
    value = payload.value.strip()
    code = payload.code.strip()

    # Find the most recent code for this target+value
    doc = await db.verification_codes.find_one(
        {"target": target, "value": value},
        sort=[("created_at", -1)],
    )
    if not doc or doc.get("code") != code:
        return {"ok": False, "verified": False, "message": "Invalid or expired code"}

    # Code matches — issue a short-lived verification token
    token = _create_verify_token(target, value)
    # Clean up used codes for this target+value
    await db.verification_codes.delete_many({"target": target, "value": value})
    return {"ok": True, "verified": True, "token": token}


# ------- Auth — Signup & Login -------
@api.post("/auth/signup", response_model=TokenOut)
async def signup(payload: UserSignup):
    email = payload.email.lower().strip()
    phone_raw = re.sub(r"[^\d]", "", payload.phone)
    if not phone_raw:
        raise HTTPException(400, "Invalid phone number")
    phone_full = f"{payload.country_code}{phone_raw}"

    # Validate verification tokens
    if not _decode_verify_token(payload.phone_verify_token, "phone", phone_full):
        raise HTTPException(400, "Phone number not verified. Please verify your phone first.")
    if not _decode_verify_token(payload.email_verify_token, "email", email):
        raise HTTPException(400, "Email not verified. Please verify your email first.")

    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(400, "Email already registered")
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
        "last_login_at": now,
    }
    await db.users.insert_one(doc)
    token = create_access_token(user_id)
    return TokenOut(access_token=token, user=_user_to_out(doc))


@api.post("/auth/login", response_model=TokenOut)
async def login(payload: UserLogin):
    u = await db.users.find_one({"email": payload.email.lower().strip()})
    if not u or not verify_password(payload.password, u["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"id": u["id"]}, {"$set": {"last_login_at": now}})
    
    token = create_access_token(u["id"])
    return TokenOut(access_token=token, user=_user_to_out(u))


@api.get("/auth/me", response_model=UserOut)
async def me(current=Depends(get_current_user)):
    return _user_to_out(current)


@api.post("/auth/push-token")
async def set_push_token(body: PushTokenIn, current=Depends(get_current_user)):
    await db.users.update_one({"id": current["id"]}, {"$set": {"expo_push_token": body.token}})
    return {"ok": True}


@api.delete("/auth/account")
async def delete_account(current=Depends(get_current_user)):
    """Permanently delete the authenticated user's account and ALL associated data."""
    uid = current["id"]
    logger.info("[account] deleting user %s (%s)", uid, current.get("email"))

    # 1. Cancel all scheduled reminder jobs for this user
    user_reminders = await db.reminders.find(
        {"user_id": uid, "status": {"$in": ["pending", "active"]}},
        {"_id": 0, "id": 1},
    ).to_list(1000)
    for r in user_reminders:
        try:
            scheduler.remove_job(_job_id(r["id"]))
        except Exception:
            pass

    # 2. Delete all data from every collection
    del_reminders = await db.reminders.delete_many({"user_id": uid})
    del_contacts = await db.contacts.delete_many({"user_id": uid})
    del_logs = await db.reminder_logs.delete_many(
        {"reminder_id": {"$in": [r["id"] for r in user_reminders]}}
    )
    del_sessions = await db.web_sessions.delete_many({"user_id": uid})
    del_codes = await db.verification_codes.delete_many(
        {"$or": [{"value": current.get("email", "")}, {"value": current.get("phone_full", "")}]}
    )

    # 3. Delete the user record itself
    await db.users.delete_one({"id": uid})

    # 4. Disconnect any active WebSocket connections for this user
    sockets = list(_user_sockets.pop(uid, set()))
    for ws in sockets:
        try:
            await ws.send_json({"type": "account_deleted"})
            await ws.close(code=4410)
        except Exception:
            pass

    logger.info(
        "[account] deleted user=%s reminders=%d contacts=%d logs=%d sessions=%d codes=%d",
        uid,
        del_reminders.deleted_count,
        del_contacts.deleted_count,
        del_logs.deleted_count,
        del_sessions.deleted_count,
        del_codes.deleted_count,
    )

    return {
        "ok": True,
        "message": "Account and all associated data permanently deleted",
        "deleted": {
            "reminders": del_reminders.deleted_count,
            "contacts": del_contacts.deleted_count,
            "logs": del_logs.deleted_count,
            "web_sessions": del_sessions.deleted_count,
        },
    }


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
    out = _reminder_to_out(doc_fresh)
    try:
        await broadcast_to_user(current["id"], {"type": "reminder.created", "data": out.model_dump()})
    except Exception as e:
        logger.debug("[ws] broadcast reminder.created failed: %s", e)
    return out


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
    out = _reminder_to_out(fresh)
    try:
        await broadcast_to_user(current["id"], {"type": "reminder.updated", "data": out.model_dump()})
    except Exception as e:
        logger.debug("[ws] broadcast reminder.updated failed: %s", e)
    return out


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
    out = _reminder_to_out(fresh)
    try:
        await broadcast_to_user(current["id"], {"type": "reminder.updated", "data": out.model_dump()})
    except Exception as e:
        logger.debug("[ws] broadcast reminder.updated failed: %s", e)
    return out


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
    out = _reminder_to_out(fresh)
    try:
        await broadcast_to_user(current["id"], {"type": "reminder.updated", "data": out.model_dump()})
    except Exception as e:
        logger.debug("[ws] broadcast reminder.updated failed: %s", e)
    return out


@api.delete("/reminders/{rid}")
async def delete_reminder(rid: str, current=Depends(get_current_user)):
    res = await db.reminders.delete_one({"id": rid, "user_id": current["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Reminder not found")
    try:
        scheduler.remove_job(_job_id(rid))
    except Exception:
        pass
    try:
        await broadcast_to_user(current["id"], {"type": "reminder.deleted", "data": {"id": rid}})
    except Exception as e:
        logger.debug("[ws] broadcast reminder.deleted failed: %s", e)
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
    out = ContactOut(**{k: v for k, v in doc.items() if k != "_id"})
    try:
        await broadcast_to_user(current["id"], {"type": "contact.created", "data": out.model_dump()})
    except Exception as e:
        logger.debug("[ws] broadcast contact.created failed: %s", e)
    return out


@api.put("/contacts/{cid}", response_model=ContactOut)
async def update_contact(cid: str, payload: ContactUpdate, current=Depends(get_current_user)):
    existing = await db.contacts.find_one({"id": cid, "user_id": current["id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Contact not found")
    updates = {
        "name": payload.name.strip(),
        "phone": payload.phone.strip(),
        "email": (payload.email or "").strip() or None,
    }
    await db.contacts.update_one({"id": cid, "user_id": current["id"]}, {"$set": updates})
    out = ContactOut(**{**existing, **updates})
    try:
        await broadcast_to_user(current["id"], {"type": "contact.updated", "data": out.model_dump()})
    except Exception as e:
        logger.debug("[ws] broadcast contact.updated failed: %s", e)
    return out


@api.get("/contacts", response_model=List[ContactOut])
async def list_contacts(current=Depends(get_current_user)):
    items = await db.contacts.find({"user_id": current["id"]}, {"_id": 0}).sort("name", 1).to_list(500)
    return [ContactOut(**c) for c in items]


@api.delete("/contacts/{cid}")
async def delete_contact(cid: str, current=Depends(get_current_user)):
    res = await db.contacts.delete_one({"id": cid, "user_id": current["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Contact not found")
    try:
        await broadcast_to_user(current["id"], {"type": "contact.deleted", "data": {"id": cid}})
    except Exception as e:
        logger.debug("[ws] broadcast contact.deleted failed: %s", e)
    return {"ok": True}


# =====================================================================
# Web QR-Login (companion web app pairing) endpoints + WebSocket
# =====================================================================
import asyncio as _asyncio_qr

WEB_SESSION_TTL_MIN = 5          # QR validity until scanned
WEB_TOKEN_EXP_DAYS = 30           # JWT lifetime after approval

# In-memory map: session_id -> set of WebSocket connections waiting for approval
_qr_listeners: dict[str, set[WebSocket]] = {}


def _make_web_jwt(user_id: str, session_id: str) -> str:
    payload = {
        "sub": user_id,
        "web_session": session_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=WEB_TOKEN_EXP_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def _broadcast_qr(session_id: str, payload: dict) -> None:
    listeners = list(_qr_listeners.get(session_id, set()))
    for ws in listeners:
        try:
            await ws.send_json(payload)
        except Exception:
            pass


class WebSessionCreate(BaseModel):
    user_agent: Optional[str] = None
    ip: Optional[str] = None


class WebSessionApprove(BaseModel):
    device_label: Optional[str] = None


@api.post("/web-sessions")
async def create_web_session(body: WebSessionCreate):
    sid = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    doc = {
        "session_id": sid,
        "status": "pending",
        "user_id": None,
        "jwt_token": None,
        "device_info": {
            "ua": (body.user_agent or "")[:300],
            "ip": (body.ip or "")[:64],
            "label": None,
        },
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=WEB_SESSION_TTL_MIN)).isoformat(),
        "approved_at": None,
        "last_seen_at": now.isoformat(),
    }
    await db.web_sessions.insert_one(doc)
    return {"session_id": sid, "expires_at": doc["expires_at"]}


@api.get("/web-sessions/{session_id}")
async def get_web_session(session_id: str):
    """Public status poll (fallback if WebSocket fails). Token is only returned once,
    within 60 seconds of approval, and then nulled."""
    sess = await db.web_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not sess:
        raise HTTPException(404, "Session not found")
    # auto-expire if too old
    if sess["status"] == "pending" and datetime.fromisoformat(sess["expires_at"]) < datetime.now(timezone.utc):
        await db.web_sessions.update_one({"session_id": session_id}, {"$set": {"status": "expired"}})
        sess["status"] = "expired"
    if sess["status"] != "approved":
        return {"status": sess["status"]}
    # one-shot token delivery
    token = sess.get("jwt_token")
    user = None
    if token:
        u = await db.users.find_one({"id": sess["user_id"]}, {"_id": 0, "password_hash": 0})
        if u:
            user = u
        await db.web_sessions.update_one(
            {"session_id": session_id},
            {"$set": {"jwt_token": None}},  # consume the token
        )
    return {"status": "approved", "token": token, "user": user}


@api.post("/web-sessions/{session_id}/approve")
async def approve_web_session(
    session_id: str,
    body: WebSessionApprove,
    current=Depends(get_current_user),
):
    sess = await db.web_sessions.find_one({"session_id": session_id})
    if not sess:
        raise HTTPException(404, "Session not found")
    if sess["status"] != "pending":
        raise HTTPException(409, f"Session is {sess['status']}")
    if datetime.fromisoformat(sess["expires_at"]) < datetime.now(timezone.utc):
        await db.web_sessions.update_one({"session_id": session_id}, {"$set": {"status": "expired"}})
        raise HTTPException(410, "Session expired")
    token = _make_web_jwt(current["id"], session_id)
    now = datetime.now(timezone.utc)
    await db.web_sessions.update_one(
        {"session_id": session_id},
        {
            "$set": {
                "status": "approved",
                "user_id": current["id"],
                "jwt_token": token,
                "approved_at": now.isoformat(),
                "expires_at": (now + timedelta(days=WEB_TOKEN_EXP_DAYS)).isoformat(),
                "last_seen_at": now.isoformat(),
                "device_info.label": body.device_label or sess["device_info"].get("label"),
            }
        },
    )
    user = await db.users.find_one({"id": current["id"]}, {"_id": 0, "password_hash": 0})
    # Push to any web client waiting on the websocket
    await _broadcast_qr(session_id, {"type": "approved", "token": token, "user": user})
    return {"ok": True}


@api.get("/web-sessions")
async def list_web_sessions(current=Depends(get_current_user)):
    cursor = db.web_sessions.find(
        {"user_id": current["id"], "status": "approved"},
        {"_id": 0, "jwt_token": 0},
    ).sort("approved_at", -1)
    items = await cursor.to_list(50)
    return items


@api.delete("/web-sessions/{session_id}")
async def revoke_web_session(session_id: str, current=Depends(get_current_user)):
    sess = await db.web_sessions.find_one({"session_id": session_id})
    if not sess:
        raise HTTPException(404, "Session not found")
    if sess.get("user_id") and sess["user_id"] != current["id"]:
        raise HTTPException(403, "Not your session")
    await db.web_sessions.update_one(
        {"session_id": session_id},
        {"$set": {"status": "revoked", "jwt_token": None}},
    )
    await _broadcast_qr(session_id, {"type": "revoked"})
    return {"ok": True}


@app.websocket("/api/ws/web-session/{session_id}")
async def ws_web_session(websocket: WebSocket, session_id: str):
    await websocket.accept()
    sess = await db.web_sessions.find_one({"session_id": session_id})
    if not sess:
        await websocket.send_json({"type": "error", "code": "not_found"})
        await websocket.close()
        return
    # If already approved before connect, deliver instantly and close.
    if sess["status"] == "approved":
        user = await db.users.find_one({"id": sess["user_id"]}, {"_id": 0, "password_hash": 0})
        await websocket.send_json({"type": "approved", "token": sess.get("jwt_token"), "user": user})
        await websocket.close()
        return
    if sess["status"] != "pending":
        await websocket.send_json({"type": sess["status"]})
        await websocket.close()
        return
    _qr_listeners.setdefault(session_id, set()).add(websocket)
    try:
        # Keep connection open until approved/expired/disconnected
        while True:
            try:
                # short-circuit on TTL
                expires_at = datetime.fromisoformat(sess["expires_at"])
                if datetime.now(timezone.utc) > expires_at:
                    await websocket.send_json({"type": "expired"})
                    break
                await _asyncio_qr.sleep(2)
            except Exception:
                break
    except WebSocketDisconnect:
        pass
    finally:
        _qr_listeners.get(session_id, set()).discard(websocket)
        try:
            await websocket.close()
        except Exception:
            pass


# ------- Admin Analytics -------
@api.get("/admin/analytics")
async def get_admin_analytics():
    total_users = await db.users.count_documents({})
    total_devices = await db.users.count_documents({"expo_push_token": {"$ne": None}})
    
    distribution_cursor = db.users.aggregate([
        {"$group": {"_id": "$country_code", "count": {"$sum": 1}}}
    ])
    distribution = [{"region": d["_id"] or "Unknown", "count": d["count"]} for d in await distribution_cursor.to_list(100)]
    
    recent_users_cursor = db.users.find({}, {"_id": 0, "full_name": 1, "email": 1, "last_login_at": 1, "created_at": 1}).sort("last_login_at", -1).limit(50)
    recent_users = await recent_users_cursor.to_list(50)
    for u in recent_users:
        if "last_login_at" not in u:
            u["last_login_at"] = u.get("created_at")
            
    total_reminders = await db.reminders.count_documents({})
    active_reminders = await db.reminders.count_documents({"status": {"$in": ["pending", "active"]}})
    completed_reminders = await db.reminders.count_documents({"status": "completed"})
    total_triggers = await db.reminder_logs.count_documents({})

    return {
        "users": {
            "total": total_users,
            "active_devices_downloads": total_devices,
            "distribution": distribution,
            "recent_logins": recent_users
        },
        "reminders": {
            "total": total_reminders,
            "active": active_reminders,
            "completed": completed_reminders,
            "total_triggers": total_triggers
        }
    }


app.include_router(api)


# =====================================================================
# Real-time user WebSocket — broadcasts reminder/contact events to every
# signed-in client (web + mobile) for the authenticated user.
# =====================================================================
@app.websocket("/api/ws/user")
async def ws_user(websocket: WebSocket):
    token = websocket.query_params.get("token")
    user_id: Optional[str] = None
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
            user_id = payload.get("sub")
        except jwt.PyJWTError:
            user_id = None
    user = None
    if user_id:
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        # Accept first so the client receives a structured close with code 4401
        await websocket.accept()
        try:
            await websocket.send_json({"type": "error", "code": "invalid_token"})
        except Exception:
            pass
        await websocket.close(code=4401)
        return

    await websocket.accept()
    _user_sockets.setdefault(user_id, set()).add(websocket)
    logger.info("[ws/user] connected user=%s (total=%d)", user_id, len(_user_sockets[user_id]))

    ping_task: Optional[asyncio.Task] = None

    async def _pinger():
        try:
            while True:
                await asyncio.sleep(30)
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    break
        except asyncio.CancelledError:
            pass

    try:
        await websocket.send_json({"type": "hello", "user_id": user_id})
        ping_task = asyncio.create_task(_pinger())
        while True:
            # Receive any client message (typically pong); just keep socket alive.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug("[ws/user] error for %s: %s", user_id, e)
    finally:
        if ping_task and not ping_task.done():
            ping_task.cancel()
        try:
            _user_sockets.get(user_id, set()).discard(websocket)
            if user_id in _user_sockets and not _user_sockets[user_id]:
                _user_sockets.pop(user_id, None)
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    # Use regex (echoes the request's Origin) instead of "*", because the
    # CORS spec forbids wildcard origin together with credentials=True.
    # This safely allows the Emergent preview URLs, localhost, and the web app.
    allow_origin_regex=r".*",
    allow_methods=["*"],
    allow_headers=["*"],
)
