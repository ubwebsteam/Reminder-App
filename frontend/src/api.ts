import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export const API_BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

const TOKEN_KEY = "remindly.token";

export async function saveToken(t: string) {
  await AsyncStorage.setItem(TOKEN_KEY, t);
}
export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}
export async function clearToken() {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch<T = any>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const { auth = true, headers, ...rest } = opts;
  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers as Record<string, string>),
  };
  if (auth) {
    const token = await getToken();
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...rest, headers: finalHeaders });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    if (body) {
      const detail = body.detail;
      if (typeof detail === "string") {
        msg = detail;
      } else if (Array.isArray(detail) && detail.length > 0) {
        // FastAPI / Pydantic validation errors — extract human-readable messages
        msg = detail
          .map((e: any) => {
            const field = Array.isArray(e.loc)
              ? e.loc.filter((l: any) => l !== "body").join(" → ")
              : "";
            const m = e.msg || "Invalid value";
            return field ? `${field}: ${m}` : m;
          })
          .join(". ");
      } else if (body.message) {
        msg = typeof body.message === "string" ? body.message : JSON.stringify(body.message);
      }
    }
    throw new Error(msg);
  }
  return body as T;
}

export const isWeb = Platform.OS === "web";
