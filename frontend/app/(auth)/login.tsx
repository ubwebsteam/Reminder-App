import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Button, Input } from "../../src/ui";
import { colors, spacing } from "../../src/theme";
import { useAuth } from "../../src/auth";

export default function Login() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const onSubmit = async () => {
    if (!email || !password) {
      setErr("Please enter email and password");
      return;
    }
    setLoading(true);
    setErr("");
    try {
      await login(email.trim(), password);
      router.replace("/(app)/dashboard");
    } catch (e: any) {
      setErr(e.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.logoWrap}>
            <Ionicons name="notifications" size={28} color="#fff" />
          </View>
          <Text style={styles.h1}>Welcome back</Text>
          <Text style={styles.sub}>Sign in to keep your commitments on track.</Text>

          <View style={{ marginTop: spacing.xl }}>
            <Input
              label="Email"
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              testID="login-email"
            />
            <Input
              label="Password"
              placeholder="Your password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              testID="login-password"
            />
            {err ? <Text style={styles.err}>{err}</Text> : null}
            <Button label="Sign in" onPress={onSubmit} loading={loading} testID="login-submit" />
          </View>

          <TouchableOpacity
            onPress={() => router.push("/(auth)/signup")}
            style={{ alignItems: "center", marginTop: spacing.lg }}
            testID="login-to-signup"
          >
            <Text style={styles.link}>
              New here? <Text style={{ color: colors.primary, fontWeight: "700" }}>Create account</Text>
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
});
