import { Stack } from "expo-router";
import { AuthProvider } from "../src/auth";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#F8F9F7" },
            animation: "slide_from_right",
          }}
        />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
