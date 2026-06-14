import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { useAuth } from "../../src/auth";
import { apiFetch } from "../../src/api";
import { Button, Card, SectionTitle } from "../../src/ui";
import { colors, radius, spacing } from "../../src/theme";

export default function Profile() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.title}>Profile</Text>

        <Card style={{ marginTop: spacing.lg, alignItems: "center", paddingVertical: spacing.xl }}>
          <View style={styles.avatar}>
            <Text style={{ color: "#fff", fontSize: 28, fontWeight: "800" }}>
              {(user?.full_name || "U").slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.name}>{user?.full_name}</Text>
          <Text style={styles.meta}>{user?.email}</Text>
          <Text style={styles.meta}>{user?.country_code} {user?.phone}</Text>
        </Card>

        <View style={{ marginTop: spacing.lg }}>
          <SectionTitle>Account</SectionTitle>
          <Card>
            <Row icon="notifications-outline" label="Notifications" value={user?.expo_push_token ? "Enabled" : "Not set"} />
            <Divider />
            <Row icon="shield-checkmark-outline" label="Security" value="Password protected" />
            <Divider />
            <Row icon="globe-outline" label="Region" value={user?.country_code || "+91"} />
          </Card>
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <SectionTitle>Rymind Web</SectionTitle>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.push("/linked-devices")}
            testID="open-linked-devices"
          >
            <Card>
              <Row
                icon="qr-code-outline"
                label="Linked devices"
                value="Scan to sign in"
                chevron
              />
            </Card>
          </TouchableOpacity>
        </View>

        <View style={{ marginTop: spacing.xl }}>
          <Button
            label="Sign out"
            variant="secondary"
            icon="log-out-outline"
            onPress={async () => {
              await logout();
              router.replace("/(auth)/login");
            }}
            testID="logout-btn"
          />
        </View>

        <View style={{ marginTop: spacing.lg }}>
          <SectionTitle>Legal</SectionTitle>
          <Card>
            <TouchableOpacity activeOpacity={0.7} onPress={() => Linking.openURL("https://www.rymind.in/privacy-policy")} testID="open-privacy-policy">
              <Row icon="document-text-outline" label="Privacy Policy" chevron />
            </TouchableOpacity>
            <Divider />
            <TouchableOpacity activeOpacity={0.7} onPress={() => Linking.openURL("https://www.rymind.in/terms-of-service")} testID="open-terms">
              <Row icon="reader-outline" label="Terms of Service" chevron />
            </TouchableOpacity>
          </Card>
        </View>

        {/* Danger Zone — Delete Account */}
        <View style={{ marginTop: spacing.xl }}>
          <SectionTitle>Danger Zone</SectionTitle>
          <Card style={styles.dangerCard}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
              <View style={styles.dangerIcon}>
                <Ionicons name="warning" size={18} color={colors.danger} />
              </View>
              <Text style={styles.dangerTitle}>Delete Account</Text>
            </View>
            <Text style={styles.dangerDesc}>
              Permanently delete your account and all associated data including reminders, contacts, history, and linked web sessions. This action cannot be undone.
            </Text>
            <TouchableOpacity
              style={[styles.dangerBtn, deleting && { opacity: 0.5 }]}
              disabled={deleting}
              onPress={() => {
                Alert.alert(
                  "Delete your account?",
                  "This will permanently delete your account, all reminders, contacts, history, and linked devices. This action CANNOT be undone.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete permanently",
                      style: "destructive",
                      onPress: async () => {
                        setDeleting(true);
                        try {
                          await apiFetch("/auth/account", { method: "DELETE" });
                          await logout();
                          router.replace("/(auth)/login");
                          Alert.alert("Account deleted", "Your account and all data have been permanently removed.");
                        } catch (e: any) {
                          Alert.alert("Error", e.message || "Failed to delete account. Please try again.");
                        } finally {
                          setDeleting(false);
                        }
                      },
                    },
                  ]
                );
              }}
              testID="delete-account-btn"
            >
              {deleting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="trash" size={16} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.dangerBtnText}>Delete my account</Text>
                </>
              )}
            </TouchableOpacity>
          </Card>
        </View>

        <Text style={styles.footer}>Rymind · v{Application.nativeApplicationVersion || Constants.expoConfig?.version || ""}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, label, value, chevron }: { icon: any; label: string; value?: string; chevron?: boolean }) {
  return (
    <View style={rowStyles.row}>
      <View style={rowStyles.iconWrap}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <Text style={{ flex: 1, fontSize: 15, color: colors.text, fontWeight: "600" }}>{label}</Text>
      {value ? <Text style={{ color: colors.textMuted, fontSize: 13, marginRight: chevron ? 6 : 0 }}>{value}</Text> : null}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
    </View>
  );
}
function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 6 }} />;
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  iconWrap: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primaryTint,
    alignItems: "center", justifyContent: "center", marginRight: 12,
  },
});

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary,
    alignItems: "center", justifyContent: "center", marginBottom: 12,
  },
  name: { fontSize: 20, fontWeight: "800", color: colors.text },
  meta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  footer: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: spacing.xxl },
  dangerCard: {
    borderWidth: 1,
    borderColor: "#EDD2D2",
    backgroundColor: "#FBF4F3",
    // Opaque tints + no elevation: Android renders its shadow through
    // translucent card backgrounds, which looked like a dark thick border
    elevation: 0,
    shadowOpacity: 0,
  },
  dangerIcon: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: "#F3DEDE",
    alignItems: "center", justifyContent: "center", marginRight: 12,
  },
  dangerTitle: {
    fontSize: 15, fontWeight: "700", color: colors.danger,
  },
  dangerDesc: {
    fontSize: 12, color: colors.textMuted, lineHeight: 18, marginBottom: 14,
  },
  dangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.danger,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  dangerBtnText: {
    color: "#fff", fontSize: 14, fontWeight: "700",
  },
});
