"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { authApi } from "../../../lib/api";
import { useTenantInfo } from "../../../hooks/useTenantInfo";
import { TenantNotFound } from "../../../components/TenantNotFound";
import { LanguageSwitcher } from "../../../components/LanguageSwitcher";
import { AnnouncementBanner } from "../../../components/AnnouncementBanner";

export default function RegisterPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = params.locale as string;
  const { name: tenantName, logo_url: tenantLogoUrl, notFound } = useTenantInfo();

  const token = searchParams.get("token") || "";

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    password: "",
    confirmPassword: "",
  });
  const [consentPrivacy, setConsentPrivacy] = useState(false);
  const [consentPhotos, setConsentPhotos]   = useState(false);
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (form.password !== form.confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }

    if (!consentPrivacy) {
      setError(t("consentMissing"));
      return;
    }

    setLoading(true);
    try {
      await authApi.register({
        token,
        first_name: form.first_name,
        last_name: form.last_name,
        password: form.password,
        preferred_locale: locale,
        consent: {
          privacy_accepted: true,
          photos_accepted: consentPhotos,
          accepted_at: new Date().toISOString(),
          policy_version: "2026-02-28",
          language: locale,
        },
      });
      router.push(`/${locale}/login`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error || tc("error"));
    } finally {
      setLoading(false);
    }
  };

  if (notFound) return <TenantNotFound />;

  // No token → show clear error message
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>
        <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8 text-center">
          <h1 className="text-xl font-bold text-slate-800 mb-3">{tenantName || tc("appName")}</h1>
          <p className="text-slate-500 text-sm">{t("registerNoToken")}</p>
          <a href={`/${locale}/login`} className="mt-6 inline-block text-sm text-blue-600 hover:underline">
            {t("backToLogin")}
          </a>
        </div>
      </div>
    );
  }

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
          <img src={tenantLogoUrl || "/logo.png"} alt="minispace.app" className="w-40 mx-auto mb-3" />
          {!tenantLogoUrl && (
            <div className="mb-3 text-center">
              <span className="text-sm font-semibold" style={{ color: '#001F3F' }}>minispace</span>
              <span className="text-sm font-semibold" style={{ color: '#ff3c7a' }}>.app</span>
            </div>
          )}
          <h1 className="text-2xl font-bold text-slate-800">{tenantName || tc("appName")}</h1>
          <p className="text-slate-500 mt-1">{t("registerTitle")}</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t("firstName")}</label>
              <input
                name="first_name"
                value={form.first_name}
                onChange={handleChange}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t("lastName")}</label>
              <input
                name="last_name"
                value={form.last_name}
                onChange={handleChange}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t("password")}</label>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t("confirmPassword")}</label>
            <input
              type="password"
              name="confirmPassword"
              value={form.confirmPassword}
              onChange={handleChange}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          {/* Consentement Loi 25 */}
          <div className="pt-2 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              {t("consentTitle")}
            </p>

            {/* Politique de confidentialité — requis */}
            <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition mb-2 ${
              consentPrivacy
                ? "border-indigo-400 bg-indigo-50"
                : "border-slate-200 hover:bg-slate-50"
            }`}>
              <div className="relative flex-shrink-0 mt-0.5">
                <input
                  type="checkbox"
                  checked={consentPrivacy}
                  onChange={(e) => setConsentPrivacy(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition ${
                  consentPrivacy
                    ? "bg-indigo-600 border-indigo-600"
                    : "bg-white border-slate-300"
                }`}>
                  {consentPrivacy && (
                    <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                      <polyline points="2 6 5 9 10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
              </div>
              <span className="text-sm text-slate-700 leading-snug">
                {t("consentPrivacyBefore")}
                <a
                  href="/confidentialite"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 underline font-medium"
                  onClick={(e) => e.stopPropagation()}
                >
                  {t("consentPrivacyLink")}
                </a>
                {t("consentPrivacyAfter")}
                <span className="ml-1.5 inline-block text-xs font-bold uppercase text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded">
                  {t("consentRequired")}
                </span>
              </span>
            </label>

            {/* Photos — optionnel */}
            <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
              consentPhotos
                ? "border-green-400 bg-green-50"
                : "border-slate-200 hover:bg-slate-50"
            }`}>
              <div className="relative flex-shrink-0 mt-0.5">
                <input
                  type="checkbox"
                  checked={consentPhotos}
                  onChange={(e) => setConsentPhotos(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition ${
                  consentPhotos
                    ? "bg-green-600 border-green-600"
                    : "bg-white border-slate-300"
                }`}>
                  {consentPhotos && (
                    <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                      <polyline points="2 6 5 9 10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
              </div>
              <span className="text-sm text-slate-700 leading-snug">
                {t("consentPhotos")}
                <span className="block mt-0.5 text-xs text-slate-400 italic">
                  {t("consentPhotosHint")}
                </span>
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition disabled:opacity-50"
          >
            {loading ? tc("loading") : t("registerButton")}
          </button>
        </form>

        <div className="mt-6 text-center">
          <a href={`/${locale}/login`} className="text-sm text-slate-500 hover:underline">
            {t("backToLogin")}
          </a>
        </div>
      </div>
      </div>
    </div>
  );
}
