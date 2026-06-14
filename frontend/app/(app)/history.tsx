import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, Platform, TouchableOpacity, Alert } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch } from "../../src/api";
import { colors, radius, spacing } from "../../src/theme";
import { Badge, Card } from "../../src/ui";
import { fmtDate } from "../../src/utils";

type Reminder = {
  id: string;
  title: string;
  message: string;
  scheduled_at: string;
  status: string;
  triggered_count: number;
  repeat_count: number;
  channels: string[];
  target?: { is_self: boolean; name?: string };
};

export default function History() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const tabBarSpace = 60 + Math.max(insets.bottom, Platform.OS === "ios" ? 8 : 6) + 8;
  const [items, setItems] = useState<Reminder[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const data = await apiFetch<Reminder[]>("/reminders/history");
      setItems(data);
    } catch (e) {
      console.warn(e);
    }
  };
  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  const statusColor = (s: string) =>
    s === "completed" ? colors.success : s === "cancelled" ? colors.danger : colors.warning;
  const statusLabel = (s: string) => (s === "completed" ? "Completed" : s === "cancelled" ? "Cancelled" : "Due");

  const reschedule = (id: string) => {
    router.push({ pathname: "/reminder/create", params: { prefill: id } });
  };

  const resend = (id: string) => {
    // Open the existing detail screen — already shows per-channel Send buttons
    // for non-self reminders, which is exactly the "resend" experience.
    router.push({ pathname: "/reminder/[id]", params: { id } });
  };

  const clearAll = () => {
    Alert.alert(
      "Clear all history?",
      "This permanently deletes all completed and cancelled reminders. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear all",
          style: "destructive",
          onPress: async () => {
            try {
              await apiFetch("/reminders/history", { method: "DELETE" });
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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>History</Text>
          <Text style={styles.sub}>Your past reminders and their outcomes.</Text>
        </View>
        {items.length > 0 && (
          <TouchableOpacity style={styles.clearBtn} onPress={clearAll} testID="clear-history" hitSlop={8}>
            <Ionicons name="trash-outline" size={15} color={colors.danger} />
            <Text style={styles.clearText}>Clear all</Text>
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, paddingBottom: tabBarSpace + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="archive-outline" size={44} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, marginTop: 8 }}>Nothing here yet</Text>
          </View>
        }
        renderItem={({ item }) => {
          const forOther = item.target && !item.target.is_self;
          return (
            <Card style={{ marginBottom: 12 }} testID={`history-${item.id}`}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Badge label={statusLabel(item.status)} color={statusColor(item.status)} />
              </View>
              {item.message ? <Text style={styles.msg} numberOfLines={2}>{item.message}</Text> : null}
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}>
                <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
                <Text style={styles.meta}>{fmtDate(item.scheduled_at)}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
                <Ionicons name="send-outline" size={13} color={colors.textMuted} />
                <Text style={styles.meta}>
                  Triggered {item.triggered_count}/{item.repeat_count} time{item.repeat_count === 1 ? "" : "s"}
                  {forOther ? ` · For ${item.target?.name || "contact"}` : ""}
                </Text>
              </View>

              {/* Action row */}
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionPrimary]}
                  onPress={() => reschedule(item.id)}
                  activeOpacity={0.85}
                  testID={`reschedule-${item.id}`}
                >
                  <Ionicons name="refresh" size={15} color="#fff" />
                  <Text style={styles.actionPrimaryText}>Reschedule</Text>
                </TouchableOpacity>
                {forOther && (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionSecondary]}
                    onPress={() => resend(item.id)}
                    activeOpacity={0.85}
                    testID={`resend-${item.id}`}
                  >
                    <Ionicons name="paper-plane" size={15} color={colors.primary} />
                    <Text style={styles.actionSecondaryText}>Resend</Text>
                  </TouchableOpacity>
                )}
              </View>
            </Card>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.lg, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  title: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  sub: { color: colors.textMuted, fontSize: 14, marginTop: 4 },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.danger,
    marginTop: 4,
  },
  clearText: { color: colors.danger, fontWeight: "700", fontSize: 13 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.text, flex: 1, marginRight: 8 },
  msg: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  meta: { color: colors.textMuted, fontSize: 12, marginLeft: 6 },
  empty: { alignItems: "center", paddingVertical: 60 },
  actionRow: {
    flexDirection: "row",
    marginTop: spacing.md,
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: radius.pill,
    gap: 6,
  },
  actionPrimary: {
    backgroundColor: colors.primary,
  },
  actionPrimaryText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
  actionSecondary: {
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  actionSecondaryText: {
    color: colors.primary,
    fontWeight: "700",
    fontSize: 13,
  },
});
