"use client";

import { useState, useRef } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { documentsApi, childrenApi, groupsApi } from "../../../../lib/api";
import { Upload, FileText, Download, X, Globe, Users, Baby, Pencil, Trash2, Lock } from "lucide-react";

interface Doc {
  id: string;
  title: string;
  category: string;
  original_filename: string;
  storage_path: string;
  size_bytes: number;
  group_id: string | null;
  child_id: string | null;
  visibility: string;
  created_at: string;
}

interface Child { id: string; first_name: string; last_name: string; }
interface Group { id: string; name: string; }

type Visibility = "private" | "public" | "group" | "child";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost/api";

export default function DocumentsPage() {
  const t = useTranslations("documents");
  const tc = useTranslations("common");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [form, setForm] = useState({ title: "", category: "autre" });
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedChildId, setSelectedChildId] = useState("");

  // Edit state
  const [editDoc, setEditDoc] = useState<Doc | null>(null);
  const [editForm, setEditForm] = useState({ title: "", category: "autre" });
  const [editVisibility, setEditVisibility] = useState<Visibility>("private");
  const [editGroupId, setEditGroupId] = useState("");
  const [editChildId, setEditChildId] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data, mutate } = useSWR("docs-list", () => documentsApi.list());
  const { data: childrenData } = useSWR("children-docs", () => childrenApi.list());
  const { data: groupsData } = useSWR("groups-docs", () => groupsApi.list());

  const docs: Doc[] = (data as { data: Doc[] } | undefined)?.data ?? [];
  const children: Child[] = (childrenData as { data: Child[] } | undefined)?.data ?? [];
  const groups: Group[] = (groupsData as { data: Group[] } | undefined)?.data ?? [];

  const childMap = Object.fromEntries(children.map((c) => [c.id, `${c.first_name} ${c.last_name}`]));
  const groupMap = Object.fromEntries(groups.map((g) => [g.id, g.name]));

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", files[0]);
      fd.append("title", form.title || files[0].name);
      fd.append("category", form.category);
      fd.append("visibility", visibility);
      if (visibility === "group" && selectedGroupId) fd.append("group_id", selectedGroupId);
      if (visibility === "child" && selectedChildId) fd.append("child_id", selectedChildId);
      await documentsApi.upload(fd);
      setForm({ title: "", category: "autre" });
      setVisibility("private");
      setSelectedGroupId("");
      setSelectedChildId("");
      setShowUpload(false);
      mutate();
    } finally {
      setUploading(false);
    }
  };

  const openEdit = (doc: Doc) => {
    setEditDoc(doc);
    setEditForm({ title: doc.title, category: doc.category });
    const vis = doc.visibility as Visibility;
    setEditVisibility(vis);
    setEditGroupId(vis === "group" ? (doc.group_id ?? "") : "");
    setEditChildId(vis === "child" ? (doc.child_id ?? "") : "");
  };

  const handleSave = async () => {
    if (!editDoc) return;
    setSaving(true);
    try {
      await documentsApi.update(editDoc.id, {
        title: editForm.title,
        category: editForm.category,
        visibility: editVisibility,
        group_id: editVisibility === "group" ? editGroupId || undefined : undefined,
        child_id: editVisibility === "child" ? editChildId || undefined : undefined,
      });
      setEditDoc(null);
      mutate();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await documentsApi.delete(deleteId);
      setDeleteId(null);
      mutate();
    } finally {
      setDeleting(false);
    }
  };

  const categories = ["formulaire", "menu", "politique", "bulletin", "autre"];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-800">{t("title")}</h1>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
        >
          <Upload className="w-4 h-4" />
          {t("upload")}
        </button>
      </div>

      {showUpload && (
        <div className="mb-6 bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-slate-800">{t("upload")}</h2>
            <button onClick={() => setShowUpload(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <input
            placeholder={t("titlePlaceholder")}
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <select
            value={form.category}
            onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {t(`categories.${cat}` as keyof ReturnType<typeof useTranslations>)}
              </option>
            ))}
          </select>

          <VisibilitySelector value={visibility} onChange={setVisibility} />

          {visibility === "group" && (
            <select
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t("chooseGroup")}</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}

          {visibility === "child" && (
            <select
              value={selectedChildId}
              onChange={(e) => setSelectedChildId(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t("chooseChild")}</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
              ))}
            </select>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-500 hover:border-blue-400 transition"
          >
            {uploading ? tc("loading") : t("chooseFile")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
        </div>
      )}

      {docs.length === 0 ? (
        <div className="text-center py-16 text-slate-400"><p>{t("noDocuments")}</p></div>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <DocRow
              key={doc.id}
              doc={doc}
              childMap={childMap}
              groupMap={groupMap}
              onEdit={() => openEdit(doc)}
              onDelete={() => setDeleteId(doc.id)}
            />
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editDoc && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">{t("editDocument")}</h2>
              <button onClick={() => setEditDoc(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <input
              value={editForm.title}
              onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("editTitle")}
            />

            <select
              value={editForm.category}
              onChange={(e) => setEditForm((p) => ({ ...p, category: e.target.value }))}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>

            <VisibilitySelector value={editVisibility} onChange={setEditVisibility} />

            {editVisibility === "group" && (
              <select
                value={editGroupId}
                onChange={(e) => setEditGroupId(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t("chooseGroup")}</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}

            {editVisibility === "child" && (
              <select
                value={editChildId}
                onChange={(e) => setEditChildId(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t("chooseChild")}</option>
                {children.map((c) => (
                  <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
                ))}
              </select>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setEditDoc(null)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition"
              >
                {tc("cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !editForm.title}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {saving ? tc("saving") : tc("save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-slate-800">{t("deleteConfirm")}</h2>
            <p className="text-sm text-slate-500">{t("deleteWarning")}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition"
              >
                {tc("cancel")}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition"
              >
                {deleting ? tc("deleting") : tc("delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VisibilitySelector({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  const tc = useTranslations("common");
  const icons: Record<Visibility, React.ReactNode> = {
    private: <Lock className="w-3.5 h-3.5" />,
    public: <Globe className="w-3.5 h-3.5" />,
    group: <Users className="w-3.5 h-3.5" />,
    child: <Baby className="w-3.5 h-3.5" />,
  };
  const labels: Record<Visibility, string> = {
    private: tc("visPrivate"),
    public: tc("visPublic"),
    group: tc("visGroup"),
    child: tc("visChild"),
  };
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1.5">{tc("visibility")}</label>
      <div className="flex gap-2 flex-wrap">
        {(["private", "public", "group", "child"] as Visibility[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition ${
              value === v
                ? "bg-blue-600 text-white border-blue-600"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {icons[v]}
            {labels[v]}
          </button>
        ))}
      </div>
    </div>
  );
}

function DocRow({
  doc,
  childMap,
  groupMap,
  onEdit,
  onDelete,
}: {
  doc: Doc;
  childMap: Record<string, string>;
  groupMap: Record<string, string>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("documents");

  const categoryColor: Record<string, string> = {
    formulaire: "bg-blue-100 text-blue-700",
    menu: "bg-green-100 text-green-700",
    politique: "bg-orange-100 text-orange-700",
    bulletin: "bg-purple-100 text-purple-700",
    autre: "bg-slate-100 text-slate-600",
  };

  const visibilityBadge =
    doc.visibility === "private"
      ? { label: "🔒 Privé", color: "bg-slate-100 text-slate-600" }
      : doc.visibility === "child" && doc.child_id
      ? { label: `👶 ${childMap[doc.child_id] ?? "Enfant"}`, color: "bg-orange-100 text-orange-700" }
      : doc.visibility === "group" && doc.group_id
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
      <button
        onClick={onEdit}
        className="p-2 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition"
      >
        <Pencil className="w-4 h-4" />
      </button>
      <button
        onClick={onDelete}
        className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
