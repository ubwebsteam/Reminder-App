import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Alert,
  Modal,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { apiFetch } from "../src/api";
import { colors, radius, spacing } from "../src/theme";
import { Card, Button, Badge } from "../src/ui";

type WebSession = {
  session_id: string;
  status: string;
  device_info?: { ua?: string; ip?: string; label?: string };
  approved_at?: string | null;
  last_seen_at?: string | null;
};

function deviceLabel(s: WebSession): string {
  if (s.device_info?.label) return s.device_info.label;
  const ua = (s.device_info?.ua || "").toLowerCase();
  let os = "Browser";
  if (ua.includes("windows")) os = "Windows";
  else if (ua.includes("mac")) os = "macOS";
  else if (ua.includes("linux")) os = "Linux";
  else if (ua.includes("android")) os = "Android";
  else if (ua.includes("iphone") || ua.includes("ipad")) os = "iOS";
  let browser = "browser";
  if (ua.includes("chrome")) browser = "Chrome";
  else if (ua.includes("safari")) browser = "Safari";
  else if (ua.includes("firefox")) browser = "Firefox";
  else if (ua.includes("edge")) browser = "Edge";
  return `${browser} on ${os}`;
}

function fmtTs(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function LinkedDevices() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<WebSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [perm, requestPerm] = useCameraPermissions();
  const [approving, setApproving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<WebSession[]>("/web-sessions");
      setSessions(data);
    } catch (e: any) {
      console.warn("load sessions failed", e);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  const openScanner = async () => {
    if (!perm) return;
    if (!perm.granted) {
      const res = await requestPerm();
      if (!res.granted) {
        Alert.alert(
          "Camera permission needed",
          "Enable camera access in settings to scan the QR code on Rymind Web."
        );
        return;
      }
    }
    setScannerOpen(true);
  };

  const onScanned = async ({ data }: { data: string }) => {
    if (approving) return;
    setApproving(true);
    let sid: string | null = null;
    try {
      const parsed = JSON.parse(data);
      if (parsed && parsed.v === 1 && typeof parsed.sid === "string") sid = parsed.sid;
    } catch {
      // Not JSON — maybe it's a plain UUID
      if (/^[0-9a-f-]{36}$/i.test(data.trim())) sid = data.trim();
    }
    if (!sid) {
      setApproving(false);
      Alert.alert("Invalid QR", "This QR isn't a Rymind Web sign-in code.");
      return;
    }
    try {
      const label = Platform.OS === "ios" ? "iPhone" : "Android phone";
      await apiFetch(`/web-sessions/${sid}/approve`, {
        method: "POST",
        body: JSON.stringify({ device_label: `Rymind on ${label}` }),
      });
      setScannerOpen(false);
      Alert.alert("Linked!", "You're now signed in on Rymind Web. Switch to your browser to continue.");
      await load();
    } catch (e: any) {
      const msg = e?.message?.includes("expired")
        ? "This QR has expired. Refresh the page on Rymind Web to get a new one."
        : e?.message?.includes("approved") || e?.message?.includes("409")
        ? "This QR has already been used."
        : e?.message || "Could not link. Try scanning again.";
      Alert.alert("Couldn't link", msg);
    } finally {
      setApproving(false);
    }
  };

  const revoke = (sid: string, label: string) => {
    Alert.alert(
      "Sign out this device?",
      `${label} will be signed out immediately.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: async () => {
            try {
              await apiFetch(`/web-sessions/${sid}`, { method: "DELETE" });
              await load();
            } catch (e: any) {
              Alert.alert("Error", e.message);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => router.back()} testID="ld-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Linked devices</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.heroCard}>
        <View style={styles.heroIcon}>
          <Ionicons name="qr-code" size={28} color={colors.primary} />
        </View>
        <Text style={styles.heroTitle}>Sign in to Rymind Web</Text>
        <Text style={styles.heroSub}>
          Open <Text style={{ fontWeight: "700" }}>rymind.in/web</Text> on your computer, then tap the button below to scan the QR.
        </Text>
        <Button
          label="Scan QR code"
          icon="scan"
          onPress={openScanner}
          testID="open-scanner"
          style={{ marginTop: spacing.md }}
        />
      </View>

      <Text style={styles.sectionLabel}>ACTIVE WEB SESSIONS</Text>

      <FlatList
        data={sessions}
        keyExtractor={(s) => s.session_id}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.lg + Math.max(insets.bottom, 0),
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="laptop-outline" size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              {loading ? "Loading…" : "No active web sessions yet."}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const label = deviceLabel(item);
          return (
            <Card style={{ marginBottom: 12 }} testID={`session-${item.session_id}`}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={styles.devIcon}>
                  <Ionicons name="laptop" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.devName}>{label}</Text>
                  <Text style={styles.devMeta}>
                    Signed in {fmtTs(item.approved_at)}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => revoke(item.session_id, label)}
                  hitSlop={12}
                  testID={`revoke-${item.session_id}`}
                >
                  <Ionicons name="log-out-outline" size={22} color={colors.danger} />
                </TouchableOpacity>
              </View>
            </Card>
          );
        }}
      />

      {/* QR Scanner Modal */}
      <Modal visible={scannerOpen} animationType="slide" onRequestClose={() => setScannerOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
          <View style={styles.scanTopRow}>
            <TouchableOpacity onPress={() => setScannerOpen(false)} testID="close-scanner">
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.scanTitle}>Scan Rymind Web QR</Text>
            <View style={{ width: 28 }} />
          </View>
          <View style={{ flex: 1, position: "relative" }}>
            {perm?.granted ? (
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={approving ? undefined : onScanned}
              />
            ) : (
              <View style={styles.permFallback}>
                <Ionicons name="camera-outline" size={48} color="#fff" />
                <Text style={{ color: "#fff", marginTop: 8 }}>Camera permission required</Text>
              </View>
            )}
            {/* Scanner overlay */}
            <View pointerEvents="none" style={styles.scanFrame}>
              <View style={styles.cornerTL} />
              <View style={styles.cornerTR} />
              <View style={styles.cornerBL} />
              <View style={styles.cornerBR} />
            </View>
            {approving && (
              <View style={styles.approveOverlay}>
                <ActivityIndicator color="#fff" />
                <Text style={{ color: "#fff", marginTop: 8 }}>Linking…</Text>
              </View>
            )}
          </View>
          <Text style={styles.scanHint}>
            Point your camera at the QR code on rymind.in/web
          </Text>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  topTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  heroCard: {
    marginHorizontal: spacing.lg,
    backgroundColor: colors.primaryTint,
    borderRadius: radius.xl,
    padding: spacing.lg,
    alignItems: "center",
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  heroTitle: { fontSize: 18, fontWeight: "800", color: colors.text, marginBottom: 6 },
  heroSub: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 19,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  devIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.primaryTint,
    alignItems: "center",
    justifyContent: "center",
  },
  devName: { fontSize: 15, fontWeight: "700", color: colors.text },
  devMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  empty: {
    alignItems: "center",
    paddingVertical: 32,
  },
  emptyText: {
    color: colors.textMuted,
    marginTop: 8,
    fontSize: 13,
  },
  scanTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  scanTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  scanFrame: {
    position: "absolute",
    top: "20%",
    left: "10%",
    right: "10%",
    aspectRatio: 1,
  },
  cornerTL: { position: "absolute", top: 0, left: 0, width: 32, height: 32, borderTopWidth: 4, borderLeftWidth: 4, borderColor: "#fff", borderTopLeftRadius: 8 },
  cornerTR: { position: "absolute", top: 0, right: 0, width: 32, height: 32, borderTopWidth: 4, borderRightWidth: 4, borderColor: "#fff", borderTopRightRadius: 8 },
  cornerBL: { position: "absolute", bottom: 0, left: 0, width: 32, height: 32, borderBottomWidth: 4, borderLeftWidth: 4, borderColor: "#fff", borderBottomLeftRadius: 8 },
  cornerBR: { position: "absolute", bottom: 0, right: 0, width: 32, height: 32, borderBottomWidth: 4, borderRightWidth: 4, borderColor: "#fff", borderBottomRightRadius: 8 },
  permFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  approveOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  scanHint: {
    color: "#fff",
    textAlign: "center",
    paddingVertical: spacing.md,
    fontSize: 13,
  },
});
