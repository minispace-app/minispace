"use client";

import { Suspense, useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { authApi } from "../../../lib/api";
import { useTenantInfo } from "../../../hooks/useTenantInfo";
import { TenantNotFound } from "../../../components/TenantNotFound";
import { LanguageSwitcher } from "../../../components/LanguageSwitcher";

function ResetPasswordForm() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const locale = params.locale as string;

  const token = searchParams.get("token") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }

    setLoading(true);
    try {
      await authApi.resetPassword(token, newPassword);
      setSuccess(true);
      setTimeout(() => router.push(`/${locale}/login`), 2000);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || tc("error"));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="text-center">
        <p className="text-red-600">{t("invalidLink")}</p>
        <a href={`/${locale}/login`} className="mt-4 inline-block text-sm text-blue-600 hover:underline">
          {t("backToLogin")}
        </a>
      </div>
    );
  }

  return (
    <>
      {success ? (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm text-center">
          {t("resetSuccess")}
        </div>
      ) : (
        <>
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t("newPassword")}
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
                minLength={8}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t("confirmPassword")}
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
                minLength={8}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition disabled:opacity-50"
            >
              {loading ? tc("loading") : t("resetPasswordButton")}
            </button>
          </form>
        </>
      )}

      <div className="mt-6 text-center">
        <a href={`/${locale}/login`} className="text-sm text-blue-600 hover:underline">
          {t("backToLogin")}
        </a>
      </div>
    </>
  );
}

export default function ResetPasswordPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const { name: tenantName, notFound } = useTenantInfo();

  if (notFound) return <TenantNotFound />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="minispace.app" className="w-40 mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-slate-800">{tenantName || tc("appName")}</h1>
          <p className="text-slate-500 mt-1">{t("resetPassword")}</p>
        </div>

        <Suspense fallback={<p className="text-center text-slate-500">{tc("loading")}</p>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
