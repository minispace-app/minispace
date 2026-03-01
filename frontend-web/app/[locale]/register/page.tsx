"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Shield, Camera, ArrowRight } from "lucide-react";
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
  const [consentPhotos, setConsentPhotos] = useState(false);
  const [error, setError] = useState("");
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

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 text-center">
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
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      <AnnouncementBanner />
      <div className="flex justify-end px-4 py-2">
        <LanguageSwitcher />
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-2xl">
          {/* Header */}
          <div className="text-center mb-12">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={tenantLogoUrl || "/logo.png"} alt="minispace.app" className="w-32 mx-auto mb-4" />
            {!tenantLogoUrl && (
              <div className="mb-4 text-center">
                <span className="text-lg font-bold" style={{ color: '#001F3F' }}>minispace</span>
                <span className="text-lg font-bold" style={{ color: '#ff3c7a' }}>.app</span>
              </div>
            )}
            <h1 className="text-4xl font-bold text-slate-900 mb-2">{tenantName || tc("appName")}</h1>
            <p className="text-lg text-slate-600">{t("registerTitle")}</p>
            <p className="text-sm text-slate-500 mt-2">👋 Bienvenue dans la garderie!</p>
          </div>

          {/* Form Container */}
          <div className="bg-white rounded-3xl shadow-2xl p-8 lg:p-12">
            {error && (
              <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg">
                <p className="text-red-700 text-sm font-medium">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Nom & Prénom */}
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-3">Qui êtes-vous?</label>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    name="first_name"
                    placeholder={t("firstName")}
                    value={form.first_name}
                    onChange={handleChange}
                    className="px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                  <input
                    name="last_name"
                    placeholder={t("lastName")}
                    value={form.last_name}
                    onChange={handleChange}
                    className="px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>
              </div>

              {/* Mot de passe */}
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-3">Votre mot de passe</label>
                <div className="space-y-2">
                  <input
                    type="password"
                    name="password"
                    placeholder={t("password")}
                    value={form.password}
                    onChange={handleChange}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                  <input
                    type="password"
                    name="confirmPassword"
                    placeholder={t("confirmPassword")}
                    value={form.confirmPassword}
                    onChange={handleChange}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>
              </div>

              {/* Consentements - Deux cartes côte à côte */}
              <div>
                <label className="block text-sm font-semibold text-slate-900 mb-4">Protégeons votre enfant</label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Carte 1: Confidentialité - REQUISE */}
                  <button
                    type="button"
                    onClick={() => setConsentPrivacy(!consentPrivacy)}
                    className={`relative group p-6 rounded-2xl border-2 transition-all duration-200 ${
                      consentPrivacy
                        ? "border-blue-500 bg-gradient-to-br from-blue-50 to-blue-100 shadow-lg"
                        : "border-slate-200 bg-white hover:border-blue-300 hover:shadow-md"
                    }`}
                  >
                    {/* Checkbox */}
                    <div className={`absolute top-4 right-4 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition ${
                      consentPrivacy
                        ? "bg-blue-500 border-blue-500"
                        : "bg-white border-slate-300 group-hover:border-blue-300"
                    }`}>
                      {consentPrivacy && <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                    </div>

                    {/* Icon */}
                    <div className="mb-4">
                      <Shield className={`w-8 h-8 ${consentPrivacy ? "text-blue-600" : "text-slate-400"}`} />
                    </div>

                    {/* Content */}
                    <h3 className="text-lg font-bold text-slate-900 text-left mb-2">Confidentialité</h3>
                    <p className="text-sm text-slate-600 text-left mb-4">
                      Protégez les données de votre enfant selon la Loi 25.
                    </p>

                    {/* Link */}
                    <a
                      href="/confidentialite"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:text-blue-700 font-medium underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Lire la politique
                    </a>

                    {/* Badge */}
                    <div className="mt-4 inline-block">
                      <span className="text-xs font-bold uppercase text-blue-700 bg-blue-200 px-3 py-1 rounded-full">
                        ⭐ Requis
                      </span>
                    </div>
                  </button>

                  {/* Carte 2: Photos - OPTIONNEL */}
                  <button
                    type="button"
                    onClick={() => setConsentPhotos(!consentPhotos)}
                    className={`relative group p-6 rounded-2xl border-2 transition-all duration-200 ${
                      consentPhotos
                        ? "border-emerald-500 bg-gradient-to-br from-emerald-50 to-emerald-100 shadow-lg"
                        : "border-slate-200 bg-white hover:border-emerald-300 hover:shadow-md"
                    }`}
                  >
                    {/* Checkbox */}
                    <div className={`absolute top-4 right-4 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition ${
                      consentPhotos
                        ? "bg-emerald-500 border-emerald-500"
                        : "bg-white border-slate-300 group-hover:border-emerald-300"
                    }`}>
                      {consentPhotos && <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                    </div>

                    {/* Icon */}
                    <div className="mb-4">
                      <Camera className={`w-8 h-8 ${consentPhotos ? "text-emerald-600" : "text-slate-400"}`} />
                    </div>

                    {/* Content */}
                    <h3 className="text-lg font-bold text-slate-900 text-left mb-2">Photos</h3>
                    <p className="text-sm text-slate-600 text-left mb-4">
                      Partager des moments de votre enfant à la garderie.
                    </p>

                    {/* Subtext */}
                    <p className="text-xs text-slate-500 italic">
                      Peut être modifié plus tard dans vos paramètres.
                    </p>

                    {/* Badge */}
                    <div className="mt-4 inline-block">
                      <span className="text-xs font-bold uppercase text-emerald-700 bg-emerald-200 px-3 py-1 rounded-full">
                        ✓ Optionnel
                      </span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold rounded-xl transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2 text-lg"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                    {tc("loading")}
                  </>
                ) : (
                  <>
                    {t("registerButton")}
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </form>

            {/* Back Link */}
            <div className="mt-6 text-center">
              <a href={`/${locale}/login`} className="text-sm text-slate-500 hover:text-slate-700 font-medium">
                ← {t("backToLogin")}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
