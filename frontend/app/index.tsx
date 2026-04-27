import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../src/auth";
import { colors, spacing } from "../src/theme";
import { Ionicons } from "@expo/vector-icons";

export default function Splash() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(scale, { toValue: 1, duration: 700, easing: Easing.out(Easing.exp), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(float, { toValue: 1, duration: 2200, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
          Animated.timing(float, { toValue: 0, duration: 2200, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
        ])
      ),
    ]).start();
  }, []);

  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => {
      if (user) router.replace("/(app)/dashboard");
      else router.replace("/(auth)/login");
    }, 1500);
    return () => clearTimeout(t);
  }, [loading, user]);

  const floatY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });

  return (
    <View style={styles.container} testID="splash-screen">
      {/* Decorative blobs */}
      <Animated.View style={[styles.blob, styles.blob1, { transform: [{ translateY: floatY }] }]} />
      <Animated.View style={[styles.blob, styles.blob2, { transform: [{ translateY: Animated.multiply(floatY, -1) }] }]} />

      <Animated.View style={{ alignItems: "center", opacity, transform: [{ scale }] }}>
        <View style={styles.logoWrap}>
          <Ionicons name="notifications" size={44} color="#fff" />
        </View>
        <Text style={styles.brand}>Remindly</Text>
        <Text style={styles.tag}>Never miss what matters.</Text>
      </Animated.View>

      <ActivityIndicator color={colors.primary} style={{ position: "absolute", bottom: 50 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoWrap: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.primary,
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12,
    marginBottom: spacing.lg,
  },
  brand: { fontSize: 34, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  tag: { color: colors.textMuted, fontSize: 15, marginTop: 6 },
  blob: {
    position: "absolute",
    borderRadius: 999,
    opacity: 0.5,
  },
  blob1: {
    width: 260,
    height: 260,
    backgroundColor: "#E6EEEA",
    top: -80,
    left: -80,
  },
  blob2: {
    width: 200,
    height: 200,
    backgroundColor: "#EAE3D6",
    bottom: 60,
    right: -60,
  },
});
