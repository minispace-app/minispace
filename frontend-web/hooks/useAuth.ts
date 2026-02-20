"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "../lib/api";
import { clearAuthData, getStoredUser, isAuthenticated, storeAuthData, User } from "../lib/auth";
import Cookies from "js-cookie";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const stored = getStoredUser();
    if (stored && isAuthenticated()) {
      setUser(stored);
    }
    setLoading(false);
  }, []);

  const login = useCallback(
    async (email: string, password: string, locale: string) => {
      try {
        const res = await authApi.login(email, password);
        storeAuthData({ ...res.data, garderie_name: res.data.garderie_name });
        setUser(res.data.user);
        const role = res.data.user.role;
        // If account requires changing password (temp password issued by admin),
        // redirect user to their profile page to update it.
        if (res.data.user.force_password_change) {
          if (role === "parent") {
            router.push(`/${locale}/parent/profile`);
          } else {
            router.push(`/${locale}/dashboard/profile`);
          }
        } else {
          if (role === "parent") {
            router.push(`/${locale}/parent/messages`);
          } else {
            router.push(`/${locale}/dashboard`);
          }
        }
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { error?: string } } };
        const msg = axiosErr?.response?.data?.error;
        throw new Error(msg || "Identifiants invalides");
      }
    },
    [router]
  );

  const logout = useCallback(
    async (locale: string) => {
      const refreshToken = Cookies.get("refresh_token");
      if (refreshToken) {
        try {
          await authApi.logout(refreshToken);
        } catch {}
      }
      clearAuthData();
      setUser(null);
      router.push(`/${locale}/login`);
    },
    [router]
  );

  return { user, loading, login, logout };
}
