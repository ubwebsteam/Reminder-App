import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Modal,
  TouchableOpacity,
  Platform,
  KeyboardAvoidingView,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch } from "../../src/api";
import { colors, radius, shadow, spacing } from "../../src/theme";
import { Button, Card, Input } from "../../src/ui";

type Contact = { id: string; name: string; phone?: string; email?: string };

export default function Contacts() {
  const [items, setItems] = useState<Contact[]>([]);
  const [modal, setModal] = useState(false);
  const [name, setName] = useState("");
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

  const save = async () => {
    if (!name.trim()) return Alert.alert("Name is required");
    setSaving(true);
    try {
      await apiFetch("/contacts", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() || null, email: email.trim() || null }),
      });
      setModal(false);
      setName(""); setPhone(""); setEmail("");
      await load();
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await apiFetch(`/contacts/${id}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>People</Text>
          <Text style={styles.sub}>Saved contacts for quick reminders.</Text>
        </View>
        <TouchableOpacity
          onPress={() => setModal(true)}
          style={styles.addBtn}
          testID="add-contact-btn"
        >
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: 0 }}
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
            <TouchableOpacity onPress={() => remove(item.id)} hitSlop={12} testID={`delete-contact-${item.id}`}>
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </TouchableOpacity>
          </Card>
        )}
      />

      <Modal transparent animationType="slide" visible={modal} onRequestClose={() => setModal(false)}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.sheet}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>New contact</Text>
              <Input label="Name" placeholder="Jane Doe" value={name} onChangeText={setName} testID="contact-name" />
              <Input label="Phone (optional)" placeholder="+91 9876543210" keyboardType="phone-pad" value={phone} onChangeText={setPhone} testID="contact-phone" />
              <Input label="Email (optional)" placeholder="jane@example.com" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} testID="contact-email" />
              <Button label="Save contact" onPress={save} loading={saving} testID="contact-save" />
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
    paddingBottom: Platform.OS === "ios" ? 40 : spacing.lg,
  },
  handle: {
    alignSelf: "center", width: 44, height: 5,
    backgroundColor: colors.border, borderRadius: 3, marginBottom: spacing.md,
  },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: colors.text, marginBottom: spacing.md },
});
