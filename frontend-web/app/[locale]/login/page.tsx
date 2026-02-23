"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { useTenantInfo } from "../../../hooks/useTenantInfo";
import { TenantNotFound } from "../../../components/TenantNotFound";
import { LanguageSwitcher } from "../../../components/LanguageSwitcher";
import { authApi } from "../../../lib/api";
import { storeAuthData } from "../../../lib/auth";
import { AnnouncementBanner } from "../../../components/AnnouncementBanner";

export default function LoginPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const router = useRouter();
  const params = useParams();
  const locale = params.locale as string;
  const { name: tenantName, notFound } = useTenantInfo();

  // Step 1 state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Step 2 state
  const [step, setStep] = useState<1 | 2>(1);
  const [code, setCode] = useState("");
  const [resending, setResending] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await authApi.login(email, password);
      if (res.data.access_token) {
        // Trusted device — 2FA skipped, tokens returned directly
        storeAuthData(res.data);
        const role = res.data.user.role;
        if (res.data.user.force_password_change) {
          router.push(role === "parent" ? `/${locale}/parent/profile` : `/${locale}/dashboard/profile`);
        } else {
          router.push(role === "parent" ? `/${locale}/parent/messages` : `/${locale}/dashboard`);
        }
      } else if (res.data.status === "2fa_required") {
        setStep(2);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr?.response?.data?.error || t("invalidCredentials"));
    } finally {
      setLoading(false);
    }
  };

  const handleStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await authApi.verify2fa(email, code);
      storeAuthData(res.data);
      const role = res.data.user.role;
      if (res.data.user.force_password_change) {
        router.push(role === "parent" ? `/${locale}/parent/profile` : `/${locale}/dashboard/profile`);
      } else {
        router.push(role === "parent" ? `/${locale}/parent/messages` : `/${locale}/dashboard`);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr?.response?.data?.error || t("twoFaInvalid"));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError("");
    setResending(true);
    try {
      await authApi.login(email, password);
      setCode("");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr?.response?.data?.error || t("invalidCredentials"));
    } finally {
      setResending(false);
    }
  };

  if (notFound) return <TenantNotFound />;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <AnnouncementBanner />
      <div className="flex justify-end px-4 py-2">
        <LanguageSwitcher />
      </div>
      <div className="flex-1 flex items-center justify-center">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="minispace.app" className="w-40 mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-slate-800">{tenantName || tc("appName")}</h1>
          <p className="text-slate-500 mt-1">
            {step === 1 ? t("login") : t("twoFaTitle")}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={handleStep1} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t("email")}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t("password")}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition disabled:opacity-50"
            >
              {loading ? tc("loading") : t("loginButton")}
            </button>

            <div className="text-center">
              <a
                href={`/${locale}/forgot-password`}
                className="text-xs text-slate-500 hover:underline"
              >
                {t("forgotPassword")}
              </a>
            </div>
          </form>
        ) : (
          <form onSubmit={handleStep2} className="space-y-4">
            <p className="text-sm text-slate-600 text-center">{t("twoFaDesc")}</p>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t("twoFaCode")}
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-center text-2xl tracking-widest font-mono"
                required
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition disabled:opacity-50"
            >
              {loading ? tc("loading") : t("twoFaVerify")}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={handleResend}
                disabled={resending}
                className="text-sm text-blue-600 hover:underline disabled:opacity-50"
              >
                {resending ? t("twoFaResending") : t("twoFaResend")}
              </button>
            </div>
          </form>
        )}

      </div>
      </div>
    </div>
  );
}
