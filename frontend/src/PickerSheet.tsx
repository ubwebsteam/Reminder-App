import React, { useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform, ScrollView } from "react-native";
import { colors, radius, spacing } from "./theme";
import { Button } from "./ui";
import { Ionicons } from "@expo/vector-icons";

type Props = {
  visible: boolean;
  initial?: Date;
  mode: "date" | "time";
  onClose: () => void;
  onConfirm: (d: Date) => void;
};

/**
 * Cross-platform date & time picker. On web we use simple spinners
 * (native <input> works poorly inside Expo web). On native we'd ideally
 * use @react-native-community/datetimepicker, but this approach is
 * consistent across platforms and avoids Metro issues.
 */
export function PickerSheet({ visible, initial, mode, onClose, onConfirm }: Props) {
  const [d, setD] = useState<Date>(initial || new Date());

  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const curYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => curYear + i);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const mins = Array.from({ length: 60 }, (_, i) => i);

  const set = (patch: Partial<{ day: number; month: number; year: number; hour: number; minute: number }>) => {
    const nd = new Date(d);
    if (patch.year !== undefined) nd.setFullYear(patch.year);
    if (patch.month !== undefined) nd.setMonth(patch.month);
    if (patch.day !== undefined) nd.setDate(patch.day);
    if (patch.hour !== undefined) nd.setHours(patch.hour);
    if (patch.minute !== undefined) nd.setMinutes(patch.minute);
    setD(nd);
  };

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={onClose} testID="picker-cancel">
              <Text style={{ color: colors.textMuted, fontSize: 15 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.title}>{mode === "date" ? "Pick date" : "Pick time"}</Text>
            <View style={{ width: 50 }} />
          </View>

          {mode === "date" ? (
            <View style={styles.row}>
              <Wheel label="Day" items={days.map(String)} value={String(d.getDate())} onChange={(v) => set({ day: Number(v) })} />
              <Wheel label="Month" items={months} value={months[d.getMonth()]} onChange={(v) => set({ month: months.indexOf(v) })} />
              <Wheel label="Year" items={years.map(String)} value={String(d.getFullYear())} onChange={(v) => set({ year: Number(v) })} />
            </View>
          ) : (
            <View style={styles.row}>
              <Wheel label="Hour" items={hours.map((x) => String(x).padStart(2, "0"))} value={String(d.getHours()).padStart(2, "0")} onChange={(v) => set({ hour: Number(v) })} />
              <Wheel label="Min" items={mins.map((x) => String(x).padStart(2, "0"))} value={String(d.getMinutes()).padStart(2, "0")} onChange={(v) => set({ minute: Number(v) })} />
            </View>
          )}

          <Button
            label="Confirm"
            onPress={() => {
              onConfirm(d);
              onClose();
            }}
            testID="picker-confirm"
            style={{ marginTop: spacing.md }}
          />
        </View>
      </View>
    </Modal>
  );
}

function Wheel({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 8, fontWeight: "600" }}>{label}</Text>
      <ScrollView
        showsVerticalScrollIndicator={false}
        style={{ height: 180, width: "100%" }}
        contentContainerStyle={{ paddingVertical: 70 }}
      >
        {items.map((it) => {
          const selected = it === value;
          return (
            <TouchableOpacity
              key={it}
              onPress={() => onChange(it)}
              style={{
                paddingVertical: 8,
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: selected ? colors.primary : colors.textMuted,
                  fontSize: selected ? 22 : 16,
                  fontWeight: selected ? "700" : "500",
                }}
              >
                {it}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: Platform.OS === "ios" ? 40 : spacing.lg,
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    backgroundColor: colors.border,
    borderRadius: 3,
    marginBottom: spacing.md,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  row: { flexDirection: "row", backgroundColor: colors.background, borderRadius: radius.lg, padding: 10 },
});
