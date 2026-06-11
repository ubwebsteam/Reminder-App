import AsyncStorage from "@react-native-async-storage/async-storage";
import * as StoreReview from "expo-store-review";

/**
 * Native in-app rating (Google Play In-App Review / iOS SKStoreReviewController).
 *
 * The card is requested when EITHER condition is met:
 *  - the user has created 5+ reminders, OR
 *  - 3+ days have passed since first use.
 *
 * Notes:
 *  - The OS decides whether the card actually appears (Play quota ≈ once a
 *    month per user, never again after they rate). The call gives no feedback,
 *    so we re-attempt at most once every 30 days — harmless if already rated.
 *  - Silently no-ops in Expo Go / sideloaded builds; the card only shows when
 *    the app was installed from a store (internal testing track counts).
 */

const FIRST_SEEN_KEY = "rymind.rating.firstSeenAt";
const COUNT_KEY = "rymind.rating.remindersCreated";
const LAST_PROMPT_KEY = "rymind.rating.lastPromptAt";

const MIN_REMINDERS = 5;
const MIN_DAYS_OF_USE = 3;
const REPROMPT_COOLDOWN_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Record the first-use timestamp once. Call on dashboard mount. */
export async function initRatingTracker(): Promise<void> {
  try {
    const seen = await AsyncStorage.getItem(FIRST_SEEN_KEY);
    if (!seen) await AsyncStorage.setItem(FIRST_SEEN_KEY, String(Date.now()));
  } catch {}
}

/** Call after a reminder is successfully created. */
export async function recordReminderCreated(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(COUNT_KEY);
    const n = (parseInt(raw || "0") || 0) + 1;
    await AsyncStorage.setItem(COUNT_KEY, String(n));
  } catch {}
}

/** Ask the OS for the native rating card if a milestone has been reached. */
export async function maybeAskForRating(): Promise<void> {
  try {
    const [firstSeenRaw, countRaw, lastPromptRaw] = await Promise.all([
      AsyncStorage.getItem(FIRST_SEEN_KEY),
      AsyncStorage.getItem(COUNT_KEY),
      AsyncStorage.getItem(LAST_PROMPT_KEY),
    ]);

    const now = Date.now();
    const lastPrompt = parseInt(lastPromptRaw || "0") || 0;
    if (lastPrompt && now - lastPrompt < REPROMPT_COOLDOWN_DAYS * DAY_MS) return;

    const count = parseInt(countRaw || "0") || 0;
    const firstSeen = parseInt(firstSeenRaw || "0") || 0;
    const enoughReminders = count >= MIN_REMINDERS;
    const enoughDays = firstSeen > 0 && now - firstSeen >= MIN_DAYS_OF_USE * DAY_MS;
    if (!enoughReminders && !enoughDays) return;

    if (!(await StoreReview.hasAction())) return;
    await AsyncStorage.setItem(LAST_PROMPT_KEY, String(now));
    await StoreReview.requestReview();
  } catch {}
}
