"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import { messagesApi, childrenApi, groupsApi } from "../../../../lib/api";
import { useAuth } from "../../../../hooks/useAuth";
import { Send, AlertCircle } from "lucide-react";

interface Child {
  id: string;
  first_name: string;
  last_name: string;
  group_id?: string;
}

interface Group {
  id: string;
  name: string;
}

export default function SendToParentsPage() {
  const { user } = useAuth();
  const [scope, setScope] = useState<"all_parents" | "child_parents" | "group_parents">(
    "all_parents"
  );
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [selectedChild, setSelectedChild] = useState<string>("");
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const { data: childrenData } = useSWR(
    "/children",
    () => childrenApi.list().then((res) => res.data),
    { revalidateOnFocus: false }
  );
  const { data: groupsData } = useSWR(
    "/groups",
    () => groupsApi.list().then((res) => res.data),
    { revalidateOnFocus: false }
  );

  const children: Child[] = childrenData ?? [];
  const groups: Group[] = groupsData ?? [];

  // Only staff can access this page
  const isStaff =
    user?.role === "admin_garderie" ||
    user?.role === "educateur" ||
    user?.role === "super_admin";

  const handleSend = useCallback(async () => {
    if (!subject.trim() || !content.trim()) {
      setMessage({ type: "error", text: "Veuillez remplir le sujet et le contenu" });
      return;
    }

    if (scope === "child_parents" && !selectedChild) {
      setMessage({ type: "error", text: "Veuillez sélectionner un enfant" });
      return;
    }

    if (scope === "group_parents" && !selectedGroup) {
      setMessage({ type: "error", text: "Veuillez sélectionner un groupe" });
      return;
    }

    setSending(true);
    setMessage(null);

    try {
      await messagesApi.sendToParents({
        subject,
        content,
        scope,
        child_id: selectedChild || undefined,
        group_id: selectedGroup || undefined,
      });

      setMessage({
        type: "success",
        text: "Message envoyé avec succès aux parents et email en cours d'envoi...",
      });
      setSubject("");
      setContent("");
      setSelectedChild("");
      setSelectedGroup("");

      setTimeout(() => setMessage(null), 4000);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setMessage({
        type: "error",
        text: error?.response?.data?.error || "Erreur lors de l'envoi du message",
      });
    } finally {
      setSending(false);
    }
  }, [subject, content, scope, selectedChild, selectedGroup]);

  if (!isStaff) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-600">Accès refusé</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Message aux parents</h1>
        <p className="text-slate-600 text-sm">
          Envoyez un message à tous les parents (ou un groupe spécifique). Un email sera
          automatiquement envoyé à chaque parent.
        </p>
      </div>

      {message && (
        <div
          className={`mb-4 p-4 rounded-lg flex items-start gap-3 ${
            message.type === "success"
              ? "bg-green-50 border border-green-200 text-green-700"
              : "bg-red-50 border border-red-200 text-red-700"
          }`}
        >
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p className="text-sm">{message.text}</p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        {/* Scope Selection */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-3">
            Destinataires
          </label>
          <div className="space-y-2">
            {[
              {
                value: "all_parents" as const,
                label: "Tous les parents du service de garde",
              },
              { value: "child_parents" as const, label: "Parents d'un enfant" },
              { value: "group_parents" as const, label: "Parents d'un groupe" },
            ].map((opt) => (
              <label key={opt.value} className="flex items-center gap-3 cursor-pointer p-2 hover:bg-slate-50 rounded">
                <input
                  type="radio"
                  name="scope"
                  value={opt.value}
                  checked={scope === opt.value}
                  onChange={() => {
                    setScope(opt.value);
                    setSelectedChild("");
                    setSelectedGroup("");
                  }}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-slate-700">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Child Selection */}
        {scope === "child_parents" && (
          <div>
            <label htmlFor="child" className="block text-sm font-medium text-slate-700 mb-2">
              Sélectionner un enfant *
            </label>
            <select
              id="child"
              value={selectedChild}
              onChange={(e) => setSelectedChild(e.target.value)}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="">-- Choisir un enfant --</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Group Selection */}
        {scope === "group_parents" && (
          <div>
            <label htmlFor="group" className="block text-sm font-medium text-slate-700 mb-2">
              Sélectionner un groupe *
            </label>
            <select
              id="group"
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="">-- Choisir un groupe --</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Subject */}
        <div>
          <label htmlFor="subject" className="block text-sm font-medium text-slate-700 mb-2">
            Sujet *
          </label>
          <input
            id="subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Ex: Activité de la semaine"
            className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>

        {/* Content */}
        <div>
          <label htmlFor="content" className="block text-sm font-medium text-slate-700 mb-2">
            Message *
          </label>
          <textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Composez votre message ici..."
            rows={6}
            className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
          />
          <p className="text-xs text-slate-500 mt-1">
            {content.length} caractères
          </p>
        </div>

        {/* Submit Button */}
        <div className="flex gap-3 pt-4">
          <button
            onClick={handleSend}
            disabled={sending || !subject.trim() || !content.trim()}
            className="flex-1 px-6 py-3 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
          >
            <Send className="w-4 h-4" />
            {sending ? "Envoi en cours..." : "Envoyer le message"}
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>Note:</strong> Un email contenant le sujet et le message sera automatiquement
          envoyé à chaque parent sélectionné.
        </p>
      </div>
    </div>
  );
}

