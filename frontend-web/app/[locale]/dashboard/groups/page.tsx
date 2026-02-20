"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { groupsApi, childrenApi } from "../../../../lib/api";
import { useAuth } from "../../../../hooks/useAuth";
import { Plus, Trash2, Pencil, X, Users } from "lucide-react";

interface Group {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
}

interface Child {
  id: string;
  first_name: string;
  last_name: string;
  group_id: string | null;
  is_active: boolean;
}

type EditState = {
  id: string;
  name: string;
  description: string;
  color: string;
  childIds: Set<string>;
};

export default function GroupsPage() {
  const t = useTranslations("groups");
  const tc = useTranslations("common");
  const { user } = useAuth();
  const canWrite = user?.role === "admin_garderie" || user?.role === "super_admin";

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", color: "#3b82f6" });
  const [saving, setSaving] = useState(false);

  // Edit modal
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const { data: groupsData, mutate: mutateGroups } = useSWR("groups-list", () => groupsApi.list());
  const { data: childrenData, mutate: mutateChildren } = useSWR("children-groups-page", () => childrenApi.list());

  const groups: Group[] = (groupsData as { data: Group[] } | undefined)?.data ?? [];
  const allChildren: Child[] = ((childrenData as { data: Child[] } | undefined)?.data ?? [])
    .filter((c) => c.is_active);

  const childrenByGroup = (groupId: string) => allChildren.filter((c) => c.group_id === groupId);

  // Create
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await groupsApi.create(form);
      setForm({ name: "", description: "", color: "#3b82f6" });
      setShowForm(false);
      mutateGroups();
    } finally {
      setSaving(false);
    }
  };

  // Open edit modal
  const openEdit = (group: Group) => {
    const currentChildIds = new Set(
      allChildren.filter((c) => c.group_id === group.id).map((c) => c.id)
    );
    setEditState({
      id: group.id,
      name: group.name,
      description: group.description ?? "",
      color: group.color ?? "#3b82f6",
      childIds: currentChildIds,
    });
  };

  // Save edit
  const handleSaveEdit = async () => {
    if (!editState) return;
    setEditSaving(true);
    try {
      await groupsApi.update(editState.id, {
        name: editState.name,
        description: editState.description || undefined,
        color: editState.color,
      });
      await groupsApi.setChildren(editState.id, Array.from(editState.childIds));
      setEditState(null);
      mutateGroups();
      mutateChildren();
    } finally {
      setEditSaving(false);
    }
  };

  // Toggle child in edit modal
  const toggleChild = (childId: string) => {
    setEditState((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.childIds);
      if (next.has(childId)) next.delete(childId);
      else next.add(childId);
      return { ...prev, childIds: next };
    });
  };

  // Delete
  const handleDelete = async (id: string) => {
    if (!confirm(t("confirmDelete"))) return;
    try {
      await groupsApi.delete(id);
      mutateGroups();
      mutateChildren();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(msg || tc("error"));
    }
  };

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-800">{t("title")}</h1>
        {canWrite && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
          >
            <Plus className="w-4 h-4" />
            {t("add")}
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mb-6 bg-white border border-slate-200 rounded-xl p-5 space-y-3"
        >
          <input
            placeholder={t("name")}
            value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <input
            placeholder={t("description")}
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-600">{t("color")}</label>
            <input
              type="color"
              value={form.color}
              onChange={(e) => setForm((p) => ({ ...p, color: e.target.value }))}
              className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? tc("loading") : tc("create")}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-5 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50"
            >
              {tc("cancel")}
            </button>
          </div>
        </form>
      )}

      {/* Groups grid */}
      {groups.length === 0 ? (
        <p className="text-center text-slate-400 py-16">{t("noGroups")}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((group) => {
            const kids = childrenByGroup(group.id);
            return (
              <div
                key={group.id}
                className="bg-white border border-slate-200 rounded-xl p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-10 h-10 rounded-lg flex-shrink-0"
                      style={{ backgroundColor: group.color || "#3b82f6" }}
                    />
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800 truncate">{group.name}</p>
                      {group.description && (
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{group.description}</p>
                      )}
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => openEdit(group)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                        title={t("edit")}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(group.id)}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Children chips */}
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <Users className="w-3.5 h-3.5" />
                    {t("childCount", { count: kids.length })}
                  </span>
                  {kids.slice(0, 3).map((c) => (
                    <span
                      key={c.id}
                      className="px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-600"
                    >
                      {c.first_name}
                    </span>
                  ))}
                  {kids.length > 3 && (
                    <span className="text-xs text-slate-400">+{kids.length - 3}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit modal */}
      {editState && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
              <h2 className="text-base font-semibold text-slate-800">{t("edit")}</h2>
              <button
                onClick={() => setEditState(null)}
                className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t("name")}</label>
                <input
                  value={editState.name}
                  onChange={(e) => setEditState((p) => p ? { ...p, name: e.target.value } : p)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t("description")}</label>
                <input
                  value={editState.description}
                  onChange={(e) => setEditState((p) => p ? { ...p, description: e.target.value } : p)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Color */}
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-slate-700">{t("color")}</label>
                <input
                  type="color"
                  value={editState.color}
                  onChange={(e) => setEditState((p) => p ? { ...p, color: e.target.value } : p)}
                  className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer"
                />
                <div
                  className="w-8 h-8 rounded-lg border border-slate-200"
                  style={{ backgroundColor: editState.color }}
                />
              </div>

              {/* Children */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">{t("children")}</label>
                {allChildren.length === 0 ? (
                  <p className="text-sm text-slate-400">{t("noChildren")}</p>
                ) : (
                  <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-56 overflow-y-auto">
                    {allChildren.map((child) => (
                      <label
                        key={child.id}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={editState.childIds.has(child.id)}
                          onChange={() => toggleChild(child.id)}
                          className="w-4 h-4 accent-blue-600"
                        />
                        <span className="text-sm text-slate-700">
                          {child.first_name} {child.last_name}
                        </span>
                        {child.group_id && child.group_id !== editState.id && (
                          <span className="ml-auto text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                            {groups.find((g) => g.id === child.group_id)?.name ?? "autre groupe"}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 flex-shrink-0">
              <button
                onClick={() => setEditState(null)}
                className="px-5 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50"
              >
                {tc("cancel")}
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={editSaving || !editState.name.trim()}
                className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {editSaving ? tc("loading") : t("saveChanges")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
