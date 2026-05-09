import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, Platform } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
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
};

export default function History() {
  const insets = useSafeAreaInsets();
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.sub}>Your past reminders and their outcomes.</Text>
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
        renderItem={({ item }) => (
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
              </Text>
            </View>
          </Card>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.lg },
  title: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  sub: { color: colors.textMuted, fontSize: 14, marginTop: 4 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.text, flex: 1, marginRight: 8 },
  msg: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  meta: { color: colors.textMuted, fontSize: 12, marginLeft: 6 },
  empty: { alignItems: "center", paddingVertical: 60 },
});
