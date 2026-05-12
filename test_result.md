#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Implement automatic delivery for SELF reminders via Twilio (WhatsApp/SMS) and
  Resend (Email). For OTHER reminders, keep the existing manual "Send" flow.
  Real API keys have been provided and added to backend/.env.

backend:
  - task: "WhatsApp production sender + Content Template integration"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py, /app/backend/.env"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: |
          Switched from Twilio sandbox (whatsapp:+14155238886) to real WhatsApp
          Business sender (whatsapp:+15558905874 — display name "Rymind", status
          Online, throughput 80 MPS). Added TWILIO_WA_CONTENT_SID
          (HX1843cf05b6cb64e19072c561a07d9d86, template "reminder_notification_new",
          approved by Meta as UTILITY category in English).

          Updated send_whatsapp() to accept template_vars dict and use Twilio
          Content API when TWILIO_WA_CONTENT_SID is set — required by Meta for
          proactive sends outside the 24-hour conversation window. Falls back to
          free-form body if template_vars not provided (preserves OTHER-reminder
          flow where user manually sends from their device).

          _fire_reminder now passes {"1": title, "2": message, "3": when_str}
          as template variables for SELF reminders.

  - task: "Auto-send for SELF reminders (Twilio WhatsApp + SMS, Resend Email)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: |
          Wired real Twilio + Resend keys into /app/backend/.env. Backend health
          now reports {"twilio":true,"resend":true}. Enhanced message templates:
            - WhatsApp: includes title, message, formatted timestamp in user TZ
            - SMS: compact one-line with timestamp
            - Email: branded HTML template (header pill + body + footer)
          Wrapped each per-channel send in try/except so a 3rd-party failure
          can't crash the scheduler. For SELF reminders, all selected channels
          (push/whatsapp/sms/email) auto-fire. For OTHER reminders, non-push
          channels are still added to pending_channels for manual Send.
        -working: true
        -agent: "testing"
        -comment: |
          End-to-end backend test executed via /app/backend_test.py against
          public preview URL (EXPO_PUBLIC_BACKEND_URL/api). Created 5
          reminders covering all flows; results from Mongo last_results +
          reminder_logs and from /api/reminders/{id}:

          1) GET /api/health
             {ok:true, scheduler_running:true,
              integrations:{twilio:true, resend:true}}  ✅

          2) SELF email-only (channels=["email"], repeat_count=1)
             - triggered_count=1, status=completed, pending_channels=[]
             - last_results={"email": false}
             - reminder_logs has 1 entry
             - Backend log: "[email] failed: The rymind.com domain is not
               verified. Please, add and verify your domain on
               https://resend.com/domains"
             ⚠️ CONFIG ISSUE (not code): Resend rejects every send because
             RESEND_FROM_EMAIL=noreply@rymind.com points to an unverified
             domain. Code path is wired correctly — Resend SDK is invoked,
             the API call returns an error, and we record `false` without
             crashing. To get last_results.email=true, the operator must
             either verify rymind.com on resend.com/domains, OR temporarily
             set RESEND_FROM_EMAIL=onboarding@resend.dev (Resend's built-in
             test sender, which only delivers to the account owner's email).

          3) SELF push+email (channels=["push","email"])
             - triggered=1, status=completed, pending=[]
             - last_results={"email": false} — same Resend domain issue.
               Push not present because user has no expo_push_token in the
               test signup (web testing) — the code branch correctly skips
               push when token is missing.

          4) OTHER email (target.is_self=false, channels=["email"])
             - triggered=1, status=pending (NOT auto-completed) ✅
             - pending_channels=["email"] ✅
             - needs_user_send=true ✅
             - last_results={} (no auto-send attempted) ✅
             OTHER-reminder path is correct and unchanged.

          5) SELF SMS-only (channels=["sms"])
             - triggered=1, status=completed, last_results={"sms": false}
             - Backend log: "[sms] failed: HTTP 400 error: ... The number
               +91987654XXXX is unverified. Trial accounts cannot send
               messages to unverified numbers"
             ⚠️ CONFIG ISSUE (not code): Twilio account is on trial. Trial
             accounts can only SMS verified numbers. Code path wired
             correctly — twilio.rest.Client called, exception caught,
             recorded as false, scheduler did NOT crash. Reminder still
             progresses and completes normally.

          6) SELF WhatsApp-only (channels=["whatsapp"])
             - triggered=1, status=completed, last_results={"whatsapp": true}
             - Twilio WhatsApp sandbox accepted the submission (the receiver
               must have joined the sandbox by texting "join <code>" to
               +14155238886 to actually see the message — but from the API
               perspective the call succeeded).

          Verdict on plumbing/code:
          - _fire_reminder is RESILIENT — every channel is wrapped in
            try/except, Twilio/Resend exceptions cannot crash the scheduler
            (verified: 5 firings, zero tracebacks in backend.err.log).
          - last_results is correctly persisted on the reminder doc and
            mirrored in reminder_logs.
          - SELF reminders auto-attempt all channels; OTHER reminders
            correctly queue non-push channels to pending_channels.
          - status transitions and triggered_count work for both self
            (auto-completes when triggered_count==repeat_count) and other
            (stays pending until user marks-sent).

          The two `false` results are entirely due to external config
          (unverified Resend domain, Twilio trial account), NOT a bug in
          the code. The user-provided review-request explicitly flagged
          the email side as expected ("if it's not verified, email sends
          will return false. That's still useful info"). Marking task
          working=true because the implementation is correct end-to-end;
          to verify actual delivery the operator must (a) verify
          rymind.com on Resend, and (b) verify the recipient phone on
          Twilio (or upgrade off trial).

  - task: "Push token retry with exponential backoff"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/push.ts"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: |
          Added retry logic (immediate, +2s, +4s, +8s) for FCM SERVICE_NOT_AVAILABLE
          on built APK. Module-level in-flight guard prevents duplicate parallel
          registrations. Auth flow now calls refreshPushTokenAfterAuth on login/signup.

frontend:
  - task: "Safe-area aware bottom UI across all screens"
    implemented: true
    working: true
    file: "/app/frontend/app/(app)/_layout.tsx, dashboard.tsx, history.tsx, contacts.tsx, reminder/create.tsx, reminder/[id].tsx, src/PickerSheet.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: true
        -agent: "main"
        -comment: |
          All bottom-pinned UI (tab bar, FAB, action footers, modal sheets,
          picker sheets) now use useSafeAreaInsets() dynamically instead of
          hardcoded Platform.OS Platform-specific magic numbers. Verified via
          screenshot — Dashboard tab bar fully visible, FAB above, no overlap.

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 0
  run_ui: false

test_plan:
  current_focus: []
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: |
      Twilio + Resend keys are now live in backend/.env. Please test:
      1. Health: GET /api/health should report integrations.twilio=true & resend=true
      2. Sign in as test@example.com / test123 (existing user)
      3. Update the user profile email to a verified address (or use the seeded one)
         and phone to a real number where you'd receive messages.
      4. Create a SELF reminder triggered ~30s from now with channels [push, email]
         (don't actually require WhatsApp+SMS unless we have an opt-in number).
      5. Wait for the trigger and check:
         - reminder_logs collection should have one entry per fire with results map
         - results.email should be true
         - reminder.last_results.email should be true
         - reminder status should advance (triggered_count++)
      6. Create an OTHER reminder with channels [push, email]; after fire,
         pending_channels should still contain "email" (manual send not auto-sent).
      Note: WhatsApp from Twilio sandbox requires the destination phone to first
      send "join <code>" to +14155238886. If WA fails, that's expected for
      non-opted-in numbers — the test should focus on email + sms paths.
    -agent: "testing"
    -message: |
      Backend e2e test complete. /app/backend_test.py runs all 6 review-request
      scenarios against EXPO_PUBLIC_BACKEND_URL/api. Results:

      ✅ Health → integrations.twilio=true, integrations.resend=true
      ✅ SELF email reminder fires; auto-completes; reminder_logs entry created;
         scheduler resilient — BUT last_results.email=false.
         Resend API explicitly rejects with: "The rymind.com domain is not
         verified." This is a CONFIG issue, not a code bug. The send IS
         attempted; the exception is caught; the failure is recorded.
      ✅ SELF push+email — same email outcome (false) due to unverified
         Resend domain. Push not attempted because the test user has no
         expo_push_token (web signup) — correct skip behavior.
      ✅ OTHER reminder correctly queues email to pending_channels; status
         stays "pending"; needs_user_send=true; last_results is empty.
         No regression — the OTHER path is unchanged and working.
      ✅ SELF SMS fires; last_results.sms=false because Twilio trial account
         can't message unverified +91987654XXXX. Scheduler did not crash;
         reminder still completed.
      ✅ SELF WhatsApp fires; last_results.whatsapp=true (Twilio sandbox
         accepted the submission). Receiver still needs to "join <code>"
         with +14155238886 to actually see the message — that's outside
         backend scope.

      Code verdict: SELF auto-send plumbing is CORRECT and RESILIENT. Each
      channel is wrapped in try/except, twilio + resend SDKs are invoked
      synchronously via asyncio.to_thread (good), failures are caught and
      stored in last_results without crashing the scheduler (verified —
      zero tracebacks). reminder_logs and last_results are populated as
      designed. is_self vs is_self=false branching is correct.

      External-config items the operator must address to see actual
      delivery (NOT code bugs):
        a) Verify rymind.com on https://resend.com/domains, OR set
           RESEND_FROM_EMAIL=onboarding@resend.dev (Resend test sender,
           delivers only to the account owner's email).
        b) Twilio account is on trial — either upgrade, or verify each
           recipient phone at twilio.com/user/account/phone-numbers/verified.
        c) For WhatsApp sandbox, recipients must send "join <sandbox-code>"
           to +14155238886.

      Marked task working=true. No code changes needed. Test artefact:
      /app/backend_test.py.