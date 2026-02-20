"use client";

import { useTranslations } from "next-intl";
import useSWR from "swr";
import { documentsApi, childrenApi, groupsApi } from "../../../../lib/api";
import { FileText, Download } from "lucide-react";

interface Doc {
  id: string;
  title: string;
  category: string;
  original_filename: string;
  storage_path: string;
  size_bytes: number;
  group_id: string | null;
  child_id: string | null;
  created_at: string;
}

interface Child { id: string; first_name: string; last_name: string; }
interface Group { id: string; name: string; }

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost/api";

export default function ParentDocumentsPage() {
  const t = useTranslations("documents");

  const { data } = useSWR("docs-list-parent", () => documentsApi.list());
  const { data: childrenData } = useSWR("children-parent-docs", () => childrenApi.list());
  const { data: groupsData } = useSWR("groups-parent-docs", () => groupsApi.list());

  const docs: Doc[] = (data as { data: Doc[] } | undefined)?.data ?? [];
  const children: Child[] = (childrenData as { data: Child[] } | undefined)?.data ?? [];
  const groups: Group[] = (groupsData as { data: Group[] } | undefined)?.data ?? [];

  const childMap = Object.fromEntries(children.map((c) => [c.id, `${c.first_name} ${c.last_name}`]));
  const groupMap = Object.fromEntries(groups.map((g) => [g.id, g.name]));

  return (
    <div className="p-8">
      <h1 className="text-xl font-bold text-slate-800 mb-6">{t("title")}</h1>

      {docs.length === 0 ? (
        <div className="text-center py-16 text-slate-400"><p>{t("noDocuments")}</p></div>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <DocRow key={doc.id} doc={doc} childMap={childMap} groupMap={groupMap} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocRow({
  doc,
  childMap,
  groupMap,
}: {
  doc: Doc;
  childMap: Record<string, string>;
  groupMap: Record<string, string>;
}) {
  const t = useTranslations("documents");

  const categoryColor: Record<string, string> = {
    formulaire: "bg-blue-100 text-blue-700",
    menu: "bg-green-100 text-green-700",
    politique: "bg-orange-100 text-orange-700",
    bulletin: "bg-purple-100 text-purple-700",
    autre: "bg-slate-100 text-slate-600",
  };

  const visibilityBadge = doc.child_id
    ? { label: `👶 ${childMap[doc.child_id] ?? "Enfant"}`, color: "bg-orange-100 text-orange-700" }
    : doc.group_id
    ? { label: `👥 ${groupMap[doc.group_id] ?? "Groupe"}`, color: "bg-blue-100 text-blue-700" }
    : { label: "🌍 Public", color: "bg-green-100 text-green-700" };

  const sizeKb = (doc.size_bytes / 1024).toFixed(0);

  return (
    <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center gap-4">
      <FileText className="w-8 h-8 text-slate-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-800 truncate">{doc.title}</p>
        <p className="text-xs text-slate-400 mt-0.5">
          {new Date(doc.created_at).toLocaleDateString()} · {sizeKb} KB
        </p>
      </div>
      <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${categoryColor[doc.category] || categoryColor.autre}`}>
        {t(`categories.${doc.category}` as keyof ReturnType<typeof useTranslations>)}
      </span>
      <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${visibilityBadge.color}`}>
        {visibilityBadge.label}
      </span>
      <a
        href={`${API_URL}/media/files/${doc.storage_path}`}
        target="_blank"
        rel="noreferrer"
        className="p-2 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition"
      >
        <Download className="w-4 h-4" />
      </a>
    </div>
  );
}
