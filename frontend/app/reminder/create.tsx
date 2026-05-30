import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, Chip, Input, SectionTitle } from "../../src/ui";
import { PickerSheet } from "../../src/PickerSheet";
import { colors, radius, spacing } from "../../src/theme";
import { apiFetch } from "../../src/api";
import { useAuth } from "../../src/auth";
import { combineDateTime, fmtDate } from "../../src/utils";

type Channel = "push" | "whatsapp" | "email" | "sms";
type Contact = { id: string; name: string; phone?: string; email?: string };

const STEPS = ["Event", "Timing", "Delivery", "Target"];

export default function CreateReminder() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { prefill } = useLocalSearchParams<{ prefill?: string }>();
  const { user } = useAuth();
  const [step, setStep] = useState(0);

  // Step 1
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");

  // Step 2
  const now = useMemo(() => new Date(Date.now() + 5 * 60 * 1000), []);
  const [date, setDate] = useState<Date>(now);
  const [time, setTime] = useState<Date>(now);
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [repeatCount, setRepeatCount] = useState("1");
  const [repeatUnit, setRepeatUnit] = useState<"min" | "hour" | "day">("hour");
  const [repeatValue, setRepeatValue] = useState("24");

  // Step 3
  const [channels, setChannels] = useState<Channel[]>(["push"]);

  // Step 4
  const [isSelf, setIsSelf] = useState(true);
  const [targetName, setTargetName] = useState("");
  const [targetPhone, setTargetPhone] = useState("");
  const [targetEmail, setTargetEmail] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState<string | null>(null);
  const [savePerson, setSavePerson] = useState(false);

  const [saving, setSaving] = useState(false);
  const [savedSheet, setSavedSheet] = useState(false);
  const [isReschedule, setIsReschedule] = useState(false);

  const inIndia = (user?.country_code || "+91") === "+91";

  useEffect(() => {
    (async () => {
      try {
        setContacts(await apiFetch<Contact[]>("/contacts"));
      } catch {}
    })();
  }, []);

  // Prefill from an existing reminder (Reschedule flow)
  useEffect(() => {
    if (!prefill) return;
    (async () => {
      try {
        const r = await apiFetch<any>(`/reminders/${prefill}`);
        setIsReschedule(true);
        setTitle(r.title || "");
        setMessage(r.message || "");
        setChannels((r.channels || ["push"]) as Channel[]);
        setRepeatCount(String(r.repeat_count ?? 1));
        const hours = r.repeat_interval_hours ?? 24;
        if (hours < 1) {
          setRepeatUnit("min");
          setRepeatValue(String(Math.round(hours * 60)));
        } else if (hours % 24 === 0 && hours >= 24) {
          setRepeatUnit("day");
          setRepeatValue(String(hours / 24));
        } else {
          setRepeatUnit("hour");
          setRepeatValue(String(hours));
        }
        const t = r.target || {};
        setIsSelf(!!t.is_self);
        setTargetName(t.name || "");
        setTargetPhone(t.phone || "");
        setTargetEmail(t.email || "");
        if (r.contact_id) setContactId(r.contact_id);
      } catch (e) {
        // silently ignore — user will fill manually
      }
    })();
  }, [prefill]);

  const toggleChannel = (c: Channel) => {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };

  const computeRepeatHours = () => {
    const v = parseFloat(repeatValue) || 0;
    if (repeatUnit === "min") return v / 60;
    if (repeatUnit === "hour") return v;
    return v * 24;
  };

  const finalDateTime = combineDateTime(date, time);

  const validate = (): string | null => {
    if (step === 0) {
      if (!title.trim()) return "Please enter a title.";
    } else if (step === 1) {
      if (finalDateTime.getTime() < Date.now() - 60000) {
        return "Scheduled time is in the past.";
      }
      const rc = parseInt(repeatCount);
      if (!(rc >= 1)) return "Repeat count must be at least 1.";
      if (rc > 50) return "Repeat count can't exceed 50.";
      if (!(computeRepeatHours() > 0)) return "Repeat interval must be greater than 0.";
      if (computeRepeatHours() < 0.0167) return "Repeat interval must be at least 1 minute.";
    } else if (step === 2) {
      if (channels.length === 0) return "Select at least one delivery method.";
    } else if (step === 3) {
      if (!isSelf) {
        if (!targetName.trim()) return "Enter contact name.";
        if (channels.includes("whatsapp") && !targetPhone.trim()) return "WhatsApp number required.";
        if (channels.includes("sms") && !targetPhone.trim()) return "SMS phone required.";
        if (channels.includes("email") && !targetEmail.trim()) return "Email required.";
      }
    }
    return null;
  };

  const next = () => {
    const err = validate();
    if (err) return Alert.alert("Check inputs", err);
    setStep((s) => Math.min(3, s + 1));
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  const submit = async () => {
    const err = validate();
    if (err) return Alert.alert("Check inputs", err);
    setSaving(true);
    try {
      const body = {
        title: title.trim(),
        message: message.trim(),
        scheduled_at: finalDateTime.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        channels,
        repeat_count: parseInt(repeatCount) || 1,
        repeat_interval_hours: computeRepeatHours(),
        lead_minutes: 0,
        target: {
          is_self: isSelf,
          name: isSelf ? null : targetName.trim() || null,
          phone: isSelf ? null : targetPhone.trim() || null,
          email: isSelf ? null : targetEmail.trim() || null,
        },
        contact_id: contactId,
      };
      await apiFetch("/reminders", { method: "POST", body: JSON.stringify(body) });

      if (!isSelf && savePerson && !contactId) {
        try {
          await apiFetch("/contacts", {
            method: "POST",
            body: JSON.stringify({
              name: targetName.trim(),
              phone: targetPhone.trim() || null,
              email: targetEmail.trim() || null,
            }),
          });
        } catch {}
      }
      setSavedSheet(true);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {/* Header */}
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => (step === 0 ? router.back() : back())} testID="wizard-back">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>{isReschedule ? "Reschedule reminder" : "New reminder"}</Text>
        <View style={{ width: 26 }} />
      </View>

      {/* Progress */}
      <View style={styles.progress}>
        {STEPS.map((s, i) => (
          <View key={s} style={{ flex: 1, alignItems: "center" }}>
            <View style={[styles.pill, i <= step && styles.pillActive]} />
            <Text style={[styles.pillLabel, i === step && { color: colors.primary, fontWeight: "700" }]}>{s}</Text>
          </View>
        ))}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 180 }} keyboardShouldPersistTaps="handled">
          {step === 0 && (
            <>
              <SectionTitle>What should we remind you about?</SectionTitle>
              <Input label="Title" placeholder="e.g. Pay electricity bill" value={title} onChangeText={setTitle} testID="wizard-title" />
              <Input
                label="Custom message (optional)"
                placeholder="Include links, invoice numbers, etc."
                value={message}
                onChangeText={setMessage}
                multiline
                numberOfLines={4}
                style={{ height: 110, textAlignVertical: "top", paddingTop: 14 }}
                testID="wizard-message"
              />
            </>
          )}

          {step === 1 && (
            <>
              <SectionTitle>When should we trigger it?</SectionTitle>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TouchableOpacity style={[styles.pickBtn]} onPress={() => setShowDate(true)} testID="wizard-pick-date">
                  <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                  <Text style={styles.pickVal}>{date.toDateString()}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.pickBtn]} onPress={() => setShowTime(true)} testID="wizard-pick-time">
                  <Ionicons name="time-outline" size={18} color={colors.primary} />
                  <Text style={styles.pickVal}>
                    {String(time.getHours()).padStart(2, "0")}:{String(time.getMinutes()).padStart(2, "0")}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={[styles.label, { marginTop: spacing.lg }]}>Repeat</Text>
              <View style={{ flexDirection: "row" }}>
                <Input
                  label="Count"
                  placeholder="1"
                  keyboardType="numeric"
                  value={repeatCount}
                  onChangeText={setRepeatCount}
                  style={{ flex: 1 }}
                  testID="wizard-repeat-count"
                />
                <View style={{ width: 12 }} />
                <Input
                  label={`Every (${repeatUnit === "min" ? "minutes" : repeatUnit === "hour" ? "hours" : "days"})`}
                  placeholder="24"
                  keyboardType="numeric"
                  value={repeatValue}
                  onChangeText={setRepeatValue}
                  style={{ flex: 1 }}
                  testID="wizard-repeat-value"
                />
              </View>
              <View style={{ flexDirection: "row", marginTop: 4 }}>
                {(["min", "hour", "day"] as const).map((u) => (
                  <Chip
                    key={u}
                    label={u === "min" ? "Minutes" : u === "hour" ? "Hours" : "Days"}
                    selected={repeatUnit === u}
                    onPress={() => {
                      setRepeatUnit(u);
                      // sensible defaults when switching unit
                      if (u === "min" && (parseFloat(repeatValue) || 0) > 60) setRepeatValue("30");
                      if (u === "hour") setRepeatValue((prev) => (parseFloat(prev) || 0) > 48 ? "24" : prev);
                    }}
                    testID={`repeat-unit-${u}`}
                  />
                ))}
              </View>
              <Card style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.primaryTint, borderColor: "transparent", marginTop: spacing.md }}>
                <Ionicons name="flash" size={18} color={colors.primary} />
                <Text style={{ marginLeft: 8, color: colors.text, flex: 1 }}>
                  First fire at {fmtDate(finalDateTime.toISOString())}
                </Text>
              </Card>
            </>
          )}

          {step === 2 && (
            <>
              <SectionTitle>Pick delivery channels</SectionTitle>
              <View style={{ gap: 10 }}>
                <ChannelTile
                  icon="notifications-outline"
                  title="App Notification"
                  desc="Instant push on this device"
                  selected={channels.includes("push")}
                  onPress={() => toggleChannel("push")}
                  testID="ch-push"
                />
                <ChannelTile
                  icon="logo-whatsapp"
                  title="WhatsApp"
                  desc="Send a WhatsApp message"
                  selected={channels.includes("whatsapp")}
                  onPress={() => toggleChannel("whatsapp")}
                  testID="ch-whatsapp"
                />
                <ChannelTile
                  icon="mail-outline"
                  title="Email"
                  desc="Deliver to inbox"
                  selected={channels.includes("email")}
                  onPress={() => toggleChannel("email")}
                  testID="ch-email"
                />
                {inIndia ? (
                  <ChannelTile
                    icon="chatbubble-outline"
                    title="SMS"
                    desc="Text message (India only)"
                    selected={channels.includes("sms")}
                    onPress={() => toggleChannel("sms")}
                    testID="ch-sms"
                  />
                ) : (
                  <Card style={{ opacity: 0.55 }}>
                    <Text style={{ fontWeight: "700", color: colors.text }}>SMS not available</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 13 }}>Currently supported only for India users.</Text>
                  </Card>
                )}
              </View>
            </>
          )}

          {step === 3 && (
            <>
              <SectionTitle>Who is this for?</SectionTitle>
              <View style={{ flexDirection: "row", marginBottom: spacing.md }}>
                <Chip label="Myself" selected={isSelf} onPress={() => { setIsSelf(true); setContactId(null); }} icon="person-outline" testID="target-self" />
                <Chip label="Someone else" selected={!isSelf} onPress={() => setIsSelf(false)} icon="people-outline" testID="target-other" />
              </View>

              {!isSelf && (
                <>
                  {contacts.length > 0 && (
                    <>
                      <Text style={styles.label}>Pick from contacts</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
                        {contacts.map((c) => (
                          <TouchableOpacity
                            key={c.id}
                            style={[
                              styles.contactPill,
                              contactId === c.id && { backgroundColor: colors.primary, borderColor: colors.primary },
                            ]}
                            onPress={() => {
                              setContactId(c.id);
                              setTargetName(c.name);
                              setTargetPhone(c.phone || "");
                              setTargetEmail(c.email || "");
                            }}
                            testID={`pick-contact-${c.id}`}
                          >
                            <Text style={{ color: contactId === c.id ? "#fff" : colors.text, fontWeight: "600" }}>
                              {c.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </>
                  )}

                  <Input label="Name" placeholder="Recipient name" value={targetName} onChangeText={setTargetName} testID="target-name" />
                  {(channels.includes("whatsapp") || channels.includes("sms")) && (
                    <Input
                      label="Phone number"
                      placeholder="+91 9876543210"
                      keyboardType="phone-pad"
                      value={targetPhone}
                      onChangeText={setTargetPhone}
                      testID="target-phone"
                    />
                  )}
                  {channels.includes("email") && (
                    <Input
                      label="Email"
                      placeholder="person@example.com"
                      autoCapitalize="none"
                      keyboardType="email-address"
                      value={targetEmail}
                      onChangeText={setTargetEmail}
                      testID="target-email"
                    />
                  )}

                  {!contactId && (
                    <TouchableOpacity
                      style={styles.checkRow}
                      onPress={() => setSavePerson(!savePerson)}
                      testID="save-person-toggle"
                    >
                      <View style={[styles.checkbox, savePerson && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                        {savePerson && <Ionicons name="checkmark" size={14} color="#fff" />}
                      </View>
                      <Text style={{ color: colors.text }}>Save this person for future reminders</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Bottom action */}
      <View style={[styles.footer, { paddingBottom: spacing.lg + Math.max(insets.bottom, 0) }]}>
        {step < 3 ? (
          <Button label="Continue" onPress={next} testID="wizard-next" />
        ) : (
          <Button label="Create reminder" icon="checkmark-circle" onPress={submit} loading={saving} testID="wizard-submit" />
        )}
      </View>

      {/* Pickers */}
      <PickerSheet visible={showDate} initial={date} mode="date" onClose={() => setShowDate(false)} onConfirm={(d) => setDate(d)} />
      <PickerSheet visible={showTime} initial={time} mode="time" onClose={() => setShowTime(false)} onConfirm={(d) => setTime(d)} />

      {/* Saved success */}
      <Modal transparent animationType="fade" visible={savedSheet}>
        <View style={styles.overlay}>
          <View style={styles.successCard}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark" size={36} color="#fff" />
            </View>
            <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text, marginBottom: 6 }}>All set!</Text>
            <Text style={{ color: colors.textMuted, textAlign: "center", marginBottom: spacing.lg }}>
              Your reminder has been scheduled.
            </Text>
            <Button
              label="Back to dashboard"
              onPress={() => {
                setSavedSheet(false);
                router.replace("/(app)/dashboard");
              }}
              testID="success-dashboard"
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ChannelTile({
  icon,
  title,
  desc,
  selected,
  onPress,
  testID,
}: {
  icon: any;
  title: string;
  desc: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} testID={testID}>
      <View
        style={{
          borderWidth: 1.5,
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.primaryTint : colors.surface,
          borderRadius: radius.lg,
          padding: spacing.md,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: selected ? colors.primary : colors.primaryTint,
            alignItems: "center",
            justifyContent: "center",
            marginRight: 12,
          }}
        >
          <Ionicons name={icon} size={20} color={selected ? "#fff" : colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "700", color: colors.text, fontSize: 16 }}>{title}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>{desc}</Text>
        </View>
        {selected ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  topTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  progress: { flexDirection: "row", paddingHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.md },
  pill: { width: "85%", height: 4, backgroundColor: colors.border, borderRadius: 2, marginBottom: 6 },
  pillActive: { backgroundColor: colors.primary },
  pillLabel: { fontSize: 11, color: colors.textMuted },
  label: { fontSize: 13, fontWeight: "600", color: colors.text, marginBottom: 6 },
  pickBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickVal: { color: colors.text, marginLeft: 8, fontWeight: "600" },
  contactPill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    marginRight: 8,
  },
  checkRow: { flexDirection: "row", alignItems: "center", marginTop: 10 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: spacing.lg },
  successCard: {
    width: "100%", maxWidth: 380,
    backgroundColor: colors.surface, borderRadius: radius.xl,
    padding: spacing.xl, alignItems: "center",
  },
  successIcon: {
    width: 74, height: 74, borderRadius: 37,
    backgroundColor: colors.primary,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.md,
  },
});
