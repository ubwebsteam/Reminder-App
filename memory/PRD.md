# Remindly — Product Requirements Document

## Overview
Remindly is a full-featured cross-platform reminder app built with React Native Expo + FastAPI + MongoDB. Users schedule events and receive reminders through multiple channels: App push, WhatsApp, Email, SMS (India only).

## User Stories
- As a user, I can sign up with email + phone + password.
- As a user, I can sign in and stay signed in until I log out.
- As a user, I can create a reminder with a title, custom message, date, time, lead time, and repeat frequency.
- As a user, I can choose delivery channels per reminder (push, whatsapp, email, sms).
- As a user, I can create a reminder for myself or someone else.
- As a user, I can save a contact (person) for future reminders.
- As a user, I can view active reminders on the dashboard and open a detail screen.
- As a user, I can Mark as Completed, Postpone 30m, or Cancel a reminder from the detail view.
- As a user, I can view a history of all past reminders with status & trigger count.
- As a user outside India, the SMS option is hidden automatically.
- As a user creating a reminder for someone else, I can tap "Send" to open WhatsApp/SMS/Email with a prefilled message.

## Architecture
### Backend — FastAPI (Python)
- JWT auth with bcrypt password hashing (30-day token)
- MongoDB collections: `users`, `reminders`, `contacts`, `reminder_logs`
- APScheduler (AsyncIOScheduler) with in-memory job store; on startup, reloads all pending reminders
- Multi-channel dispatch: `_fire_reminder` calls Expo Push, Twilio WhatsApp, Twilio SMS, Resend Email — gracefully mocks when credentials absent
- Repeat logic: first fire at `scheduled_at - lead_minutes`; subsequent fires every `repeat_interval_hours` until `triggered_count >= repeat_count`
- Status machine: `pending` → `completed|cancelled`

### Frontend — Expo + expo-router
Routes:
- `/` — animated splash, routes to auth or app
- `/(auth)/login`, `/(auth)/signup`
- `/(app)/dashboard` (FAB), `/(app)/history`, `/(app)/contacts`, `/(app)/profile`
- `/reminder/create` — 4-step wizard
- `/reminder/[id]` — detail with action buttons and channel send deep links

## Integrations (currently MOCKED — no keys provided yet)
- **Twilio WhatsApp + SMS**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_WHATSAPP_FROM`
- **Resend Email**: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- **Expo Push**: works with no key (Expo Push Service is free/public)

When keys are provided in `/app/backend/.env` and the backend restarts, real messages will be sent automatically.

## Key API endpoints
- `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/push-token`
- `GET|POST /api/reminders`, `GET /api/reminders/history`, `GET|PATCH|DELETE /api/reminders/:id`, `POST /api/reminders/:id/action`
- `GET|POST /api/contacts`, `DELETE /api/contacts/:id`
- `GET /api/health`

## Future enhancements
- Calendar view & natural-language reminder input ("remind me tomorrow at 8")
- Location-based reminders (geofencing)
- Shared reminders / family groups
- Premium tier with unlimited reminders & priority WhatsApp sender
