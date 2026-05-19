import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/auth";
import { Button, Card, SectionTitle } from "../../src/ui";
import { colors, radius, spacing } from "../../src/theme";

export default function Profile() {
  const { user, logout } = useAuth();
  const router = useRouter();

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

        <Text style={styles.footer}>Remindly · v1.0.0</Text>
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
});
