import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  Image,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Button, Input } from "../../src/ui";
import { colors, radius, spacing } from "../../src/theme";
import { useAuth } from "../../src/auth";
import { apiFetch } from "../../src/api";
import { Ionicons } from "@expo/vector-icons";

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

  // Phone verification state
  const [phoneSending, setPhoneSending] = useState(false);
  const [phoneCodeSent, setPhoneCodeSent] = useState(false);
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneVerifying, setPhoneVerifying] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [phoneVerifyToken, setPhoneVerifyToken] = useState("");
  const [phoneErr, setPhoneErr] = useState("");
  const [phoneCooldown, setPhoneCooldown] = useState(0);

  // Email verification state
  const [emailSending, setEmailSending] = useState(false);
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [emailCode, setEmailCode] = useState("");
  const [emailVerifying, setEmailVerifying] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailVerifyToken, setEmailVerifyToken] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [emailCooldown, setEmailCooldown] = useState(0);

  // Cooldown timers
  useEffect(() => {
    if (phoneCooldown <= 0) return;
    const t = setTimeout(() => setPhoneCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phoneCooldown]);

  useEffect(() => {
    if (emailCooldown <= 0) return;
    const t = setTimeout(() => setEmailCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [emailCooldown]);

  // Reset verification when phone/email changes
  useEffect(() => {
    if (phoneVerified) {
      setPhoneVerified(false);
      setPhoneVerifyToken("");
      setPhoneCodeSent(false);
      setPhoneCode("");
    }
  }, [phone, cc]);

  useEffect(() => {
    if (emailVerified) {
      setEmailVerified(false);
      setEmailVerifyToken("");
      setEmailCodeSent(false);
      setEmailCode("");
    }
  }, [email]);

  const sendPhoneCode = async () => {
    const raw = phone.trim().replace(/[^0-9]/g, "");
    if (raw.length < 6) {
      setPhoneErr("Enter a valid phone number first");
      return;
    }
    setPhoneErr("");
    setPhoneSending(true);
    try {
      const phoneValue = `${cc}${raw}`;
      await apiFetch("/auth/send-code", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ target: "phone", value: phoneValue, country_code: cc }),
      });
      setPhoneCodeSent(true);
      setPhoneCooldown(60);
    } catch (e: any) {
      setPhoneErr(e.message || "Failed to send code");
    } finally {
      setPhoneSending(false);
    }
  };

  const verifyPhoneCode = async () => {
    if (phoneCode.length !== 6) {
      setPhoneErr("Enter the 6-digit code");
      return;
    }
    setPhoneErr("");
    setPhoneVerifying(true);
    try {
      const raw = phone.trim().replace(/[^0-9]/g, "");
      const phoneValue = `${cc}${raw}`;
      const res = await apiFetch<{ ok: boolean; verified: boolean; token?: string; message?: string }>(
        "/auth/verify-code",
        {
          method: "POST",
          auth: false,
          body: JSON.stringify({ target: "phone", value: phoneValue, code: phoneCode }),
        }
      );
      if (res.verified && res.token) {
        setPhoneVerified(true);
        setPhoneVerifyToken(res.token);
      } else {
        setPhoneErr(res.message || "Invalid code");
      }
    } catch (e: any) {
      setPhoneErr(e.message || "Verification failed");
    } finally {
      setPhoneVerifying(false);
    }
  };

  const sendEmailCode = async () => {
    const val = email.trim().toLowerCase();
    if (!val || !val.includes("@")) {
      setEmailErr("Enter a valid email first");
      return;
    }
    setEmailErr("");
    setEmailSending(true);
    try {
      await apiFetch("/auth/send-code", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ target: "email", value: val }),
      });
      setEmailCodeSent(true);
      setEmailCooldown(60);
    } catch (e: any) {
      setEmailErr(e.message || "Failed to send code");
    } finally {
      setEmailSending(false);
    }
  };

  const verifyEmailCode = async () => {
    if (emailCode.length !== 6) {
      setEmailErr("Enter the 6-digit code");
      return;
    }
    setEmailErr("");
    setEmailVerifying(true);
    try {
      const val = email.trim().toLowerCase();
      const res = await apiFetch<{ ok: boolean; verified: boolean; token?: string; message?: string }>(
        "/auth/verify-code",
        {
          method: "POST",
          auth: false,
          body: JSON.stringify({ target: "email", value: val, code: emailCode }),
        }
      );
      if (res.verified && res.token) {
        setEmailVerified(true);
        setEmailVerifyToken(res.token);
      } else {
        setEmailErr(res.message || "Invalid code");
      }
    } catch (e: any) {
      setEmailErr(e.message || "Verification failed");
    } finally {
      setEmailVerifying(false);
    }
  };

  const canSubmit = phoneVerified && emailVerified && name && password.length >= 6;

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
    if (!phoneVerified) {
      setErr("Please verify your phone number first");
      return;
    }
    if (!emailVerified) {
      setErr("Please verify your email address first");
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
        phone_verify_token: phoneVerifyToken,
        email_verify_token: emailVerifyToken,
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
            <Image source={require("../../assets/images/icon.png")} style={styles.logoImg} resizeMode="cover" />
          </View>
          <Text style={styles.h1}>Create account</Text>
          <Text style={styles.sub}>A calm, trusted system for all your reminders.</Text>

          <View style={{ marginTop: spacing.xl }}>
            <Input label="Full name" placeholder="Your name" value={name} onChangeText={setName} testID="signup-name" />

            {/* ---------- Email with verification ---------- */}
            <Text style={styles.fieldLabel}>Email</Text>
            <View style={styles.verifyRow}>
              <TextInput
                style={[styles.verifyInput, { flex: 1 }]}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                editable={!emailVerified}
                testID="signup-email"
              />
              {emailVerified ? (
                <View style={styles.verifiedBadge}>
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={styles.verifiedText}>Verified</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.getCodeBtn, (emailSending || emailCooldown > 0) && { opacity: 0.5 }]}
                  onPress={sendEmailCode}
                  disabled={emailSending || emailCooldown > 0}
                  testID="email-get-code"
                >
                  {emailSending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.getCodeText}>
                      {emailCooldown > 0 ? `${emailCooldown}s` : emailCodeSent ? "Resend" : "Get Code"}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
            {emailCodeSent && !emailVerified && (
              <View style={styles.codeRow}>
                <TextInput
                  style={[styles.codeInput, { flex: 1 }]}
                  placeholder="Enter 6-digit code"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={emailCode}
                  onChangeText={setEmailCode}
                  testID="email-code-input"
                />
                <TouchableOpacity
                  style={[styles.verifyBtn, emailVerifying && { opacity: 0.5 }]}
                  onPress={verifyEmailCode}
                  disabled={emailVerifying}
                  testID="email-verify"
                >
                  {emailVerifying ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={styles.verifyBtnText}>Verify</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
            {emailCodeSent && !emailVerified && (
              <Text style={styles.spamHint}>
                <Ionicons name="information-circle-outline" size={12} color={colors.textMuted} />{" "}
                If you don't see the email in your inbox, please check your spam folder.
              </Text>
            )}
            {emailErr ? <Text style={styles.fieldErr}>{emailErr}</Text> : null}

            {/* ---------- Phone with verification ---------- */}
            <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Phone number</Text>
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
            <View style={styles.verifyRow}>
              <TextInput
                style={[styles.verifyInput, { flex: 1 }]}
                placeholder="Phone number"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
                editable={!phoneVerified}
                testID="signup-phone"
              />
              {phoneVerified ? (
                <View style={styles.verifiedBadge}>
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={styles.verifiedText}>Verified</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.getCodeBtn, (phoneSending || phoneCooldown > 0) && { opacity: 0.5 }]}
                  onPress={sendPhoneCode}
                  disabled={phoneSending || phoneCooldown > 0}
                  testID="phone-get-code"
                >
                  {phoneSending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.getCodeText}>
                      {phoneCooldown > 0 ? `${phoneCooldown}s` : phoneCodeSent ? "Resend" : "Get Code"}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
            {phoneCodeSent && !phoneVerified && (
              <View style={styles.codeRow}>
                <TextInput
                  style={[styles.codeInput, { flex: 1 }]}
                  placeholder="Enter 6-digit code"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={phoneCode}
                  onChangeText={setPhoneCode}
                  testID="phone-code-input"
                />
                <TouchableOpacity
                  style={[styles.verifyBtn, phoneVerifying && { opacity: 0.5 }]}
                  onPress={verifyPhoneCode}
                  disabled={phoneVerifying}
                  testID="phone-verify"
                >
                  {phoneVerifying ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={styles.verifyBtnText}>Verify</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
            {phoneErr ? <Text style={styles.fieldErr}>{phoneErr}</Text> : null}

            {/* ---------- Info note ---------- */}
            <View style={styles.infoCard}>
              <View style={styles.infoIconWrap}>
                <Ionicons name="information-circle" size={20} color={colors.primary} />
              </View>
              <Text style={styles.infoText}>
                The phone number and email you enter here will be used for all SMS, WhatsApp, and email notifications. All reminders and communications will be sent to these.
              </Text>
            </View>

            <Input
              label="Password"
              placeholder="Min 6 characters"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              testID="signup-password"
            />
            {err ? <Text style={styles.err}>{err}</Text> : null}
            <Button
              label="Create account"
              onPress={onSubmit}
              loading={loading}
              disabled={!canSubmit}
              testID="signup-submit"
            />

            {(!phoneVerified || !emailVerified) && name && phone && email && password.length >= 6 && (
              <Text style={styles.pendingHint}>
                <Ionicons name="shield-checkmark-outline" size={13} color={colors.textMuted} />{" "}
                Verify your {!phoneVerified && !emailVerified ? "phone & email" : !phoneVerified ? "phone" : "email"} to continue
              </Text>
            )}
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
    width: 64,
    height: 64,
    borderRadius: 18,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },
  logoImg: { width: "100%", height: "100%" },
  h1: { fontSize: 32, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  sub: { color: colors.textMuted, marginTop: 6, fontSize: 15 },
  err: { color: colors.danger, marginBottom: 8, fontSize: 13 },
  link: { color: colors.textMuted, fontSize: 14 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.text, marginBottom: 6 },
  fieldErr: { color: colors.danger, fontSize: 12, marginTop: 4, marginBottom: 8 },
  ccWrap: { flexDirection: "row", marginBottom: spacing.sm },
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

  // Verification UI
  verifyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  verifyInput: {
    height: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    fontSize: 16,
    color: colors.text,
  },
  getCodeBtn: {
    height: 52,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  getCodeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  verifiedBadge: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.success,
    gap: 6,
  },
  verifiedText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  codeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  codeInput: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    backgroundColor: colors.primaryTint,
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: 4,
    textAlign: "center",
  },
  verifyBtn: {
    height: 48,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  verifyBtnText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  spamHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 6,
    marginBottom: 8,
    lineHeight: 16,
  },
  pendingHint: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 12,
    textAlign: "center",
    lineHeight: 18,
  },

  // Info card
  infoCard: {
    flexDirection: "row",
    backgroundColor: colors.primaryTint,
    borderRadius: radius.md,
    padding: 14,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
    alignItems: "flex-start",
    gap: 10,
  },
  infoIconWrap: {
    marginTop: 1,
  },
  infoText: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    opacity: 0.85,
  },
});
