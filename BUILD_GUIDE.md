# Remindly — Build & Push Notifications Guide

Expo Go (the free app from the store) **does not** receive remote Expo push notifications in SDK 53+.
To test push on a real device you must build either a **Development Build** (for dev/testing) or a **Production Build** (for release).

This project is already configured with:
- `expo-notifications` (plugin + runtime)
- `expo-dev-client` (so you can use `npx expo start --dev-client`)
- Proper Android permissions (`NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `VIBRATE`, `WAKE_LOCK`)
- iOS usage description for notifications
- `eas.json` with `development`, `preview`, and `production` profiles

---

## Prerequisites (one-time)

### 1. Install EAS CLI on your local machine
```bash
npm i -g eas-cli
```

### 2. Sign in with your Expo account
```bash
eas login
```
If you don't have an Expo account, sign up free at <https://expo.dev/signup>.

### 3. Edit `app.json` and replace:
- `"owner": "REPLACE_WITH_YOUR_EXPO_USERNAME"` → your Expo username
- `"bundleIdentifier": "com.remindly.app"` → a unique iOS bundle id (e.g. `com.yourname.remindly`)
- `"package": "com.remindly.app"` → a unique Android package name (same pattern)

### 4. Link the project to EAS (this writes the real `projectId`)
Run from `/app/frontend`:
```bash
cd frontend
eas init
```
This prompts you to choose/create the project and overwrites `extra.eas.projectId` in `app.json`.

### 5. (Android only) Add Firebase credentials for FCM
Expo push on Android uses Firebase Cloud Messaging.
1. Go to <https://console.firebase.google.com> → **Add project** → any name.
2. Click Android → enter the same package name as in `app.json` (e.g. `com.yourname.remindly`).
3. Download `google-services.json`.
4. Place it at `frontend/google-services.json` (referenced in app.json).
5. Upload the FCM V1 service-account JSON to Expo:
   ```bash
   eas credentials        # pick Android → production/development → FCM V1
   ```
   (Or upload from the Expo dashboard → Project → Credentials → Android.)

iOS Push credentials (APNs key) are generated automatically the first time you run `eas build -p ios` — just say "yes" to the prompts.

---

## Build a Development Client (recommended for testing push on device)

A development client is like your own "custom Expo Go". Once installed on your phone, running `npx expo start --dev-client` streams JS bundles over the network exactly like Expo Go — but with your real native config (notifications, bundle id, etc.).

### Android APK (easiest — no Mac required, installs via sideload)
```bash
cd frontend
eas build --profile development --platform android
```
EAS builds the APK in the cloud (~10–15 min), then gives you a URL or QR code. Open it on your Android phone, allow "Install unknown apps" for your browser, and install the APK.

### iOS (device or simulator)
```bash
# iOS Simulator build (opens on macOS simulator)
eas build --profile development --platform ios --simulator

# Real iPhone (must register your device UDID first)
eas device:create
eas build --profile development --platform ios
```
For real iPhone, EAS walks you through registering your device's UDID; the resulting `.ipa` is installed via TestFlight or the link/QR EAS gives you.

### Run the dev client against the backend
With the dev client installed on your device, from your laptop run:
```bash
cd frontend
npx expo start --dev-client
```
Open the dev-client app on your phone → it scans the QR or you paste the URL → your JS bundle loads, `registerForPush()` fires, a real `ExponentPushToken[…]` is saved to the backend, and future reminders deliver as real push notifications.

---

## Build a Production / Preview client

### Preview — internal distribution APK / signed IPA (still using the same preview backend)
```bash
eas build --profile preview --platform android
eas build --profile preview --platform ios
```

### Production — Play Store bundle & App Store IPA
1. Edit `eas.json` → `build.production.env.EXPO_PUBLIC_BACKEND_URL` → your **production** FastAPI domain.
2. Build:
   ```bash
   eas build --profile production --platform android
   eas build --profile production --platform ios
   ```
3. Submit to stores:
   ```bash
   eas submit --profile production --platform android
   eas submit --profile production --platform ios
   ```
   (First iOS submit will prompt for your Apple ID, team ID, and ASC app ID — update the `submit.production.ios` block in `eas.json` in advance to skip prompts.)

---

## Verifying push works end-to-end

1. Install the dev or preview client on your device and sign in.
2. Go to Profile — the "Notifications" row should say **Enabled** (backend received your token).
3. Create a reminder scheduled 30 seconds in the future with the **App Notification** channel checked.
4. Lock your phone. You should see a banner pop within a few seconds of the scheduled time.
5. Backend logs (`tail -f /var/log/supervisor/backend.out.log`) will show `[push] -> 200 {...}`.

### Debugging push
- No token on Profile → the device is either a simulator or permissions were denied. Uninstall/reinstall the dev client, or re-run permission prompt.
- `DeviceNotRegistered` in logs → the token was rotated. On next app open `registerForPush()` will refresh it.
- `InvalidCredentials` on Android → FCM V1 service account not uploaded to Expo (`eas credentials`).

---

## Useful commands cheat-sheet
```bash
eas build:list                     # list recent builds
eas build:view <build-id>          # download URL + logs
eas update --channel development   # OTA ship JS-only fix to dev channel
eas update --channel production    # OTA ship JS-only fix to production
eas channel:edit production --branch production
```

---

## What stays server-side
The backend already sends push via Expo's HTTP API (no key needed):
```
POST https://exp.host/--/api/v2/push/send
```
See `send_expo_push()` in `/app/backend/server.py`. It works identically for development and production tokens.

Once you plug Twilio (`TWILIO_*`) and Resend (`RESEND_*`) keys into `/app/backend/.env` and restart the backend, WhatsApp / SMS / Email channels go live alongside push — no frontend changes required.
