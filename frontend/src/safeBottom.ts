/**
 * Centralised bottom-safe-area helper.
 *
 * With `edgeToEdgeEnabled: false` in app.json:
 *   - Android: OS reserves space for the nav bar — insets.bottom == 0 (correct)
 *   - iOS:     home-indicator height is reported as insets.bottom (e.g. 34)
 *
 * We just keep an 8dp minimum so sticky footers / FABs always feel like they
 * have breathing room above whatever the OS gives us.
 */
import { Platform } from "react-native";

export function getSafeBottom(insetsBottom: number): number {
  // iOS home-indicator: respect insets, minimum 8.
  // Android (with edge-to-edge OFF): the OS reserves nav space outside the app,
  //   so insets.bottom is 0 and an 8dp gap is exactly what looks right.
  return Math.max(insetsBottom, Platform.OS === "ios" ? 8 : 6);
}

export function getTabBarHeight(insetsBottom: number): number {
  return 60 + getSafeBottom(insetsBottom) + 8;
}
