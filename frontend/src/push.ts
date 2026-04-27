import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { apiFetch } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }) as any,
});

export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (!Device.isDevice) return null;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return null;
    const projectId =
      (Constants?.expoConfig as any)?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;
    const tokenRes = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const token = tokenRes.data;
    try {
      await apiFetch("/auth/push-token", { method: "POST", body: JSON.stringify({ token }) });
    } catch {
      // ignore — user may not be authed yet
    }
    return token;
  } catch (e) {
    console.warn("push register failed", e);
    return null;
  }
}
