"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { childrenApi } from "../../../../lib/api";
import { childAvatarColor, ChildAvatar } from "../../../../components/ChildAvatar";
import { Download, AlertCircle, Check } from "lucide-react";

export default function PrivacyPage() {
  const t = useTranslations("privacy");
  const tc = useTranslations("common");
  const { data: children, error: childrenError } = useSWR(
    "children",
    () => childrenApi.list().then((r) => r.data)
  );

  const [exportingId, setExportingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successId, setSuccessId] = useState<string | null>(null);

  const activeChildren = children?.filter((c: any) => c.is_active) ?? [];

  const handleExport = async (child: any) => {
    setExportingId(child.id);
    setError("");
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
      setError(e?.response?.data?.error || t("exportError"));
    } finally {
      setExportingId(null);
    }
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

        {/* Children section */}
        <div>
          <h2 className="text-xl font-semibold text-slate-800 mb-4">
            {t("childrenSection")}
          </h2>

          {childrenError || (children && activeChildren.length === 0) ? (
            <div className="bg-slate-50 rounded-lg p-6 text-center">
              <p className="text-slate-600">{t("noChildren")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeChildren.map((child: any) => (
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
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-900">{error}</p>
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
