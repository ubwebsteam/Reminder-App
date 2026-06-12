import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { Platform } from "react-native";
import SpInAppUpdates, { IAUUpdateKind, IAUInstallStatus, StatusUpdateEvent } from "sp-react-native-in-app-updates";

/**
 * Soft update prompt — asks the stores directly whether a newer version exists.
 *
 *  - Android: Google Play In-App Updates (flexible) — native Play sheet,
 *    background download, installs without leaving the app.
 *  - iOS: iTunes lookup + alert that deep-links to the App Store page.
 *
 * Never blocks the user; "Later" snoozes the prompt for a few days. Silently
 * no-ops on web, in Expo Go, and in sideloaded builds (no store context).
 */

const LAST_PROMPT_KEY = "rymind.update.lastPromptAt";
const SNOOZE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function maybePromptForUpdate(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const lastRaw = await AsyncStorage.getItem(LAST_PROMPT_KEY);
    const last = parseInt(lastRaw || "0") || 0;
    if (last && Date.now() - last < SNOOZE_DAYS * DAY_MS) return;

    const curVersion = Application.nativeApplicationVersion;
    if (!curVersion) return;

    const inAppUpdates = new SpInAppUpdates(false);
    const result = await inAppUpdates.checkNeedsUpdate({ curVersion });
    if (!result?.shouldUpdate) return;

    await AsyncStorage.setItem(LAST_PROMPT_KEY, String(Date.now()));

    if (Platform.OS === "android") {
      // Flexible: Play sheet + background download; finish install once downloaded
      const onStatus = (event: StatusUpdateEvent) => {
        if (event.status === IAUInstallStatus.DOWNLOADED) {
          inAppUpdates.removeStatusUpdateListener(onStatus);
          inAppUpdates.installUpdate();
        }
      };
      inAppUpdates.addStatusUpdateListener(onStatus);
      await inAppUpdates.startUpdate({ updateType: IAUUpdateKind.FLEXIBLE });
    } else {
      await inAppUpdates.startUpdate({
        title: "Update available",
        message: "A new version of Rymind is available on the App Store.",
        buttonUpgradeText: "Update",
        buttonCancelText: "Later",
      });
    }
  } catch {
    // No store context (Expo Go, sideload) or network issue — never bother the user
  }
}
