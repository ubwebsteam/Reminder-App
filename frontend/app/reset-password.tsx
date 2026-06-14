import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Alert, Image, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch } from "../src/api";
import { Button, Input, Card } from "../src/ui";
import { colors, radius, spacing } from "../src/theme";

export default function ResetPassword() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  
  const submit = async () => {
    if (!token) {
      Alert.alert("Error", "Invalid or missing reset token.");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Error", "Password must be at least 6 characters.");
      return;
    }
    
    setLoading(true);
    try {
      await apiFetch("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, new_password: password }),
      });
      Alert.alert("Success", "Your password has been updated.", [
        { text: "OK", onPress: () => router.replace("/(auth)/login") }
      ]);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={{ padding: spacing.xl, flexGrow: 1, justifyContent: "center" }}>
        <View style={{ alignItems: "center", marginBottom: 30 }}>
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed" size={32} color={colors.primary} />
          </View>
          <Text style={styles.title}>Set New Password</Text>
          <Text style={styles.sub}>Enter a new password for your account.</Text>
        </View>

        <Input
          label="New password"
          placeholder="Min 6 characters"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <Button
          label="Update Password"
          onPress={submit}
          loading={loading}
          style={{ marginTop: spacing.md }}
        />
        
        <Button
          label="Cancel"
          variant="ghost"
          onPress={() => router.replace("/")}
          style={{ marginTop: spacing.sm }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.primaryTint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.5,
  },
  sub: {
    color: colors.textMuted,
    fontSize: 15,
    marginTop: 8,
    textAlign: "center",
  },
});
