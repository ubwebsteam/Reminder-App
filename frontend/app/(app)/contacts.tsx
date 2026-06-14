import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Modal,
  TextInput,
  TouchableOpacity,
  Platform,
  KeyboardAvoidingView,
  Alert,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, radius, shadow, spacing } from "../../src/theme";
import { Button, Card, Input } from "../../src/ui";
import { COUNTRIES, isValidPhoneNumber, phoneDigits, splitPhone } from "../../src/countries";
import { isValidEmail } from "../../src/utils";

type Contact = { id: string; name: string; phone?: string; email?: string; active_reminders?: number };

export default function Contacts() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const defaultCc = user?.country_code || "+91";
  const tabBarSpace = 60 + Math.max(insets.bottom, Platform.OS === "ios" ? 8 : 6) + 8;
  const [items, setItems] = useState<Contact[]>([]);
  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [cc, setCc] = useState(defaultCc);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setItems(await apiFetch<Contact[]>("/contacts"));
    } catch (e) {
      console.warn(e);
    }
  };
  useFocusEffect(useCallback(() => { load(); }, []));

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setCc(defaultCc);
    setPhone("");
    setEmail("");
    setModal(true);
  };

  const openEdit = (c: Contact) => {
    const { cc: parsedCc, number } = splitPhone(c.phone, defaultCc);
    setEditingId(c.id);
    setName(c.name);
    setCc(parsedCc);
    setPhone(number);
    setEmail(c.email || "");
    setModal(true);
  };

  const save = async () => {
    if (!name.trim()) return Alert.alert("Name required", "Please enter the contact's name.");
    if (!phone.trim()) return Alert.alert("Phone required", "A contact must have a phone number.");
    if (!isValidPhoneNumber(phone)) {
      return Alert.alert("Invalid phone number", "Please enter a valid phone number.");
    }
    if (email.trim() && !isValidEmail(email)) {
      return Alert.alert("Invalid email", "Please enter a valid email address.");
    }
    setSaving(true);
    try {
      const body = JSON.stringify({
        name: name.trim(),
        phone: `${cc}${phoneDigits(phone)}`,
        email: email.trim() || null,
      });
      if (editingId) {
        await apiFetch(`/contacts/${editingId}`, { method: "PUT", body });
      } else {
        await apiFetch("/contacts", { method: "POST", body });
      }
      setModal(false);
      await load();
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async (id: string, withReminders: boolean) => {
    try {
      await apiFetch(`/contacts/${id}${withReminders ? "?delete_reminders=true" : ""}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  const remove = (c: Contact) => {
    const n = c.active_reminders || 0;
    if (n > 0) {
      Alert.alert(
        "Delete contact?",
        `There ${n === 1 ? "is" : "are"} ${n} active reminder${n === 1 ? "" : "s"} for ${c.name}. ` +
          `Deleting this contact will also delete ${n === 1 ? "that reminder" : "those reminders"}. Continue?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete both", style: "destructive", onPress: () => doDelete(c.id, true) },
        ]
      );
    } else {
      Alert.alert("Delete contact?", `Delete ${c.name}?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => doDelete(c.id, false) },
      ]);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>People</Text>
          <Text style={styles.sub}>Saved contacts for quick reminders.</Text>
        </View>
        <TouchableOpacity onPress={openCreate} style={styles.addBtn} testID="add-contact-btn">
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, paddingBottom: tabBarSpace + 24 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={44} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, marginTop: 8 }}>No contacts yet</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Card style={{ marginBottom: 10, flexDirection: "row", alignItems: "center" }} testID={`contact-${item.id}`}>
            <View style={styles.avatar}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>{item.name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>{item.name}</Text>
              {item.phone ? <Text style={styles.meta}>{item.phone}</Text> : null}
              {item.email ? <Text style={styles.meta}>{item.email}</Text> : null}
            </View>
            <TouchableOpacity onPress={() => openEdit(item)} hitSlop={12} style={{ marginRight: 16 }} testID={`edit-contact-${item.id}`}>
              <Ionicons name="create-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => remove(item)} hitSlop={12} testID={`delete-contact-${item.id}`}>
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </TouchableOpacity>
          </Card>
        )}
      />

      <Modal transparent animationType="slide" visible={modal} onRequestClose={() => setModal(false)}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={[styles.sheet, { paddingBottom: spacing.lg + Math.max(insets.bottom, 0) }]}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>{editingId ? "Edit contact" : "New contact"}</Text>
              <Input label="Name" placeholder="Jane Doe" value={name} onChangeText={setName} testID="contact-name" />

              <Text style={styles.fieldLabel}>Phone (WhatsApp/SMS)</Text>
              <View style={styles.phoneRow}>
                <CountryCodeDropdown value={cc} onChange={setCc} />
                <TextInput
                  style={styles.phoneInput}
                  placeholder="9876543210"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={(t) => setPhone(phoneDigits(t))}
                  maxLength={15}
                  testID="contact-phone"
                />
              </View>
              <Text style={styles.hint}>One number, used for both WhatsApp and SMS reminders.</Text>

              <Input
                label="Email (optional)"
                placeholder="jane@example.com"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                hint="Used to send reminders via email."
                testID="contact-email"
              />
              <Button label={editingId ? "Save changes" : "Save contact"} onPress={save} loading={saving} testID="contact-save" />
              <TouchableOpacity onPress={() => setModal(false)} style={{ alignItems: "center", marginTop: 10 }}>
                <Text style={{ color: colors.textMuted }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function CountryCodeDropdown({ value, onChange }: { value: string; onChange: (cc: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity style={styles.ccTrigger} activeOpacity={0.85} onPress={() => setOpen(true)} testID="contact-cc">
        <Text style={styles.ccTriggerText}>{value}</Text>
        <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
      </TouchableOpacity>
      <Modal transparent animationType="fade" visible={open} onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.ccOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.ccMenu}>
            {COUNTRIES.map((c) => {
              const selected = c.code === value;
              return (
                <TouchableOpacity
                  key={c.code}
                  style={[styles.ccItem, selected && { backgroundColor: colors.primaryTint }]}
                  onPress={() => {
                    onChange(c.code);
                    setOpen(false);
                  }}
                  testID={`contact-cc-${c.code}`}
                >
                  <Text style={{ color: selected ? colors.primary : colors.text, fontSize: 15, fontWeight: selected ? "700" : "500" }}>
                    {c.label}
                  </Text>
                  {selected && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  sub: { color: colors.textMuted, fontSize: 14, marginTop: 4 },
  addBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary,
    alignItems: "center", justifyContent: "center", ...shadow.fab,
  },
  avatar: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary,
    alignItems: "center", justifyContent: "center",
  },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  empty: { alignItems: "center", paddingVertical: 60 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
  },
  handle: {
    alignSelf: "center", width: 44, height: 5,
    backgroundColor: colors.border, borderRadius: 3, marginBottom: spacing.md,
  },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.text, marginBottom: spacing.md },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.text, marginBottom: 6, letterSpacing: 0.2 },
  phoneRow: { flexDirection: "row", gap: 8 },
  phoneInput: {
    flex: 1,
    height: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    fontSize: 16,
    color: colors.text,
  },
  hint: { fontSize: 11, color: colors.textMuted, marginTop: 6, marginBottom: spacing.md, lineHeight: 15 },
  ccTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 52,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  ccTriggerText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  ccOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "center", padding: spacing.lg },
  ccMenu: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: 6,
    width: "100%",
    maxWidth: 360,
    alignSelf: "center",
  },
  ccItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
  },
});
