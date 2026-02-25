"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { authApi } from "../../../lib/api";
import { useTenantInfo } from "../../../hooks/useTenantInfo";
import { TenantNotFound } from "../../../components/TenantNotFound";
import { LanguageSwitcher } from "../../../components/LanguageSwitcher";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const params = useParams();
  const locale = params.locale as string;
  const { name: tenantName, notFound } = useTenantInfo();

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
    } finally {
      setSent(true);
      setLoading(false);
    }
  };

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
          <div className="mb-3 text-center">
            <span className="text-sm font-semibold" style={{ color: '#001F3F' }}>minispace</span>
            <span className="text-sm font-semibold" style={{ color: '#ff3c7a' }}>.app</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">{tenantName || tc("appName")}</h1>
          <p className="text-slate-500 mt-1">{t("forgotPasswordTitle")}</p>
          <p className="text-slate-500 mt-1">{t("forgotPasswordDesc")}</p>
        </div>

        {sent ? (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm text-center">
            {t("forgotPasswordSent")}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
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

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition disabled:opacity-50"
            >
              {loading ? tc("loading") : t("forgotPasswordButton")}
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <a href={`/${locale}/login`} className="text-sm text-blue-600 hover:underline">
            {t("backToLogin")}
          </a>
        </div>
      </div>
    </div>
  );
}
