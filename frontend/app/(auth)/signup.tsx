import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button, Input } from "../../src/ui";
import { colors, radius, spacing } from "../../src/theme";
import { useAuth } from "../../src/auth";

const COUNTRIES = [
  { code: "+91", label: "IN +91" },
  { code: "+1", label: "US +1" },
  { code: "+44", label: "UK +44" },
  { code: "+61", label: "AU +61" },
  { code: "+971", label: "AE +971" },
];

export default function Signup() {
  const router = useRouter();
  const { signup } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [cc, setCc] = useState("+91");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const onSubmit = async () => {
    setErr("");
    if (!name || !email || !phone || !password) {
      setErr("Please fill all fields");
      return;
    }
    if (password.length < 6) {
      setErr("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      await signup({
        email: email.trim(),
        phone: phone.trim(),
        password,
        full_name: name.trim(),
        country_code: cc,
      });
      router.replace("/(app)/dashboard");
    } catch (e: any) {
      setErr(e.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.logoWrap}>
            <Ionicons name="sparkles" size={24} color="#fff" />
          </View>
          <Text style={styles.h1}>Create account</Text>
          <Text style={styles.sub}>A calm, trusted system for all your reminders.</Text>

          <View style={{ marginTop: spacing.xl }}>
            <Input label="Full name" placeholder="Your name" value={name} onChangeText={setName} testID="signup-name" />
            <Input
              label="Email"
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              testID="signup-email"
            />
            <Text style={styles.fieldLabel}>Phone number</Text>
            <View style={styles.phoneRow}>
              <View style={styles.ccWrap}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {COUNTRIES.map((c) => (
                    <TouchableOpacity
                      key={c.code}
                      onPress={() => setCc(c.code)}
                      style={[styles.ccPill, cc === c.code && styles.ccPillActive]}
                      testID={`cc-${c.code}`}
                    >
                      <Text style={{ color: cc === c.code ? "#fff" : colors.textMuted, fontSize: 12, fontWeight: "600" }}>
                        {c.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
            <Input
              placeholder="Phone number"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              testID="signup-phone"
            />
            <Input
              label="Password"
              placeholder="Min 6 characters"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              testID="signup-password"
            />
            {err ? <Text style={styles.err}>{err}</Text> : null}
            <Button label="Create account" onPress={onSubmit} loading={loading} testID="signup-submit" />
          </View>

          <TouchableOpacity
            onPress={() => router.back()}
            style={{ alignItems: "center", marginTop: spacing.lg }}
            testID="signup-to-login"
          >
            <Text style={styles.link}>
              Have an account? <Text style={{ color: colors.primary, fontWeight: "700" }}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingTop: spacing.xl },
  logoWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  h1: { fontSize: 32, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  sub: { color: colors.textMuted, marginTop: 6, fontSize: 15 },
  err: { color: colors.danger, marginBottom: 8, fontSize: 13 },
  link: { color: colors.textMuted, fontSize: 14 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.text, marginBottom: 6 },
  phoneRow: { marginBottom: spacing.sm },
  ccWrap: { flexDirection: "row" },
  ccPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    marginRight: 6,
  },
  ccPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
});
