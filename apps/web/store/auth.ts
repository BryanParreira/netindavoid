import { create } from "zustand";
import { persist } from "zustand/middleware";
import { IS_MOCK } from "@/lib/api";

interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  role: string;
  tenant_id: string;
  totp_enabled: boolean;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (user: AuthUser, access: string, refresh: string) => void;
  clearAuth: () => void;
  isAuthenticated: () => boolean;
}

const MOCK_USER_SEED: AuthUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@vex.local",
  display_name: "Admin",
  role: "admin",
  tenant_id: "00000000-0000-0000-0000-000000000000",
  totp_enabled: false,
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: IS_MOCK ? MOCK_USER_SEED : null,
      accessToken: IS_MOCK ? "mock_access_token" : null,
      refreshToken: IS_MOCK ? "mock_refresh_token" : null,
      setAuth: (user, accessToken, refreshToken) => {
        set({ user, accessToken, refreshToken });
        if (typeof window !== "undefined") {
          localStorage.setItem("access_token", accessToken);
          localStorage.setItem("refresh_token", refreshToken);
        }
      },
      clearAuth: () => {
        set({
          user: IS_MOCK ? MOCK_USER_SEED : null,
          accessToken: IS_MOCK ? "mock_access_token" : null,
          refreshToken: IS_MOCK ? "mock_refresh_token" : null,
        });
      },
      isAuthenticated: () => !!get().accessToken,
    }),
    { name: "vex-auth", partialize: (s) => ({ user: s.user, accessToken: s.accessToken, refreshToken: s.refreshToken }) }
  )
);
