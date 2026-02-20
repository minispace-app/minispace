"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "../../../../hooks/useAuth";
import { authApi } from "../../../../lib/api";
import { Eye, EyeOff, Save, AlertCircle, Check } from "lucide-react";

export default function ParentProfilePage() {
  const t = useTranslations("profile");
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);

  const [passwordForm, setPasswordForm] = useState({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });

  const [emailForm, setEmailForm] = useState({
    new_email: "",
    password: "",
  });

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setError(t("passwordMismatch"));
      return;
    }

    if (passwordForm.new_password.length < 8) {
      setError(t("passwordTooShort"));
      return;
    }

    setLoading(true);
    try {
      await authApi.changePassword(
        passwordForm.current_password,
        passwordForm.new_password
      );
      setSuccess(t("passwordUpdated"));
      setPasswordForm({ current_password: "", new_password: "", confirm_password: "" });
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error || t("updateError"));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!emailForm.new_email.includes("@")) {
      setError(t("invalidEmail"));
      return;
    }

    setLoading(true);
    try {
      await authApi.updateEmail(emailForm.new_email, emailForm.password);
      setSuccess(t("emailUpdated"));
      setEmailForm({ new_email: "", password: "" });
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error || t("updateError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-800">{t("title")}</h1>
        <p className="text-slate-500 mt-2">
          {user?.first_name} {user?.last_name}
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex gap-3">
          <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
          <p className="text-green-700 text-sm">{success}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Change Password */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-xl font-bold text-slate-800 mb-4">{t("changePassword")}</h2>

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t("currentPassword")}
              </label>
              <input
                type={showPasswords ? "text" : "password"}
                value={passwordForm.current_password}
                onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t("newPassword")}
              </label>
              <input
                type={showPasswords ? "text" : "password"}
                value={passwordForm.new_password}
                onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-500 mt-1">{t("minChars")}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t("confirmPassword")}
              </label>
              <input
                type={showPasswords ? "text" : "password"}
                value={passwordForm.confirm_password}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              type="button"
              onClick={() => setShowPasswords(!showPasswords)}
              className="text-xs text-blue-600 hover:text-blue-700"
            >
              {showPasswords ? (
                <span className="flex items-center gap-1">
                  <EyeOff className="w-3.5 h-3.5" /> {t("hide")}
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5" /> {t("show")}
                </span>
              )}
            </button>

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              {loading ? "..." : t("update")}
            </button>
          </form>
        </div>

        {/* Update Email */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-xl font-bold text-slate-800 mb-4">{t("changeEmail")}</h2>

          <form onSubmit={handleUpdateEmail} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t("currentEmail")}
              </label>
              <input
                type="email"
                value={user?.email || ""}
                disabled
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t("newEmail")}
              </label>
              <input
                type="email"
                value={emailForm.new_email}
                onChange={(e) => setEmailForm({ ...emailForm, new_email: e.target.value })}
                required
                placeholder="nouveau@example.com"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t("confirmWithPassword")}
              </label>
              <input
                type="password"
                value={emailForm.password}
                onChange={(e) => setEmailForm({ ...emailForm, password: e.target.value })}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              {loading ? "..." : t("update")}
            </button>
          </form>
        </div>
      </div>

      <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-700">
          <strong>{t("securityNote")}</strong> {t("securityNoteDesc")}
        </p>
      </div>
    </div>
  );
}
