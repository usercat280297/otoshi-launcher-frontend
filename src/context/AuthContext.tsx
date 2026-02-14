import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { AuthUser } from "../types";
import * as api from "../services/api";

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  updateLocalUser: (patch: Partial<AuthUser>) => void;
  login: (email: string, password: string) => Promise<void>;
  exchangeOAuth: (code: string) => Promise<void>;
  register: (payload: {
    email: string;
    username: string;
    password: string;
    display_name?: string;
  }) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const STORAGE_KEY = "otoshi.auth";

async function syncTokensToDesktop(accessToken?: string | null, refreshToken?: string | null) {
  try {
    const { isTauri, invoke } = await import("@tauri-apps/api/core");
    if (!isTauri()) {
      return;
    }
    const tokenPayload = {
      access_token: accessToken ?? null,
      refresh_token: refreshToken ?? null
    };

    // Primary shape matches current Rust command signature.
    try {
      await invoke("set_auth_tokens", { request: tokenPayload });
      return;
    } catch {
      // Backward/forward compatibility for command arg shape changes.
    }

    try {
      await invoke("set_auth_tokens", {
        accessToken: accessToken ?? null,
        refreshToken: refreshToken ?? null
      });
      return;
    } catch {
      // Final fallback for older payload shape.
    }

    await invoke("set_auth_tokens", tokenPayload);
  } catch (err) {
    console.warn("Failed to sync auth tokens to desktop runtime:", err);
  }
}

async function syncLogoutToDesktop() {
  try {
    const { isTauri, invoke } = await import("@tauri-apps/api/core");
    if (!isTauri()) {
      return;
    }
    await invoke("logout");
  } catch (err) {
    console.warn("Failed to sync logout to desktop runtime:", err);
  }
}

function mapUser(raw: any): AuthUser {
  return {
    id: raw.id,
    email: raw.email,
    username: raw.username,
    displayName: raw.display_name ?? raw.displayName ?? null,
    role: raw.role ?? raw.user?.role ?? null
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.user) {
            setUser(parsed.user);
            setToken(parsed.token);
            await syncTokensToDesktop(parsed.token, parsed.refresh_token);
          }
          
          if (parsed.refresh_token) {
             try {
                const refreshResponse = await api.refreshToken(parsed.refresh_token);
                const nextUser = mapUser(refreshResponse.user);
                setUser(nextUser);
                setToken(refreshResponse.access_token);
                await syncTokensToDesktop(
                  refreshResponse.access_token,
                  refreshResponse.refresh_token
                );
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                  user: nextUser,
                  token: refreshResponse.access_token,
                  refresh_token: refreshResponse.refresh_token
                }));
             } catch (err) {
                const raw =
                  err instanceof Error
                    ? err.message
                    : typeof err === "string"
                      ? err
                      : JSON.stringify(err ?? "unknown");
                const authRejected =
                  /401|unauthorized|invalid token|user not found/i.test(raw);
                console.error(
                  authRejected
                    ? "Refresh token rejected by backend, clearing local session"
                    : "Refresh token request failed, keeping existing access token if available",
                  err
                );
                const hasFallbackSession = Boolean(parsed?.token && parsed?.user);
                if (!authRejected && hasFallbackSession) {
                  await syncTokensToDesktop(parsed.token, parsed.refresh_token);
                } else {
                  setUser(null);
                  setToken(null);
                  localStorage.removeItem(STORAGE_KEY);
                  await syncLogoutToDesktop();
                }
             }
          }
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
      setLoading(false);
    };
    initAuth();
  }, []);

  const login = async (email: string, password: string) => {
    const response = await api.login(email, password);
    const nextUser = mapUser(response.user);
    setUser(nextUser);
    setToken(response.access_token);
    await syncTokensToDesktop(response.access_token, response.refresh_token);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 
        user: nextUser, 
        token: response.access_token,
        refresh_token: response.refresh_token
      })
    );
  };

  const exchangeOAuth = async (code: string) => {
    const response = await api.exchangeOAuthCode(code);
    const nextUser = mapUser(response.user);
    setUser(nextUser);
    setToken(response.access_token);
    await syncTokensToDesktop(response.access_token, response.refresh_token);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 
        user: nextUser, 
        token: response.access_token, 
        refresh_token: response.refresh_token 
      })
    );
  };

  const register = async (payload: {
    email: string;
    username: string;
    password: string;
    display_name?: string;
  }) => {
    await api.register(payload);
    await login(payload.email, payload.password);
  };

  const logout = () => {
    if (token) {
      api.logout(token).catch(() => undefined);
    }
    setUser(null);
    setToken(null);
    localStorage.removeItem(STORAGE_KEY);
    syncLogoutToDesktop().catch(() => undefined);
  };

  const updateLocalUser = (patch: Partial<AuthUser>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              ...parsed,
              user: next
            })
          );
        } catch {
          // ignore malformed storage
        }
      }
      return next;
    });
  };

  const value = useMemo(
    () => ({ user, token, loading, updateLocalUser, login, exchangeOAuth, register, logout }),
    [user, token, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
