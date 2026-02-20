"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { emailApi, usersApi } from "../../../../lib/api";

interface User {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
}

export default function EmailPage() {
  const t = useTranslations("email");
  const tc = useTranslations("common");

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipientId, setRecipientId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const { data: usersData } = useSWR("/users", () =>
    usersApi.list().then((r) => r.data)
  );

  const parents: User[] = (usersData || []).filter(
    (u: User) => u.role === "parent"
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSent(false);
    setLoading(true);
    try {
      await emailApi.sendToParents({
        subject,
        body,
        recipient_id: recipientId || undefined,
      });
      setSent(true);
      setSubject("");
      setBody("");
      setRecipientId("");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || tc("error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">{t("title")}</h1>

      {sent && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {t("sent")}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
          {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-4 bg-white rounded-xl shadow-sm border border-slate-100 p-6"
      >
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t("selectRecipient")}
          </label>
          <select
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">{t("allParents")}</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.first_name} {p.last_name} — {p.email}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t("subject")}
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {t("body")}
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition disabled:opacity-50"
        >
          {loading ? tc("loading") : t("sendButton")}
        </button>
      </form>
    </div>
  );
}
