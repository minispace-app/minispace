"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { Shield, ChevronLeft, ChevronRight } from "lucide-react";
import { auditApi } from "../../../../lib/api";

interface AuditEntry {
  id: string;
  user_id:        string | null;
  user_name:      string | null;
  action:         string;
  resource_type:  string | null;
  resource_id:    string | null;
  resource_label: string | null;
  ip_address:     string | null;
  created_at:     string;
}

interface AuditResponse {
  entries: AuditEntry[];
  total:   number;
  page:    number;
  limit:   number;
}

// Action category → color
const ACTION_COLORS: Record<string, string> = {
  "auth":     "bg-blue-100 text-blue-700",
  "child":    "bg-green-100 text-green-700",
  "user":     "bg-orange-100 text-orange-700",
  "media":    "bg-purple-100 text-purple-700",
  "document": "bg-yellow-100 text-yellow-700",
  "consent":  "bg-teal-100 text-teal-700",
};

const CATEGORY_FILTERS = [
  { value: "",         labelKey: "filterAll" },
  { value: "auth",     labelKey: "filterAuth" },
  { value: "child",    labelKey: "filterChild" },
  { value: "user",     labelKey: "filterUser" },
  { value: "media",    labelKey: "filterMedia" },
  { value: "document", labelKey: "filterDocument" },
];

function actionColor(action: string): string {
  const prefix = action.split(".")[0];
  return ACTION_COLORS[prefix] ?? "bg-slate-100 text-slate-600";
}

function formatAction(action: string, t: ReturnType<typeof useTranslations>): string {
  const map: Record<string, string> = {
    "auth.login":           t("actionLogin"),
    "auth.login_failure":   t("actionLoginFailure"),
    "auth.password_change": t("actionPasswordChange"),
    "child.create":         t("actionChildCreate"),
    "child.update":         t("actionChildUpdate"),
    "child.delete":         t("actionChildDelete"),
    "user.create":          t("actionUserCreate"),
    "user.update":          t("actionUserUpdate"),
    "user.deactivate":      t("actionUserDeactivate"),
    "user.delete":          t("actionUserDelete"),
    "media.upload":         t("actionMediaUpload"),
    "media.delete":         t("actionMediaDelete"),
    "document.upload":      t("actionDocumentUpload"),
    "document.delete":      t("actionDocumentDelete"),
  };
  return map[action] ?? action;
}

const LIMIT = 50;

export default function AuditLogPage() {
  const t  = useTranslations("auditLog");
  const tc = useTranslations("common");

  const [page,      setPage]      = useState(1);
  const [category,  setCategory]  = useState("");

  const fetcher = () =>
    auditApi.list({ page, limit: LIMIT, action: category || undefined }).then((r) => r.data);

  const { data, isLoading } = useSWR<AuditResponse>(
    `/audit-log?page=${page}&action=${category}`,
    fetcher,
  );

  const entries   = data?.entries ?? [];
  const total     = data?.total   ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const handleCategory = (val: string) => {
    setCategory(val);
    setPage(1);
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
          <Shield className="w-5 h-5 text-slate-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">{t("title")}</h1>
          <p className="text-sm text-slate-500">{t("subtitle")}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {CATEGORY_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => handleCategory(f.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              category === f.value
                ? "bg-slate-800 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {t(f.labelKey as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-400 text-sm">{tc("loading")}</div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">{t("empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t("colDate")}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t("colUser")}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t("colAction")}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t("colResource")}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{t("colIp")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap font-mono text-xs">
                      {new Date(entry.created_at).toLocaleString("fr-CA", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-4 py-3 text-slate-700 max-w-[160px] truncate">
                      {entry.user_name ?? <span className="text-slate-400 italic">{t("systemAction")}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold ${actionColor(entry.action)}`}>
                        {formatAction(entry.action, t)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate">
                      {entry.resource_label ?? entry.resource_id ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                      {entry.ip_address ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-slate-500">
            {t("paginationInfo", { current: page, total: totalPages, count: total })}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
