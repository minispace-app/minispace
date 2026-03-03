"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { authApi, childrenApi } from "../../../../lib/api";
import { childAvatarColor, ChildAvatar } from "../../../../components/ChildAvatar";
import { Download, AlertCircle, Check, Lock, Trash2 } from "lucide-react";

export default function ParentPrivacyPage() {
  const t = useTranslations("privacy");
  const tc = useTranslations("common");

  // Children data
  const { data: children, error: childrenError } = useSWR(
    "children",
    () => childrenApi.list().then((r) => r.data)
  );

  // Consent data
  const { data: consent, mutate: mutateConsent } = useSWR(
    "consent",
    () => authApi.getConsent().then((r) => r.data),
    { revalidateOnFocus: false }
  );

  // Export states
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportError, setExportError] = useState("");
  const [successId, setSuccessId] = useState<string | null>(null);

  // Consent states
  const [photosAccepted, setPhotosAccepted] = useState(consent?.photos_accepted ?? false);
  const [savingConsent, setSavingConsent] = useState(false);
  const [consentSuccess, setConsentSuccess] = useState(false);
  const [consentError, setConsentError] = useState("");

  // Account deletion states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteSending, setDeleteSending] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Update photosAccepted when consent data loads
  useEffect(() => {
    if (consent) {
      setPhotosAccepted(consent.photos_accepted);
    }
  }, [consent]);

  const handleExport = async (child: any) => {
    setExportingId(child.id);
    setExportError("");
    setSuccessId(null);

    try {
      const response = await childrenApi.export(child.id);
      const blob = new Blob([JSON.stringify(response.data, null, 2)], {
        type: "application/json",
      });

      const date = new Date().toISOString().split("T")[0];
      const filename = `export-${child.first_name}-${child.last_name}-${date}.json`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccessId(child.id);
      setTimeout(() => setSuccessId(null), 3000);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setExportError(e?.response?.data?.error || t("exportError"));
    } finally {
      setExportingId(null);
    }
  };

  const handleSaveConsent = async () => {
    setSavingConsent(true);
    setConsentError("");
    setConsentSuccess(false);

    try {
      const response = await authApi.updateConsent(photosAccepted);
      setConsentSuccess(true);
      mutateConsent(response.data, false);
      setTimeout(() => setConsentSuccess(false), 3000);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setConsentError(e?.response?.data?.error || t("consentSaveError"));
    } finally {
      setSavingConsent(false);
    }
  };

  const handleRequestDeletion = async () => {
    setDeleteSending(true);
    setDeleteError("");

    try {
      await authApi.requestAccountDeletion();
      setDeleteSuccess(true);
      setShowDeleteModal(false);
      setTimeout(() => setDeleteSuccess(false), 3000);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setDeleteError(e?.response?.data?.error || t("deleteError"));
    } finally {
      setDeleteSending(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-6 max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{t("title")}</h1>
          <p className="mt-2 text-slate-600">{t("subtitle")}</p>
        </div>

        {/* Info box */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-900">{t("law25Info")}</p>
        </div>

        {/* Consent section */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Lock className="w-5 h-5 text-slate-700" />
            <h2 className="text-xl font-semibold text-slate-800">
              {t("consentTitle")}
            </h2>
          </div>

          {consent ? (
            <div className="space-y-4">
              {/* Privacy accepted - read only */}
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <p className="text-sm font-medium text-slate-900 mb-1">
                  {t("consentPrivacy")}
                </p>
                <p className="text-sm text-slate-600">
                  {consent.privacy_accepted ? t("consentPhotosOn") : t("consentPhotosOff")}
                </p>
              </div>

              {/* Photos toggle */}
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {t("consentPhotosLabel")}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      {t("consentPhotosDesc")}
                    </p>
                  </div>
                  <button
                    onClick={() => setPhotosAccepted(!photosAccepted)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                      photosAccepted ? "bg-emerald-600" : "bg-slate-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                        photosAccepted ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-3">
                  {t("consentSince", {
                    date: formatDate(consent.accepted_at),
                    version: consent.policy_version,
                  })}
                </p>
              </div>

              {/* Save button */}
              <button
                onClick={handleSaveConsent}
                disabled={savingConsent || photosAccepted === consent.photos_accepted}
                className={`w-full px-4 py-2 rounded-lg font-medium transition ${
                  savingConsent
                    ? "bg-blue-50 text-blue-600 cursor-wait"
                    : photosAccepted === consent.photos_accepted
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                      : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {savingConsent ? t("common.saving") : t("consentSave")}
              </button>

              {/* Consent success message */}
              {consentSuccess && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex gap-3">
                  <Check className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-emerald-900">{t("consentSaved")}</p>
                </div>
              )}

              {/* Consent error message */}
              {consentError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-900">{consentError}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-slate-50 rounded-lg p-6 text-center">
              <p className="text-slate-600">{tc("loading")}</p>
            </div>
          )}
        </div>

        {/* Children section */}
        <div>
          <h2 className="text-xl font-semibold text-slate-800 mb-4">
            {t("childrenSection")}
          </h2>

          {childrenError || (children && children.length === 0) ? (
            <div className="bg-slate-50 rounded-lg p-6 text-center">
              <p className="text-slate-600">{t("noChildren")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(children || []).map((child: any) => (
                <div
                  key={child.id}
                  className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-lg hover:border-slate-300 transition"
                >
                  <div className="flex items-center gap-3">
                    <ChildAvatar
                      id={child.id}
                      firstName={child.first_name}
                      lastName={child.last_name}
                      size="md"
                    />
                    <div>
                      <p className="font-medium text-slate-900">
                        {child.first_name} {child.last_name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {new Date(child.birth_date).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleExport(child)}
                    disabled={exportingId === child.id}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition ${
                      successId === child.id
                        ? "bg-emerald-50 text-emerald-700"
                        : exportingId === child.id
                          ? "bg-blue-50 text-blue-600 cursor-wait"
                          : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}
                  >
                    {successId === child.id ? (
                      <>
                        <Check className="w-4 h-4" />
                        {t("exportSuccess")}
                      </>
                    ) : exportingId === child.id ? (
                      <>
                        <Download className="w-4 h-4 animate-pulse" />
                        {t("exporting")}
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        {t("exportBtn")}
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-slate-500 mt-4">{t("exportHint")}</p>
        </div>

        {/* Error message */}
        {exportError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-900">{exportError}</p>
          </div>
        )}

        {/* Account deletion section */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Trash2 className="w-5 h-5 text-slate-700" />
            <h2 className="text-xl font-semibold text-slate-800">
              {t("deleteTitle")}
            </h2>
          </div>

          <div className="bg-slate-50 rounded-lg p-6">
            <p className="text-sm text-slate-600 mb-4">{t("deleteDesc")}</p>
            <button
              onClick={() => setShowDeleteModal(true)}
              className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition"
            >
              {t("deleteBtn")}
            </button>

            {deleteSuccess && (
              <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex gap-3">
                <Check className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-emerald-900">{t("deleteSent")}</p>
              </div>
            )}

            {deleteError && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-900">{deleteError}</p>
              </div>
            )}
          </div>
        </div>

        {/* Delete confirmation modal */}
        {showDeleteModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg max-w-md w-full mx-4 p-6 shadow-lg">
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                {t("deleteConfirmTitle")}
              </h3>
              <p className="text-sm text-slate-600 mb-6">
                {t("deleteConfirmDesc")}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  disabled={deleteSending}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition disabled:opacity-50"
                >
                  {t("deleteCancel")}
                </button>
                <button
                  onClick={handleRequestDeletion}
                  disabled={deleteSending}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition ${
                    deleteSending
                      ? "bg-red-100 text-red-700 cursor-wait"
                      : "bg-red-600 text-white hover:bg-red-700"
                  }`}
                >
                  {deleteSending ? tc("saving") : t("deleteConfirm")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Additional requests section */}
        <div className="bg-slate-50 rounded-lg p-6">
          <h3 className="font-semibold text-slate-900 mb-2">{t("contactTitle")}</h3>
          <p className="text-sm text-slate-600">{t("contactDesc")}</p>
        </div>
      </div>
    </div>
  );
}
