"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { childrenApi, groupsApi, usersApi } from "../../../../lib/api";
import { useAuth } from "../../../../hooks/useAuth";
import { Plus, ChevronDown, ChevronUp, UserPlus, X, Pencil } from "lucide-react";
import { ChildAvatar, childAvatarColor } from "../../../../components/ChildAvatar";

interface Child {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  group_id: string | null;
  is_active: boolean;
}

interface Group {
  id: string;
  name: string;
}

interface ParentUser {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  relationship: string;
}

interface UserOption {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
}

function ChildDetails({
  child,
  groups,
  groupMap,
  onUpdated,
  canWrite,
}: {
  child: Child;
  groups: Group[];
  groupMap: Record<string, string>;
  onUpdated: () => void;
  canWrite: boolean;
}) {
  const tc = useTranslations("common");
  const t = useTranslations("children");

  // Edit state
  const [firstName, setFirstName] = useState(child.first_name);
  const [lastName, setLastName] = useState(child.last_name);
  const [birthDate, setBirthDate] = useState(child.birth_date);
  const [groupId, setGroupId] = useState(child.group_id ?? "");
  const [savingEdit, setSavingEdit] = useState(false);

  // Parents state
  const [showAddParent, setShowAddParent] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [relationship, setRelationship] = useState("parent");
  const [savingParent, setSavingParent] = useState(false);

  const { data: parentsData, mutate: mutateParents } = useSWR(
    `child-parents-${child.id}`,
    () => childrenApi.listParents(child.id)
  );

  const { data: usersData } = useSWR(
    "users-list-for-parents",
    () => usersApi.list()
  );

  const parents: ParentUser[] = (parentsData as { data: ParentUser[] } | undefined)?.data ?? [];
  const allUsers: UserOption[] = (usersData as { data: UserOption[] } | undefined)?.data ?? [];
  const parentOptions = allUsers.filter((u) => u.role === "parent");
  const assignedIds = new Set(parents.map((p) => p.user_id));
  const availableOptions = parentOptions.filter((u) => !assignedIds.has(u.id));

  const handleAddParent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) return;
    setSavingParent(true);
    try {
      await childrenApi.assignParent(child.id, selectedUserId, relationship);
      setSelectedUserId("");
      setRelationship("parent");
      setShowAddParent(false);
      mutateParents();
    } finally {
      setSavingParent(false);
    }
  };

  const handleRemoveParent = async (userId: string) => {
    if (!confirm(t("confirmRemoveParent"))) return;
    await childrenApi.removeParent(child.id, userId);
    mutateParents();
    onUpdated();
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEdit(true);
    try {
      await childrenApi.update(child.id, {
        first_name: firstName,
        last_name: lastName,
        birth_date: birthDate,
        group_id: groupId || undefined,
      });
      onUpdated();
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(t("confirmDeleteChild"))) return;
    try {
      await childrenApi.delete(child.id);
      onUpdated();
    } catch (err) {
      alert(t("deleteError"));
    }
  };

  return (
    <div className="space-y-6">
      {/* Edit details section */}
      {canWrite && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Pencil className="w-4 h-4 text-slate-500" />
              {tc("edit")}
            </h3>
          </div>
          <form onSubmit={handleSaveEdit} className="px-5 py-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t("firstName")}
                </label>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t("lastName")}
                </label>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {t("birthDate")}
              </label>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {t("group")}
              </label>
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t("noGroup")}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={savingEdit}
                className="px-4 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {savingEdit ? tc("loading") : tc("save")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setFirstName(child.first_name);
                  setLastName(child.last_name);
                  setBirthDate(child.birth_date);
                  setGroupId(child.group_id ?? "");
                }}
                className="px-4 py-2 border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50"
              >
                {tc("reset")}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="ml-auto px-3 py-2 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700"
              >
                {tc("delete")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Parents section */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-slate-500" />
              {t("associatedParents")}
            </h3>
            {canWrite && !showAddParent && (
              <button
                onClick={() => setShowAddParent(true)}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium transition"
              >
                <UserPlus className="w-3.5 h-3.5" />
                {t("associate")}
              </button>
            )}
          </div>
        </div>

        <div className="px-5 py-4">
          {parents.length === 0 ? (
            <p className="text-sm text-slate-400">{t("noParents")}</p>
          ) : (
            <ul className="space-y-2 mb-4">
              {parents.map((p) => (
                <li
                  key={p.user_id}
                  className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2"
                >
                  <div>
                    <span className="text-sm font-medium text-slate-800">
                      {p.first_name} {p.last_name}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-500">{p.email}</span>
                      <span className="text-xs bg-slate-200 text-slate-600 rounded px-2 py-0.5">
                        {p.relationship}
                      </span>
                    </div>
                  </div>
                  {canWrite && (
                    <button
                      onClick={() => handleRemoveParent(p.user_id)}
                      className="text-slate-400 hover:text-red-500 transition ml-3 flex-shrink-0"
                      title={t("remove")}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canWrite && showAddParent && (
            <form onSubmit={handleAddParent} className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-2 mt-2">
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                required
              >
                <option value="">{t("chooseParent")}</option>
                {availableOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.first_name} {u.last_name} ({u.email})
                  </option>
                ))}
              </select>
              <select
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="parent">{t("relationshipParent")}</option>
                <option value="tuteur">{t("relationshipGuardian")}</option>
                <option value="gardien">{t("relationshipCaretaker")}</option>
                <option value="autre">{t("relationshipOther")}</option>
              </select>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={savingParent || !selectedUserId}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingParent ? tc("loading") : t("associate")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddParent(false);
                    setSelectedUserId("");
                  }}
                  className="px-3 py-1.5 border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-white"
                >
                  {tc("cancel")}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function ChildCard({
  child,
  groupMap,
}: {
  child: Child;
  groupMap: Record<string, string>;
}) {
  const t = useTranslations("children");

  const ageDisplay = (birthDate: string) => {
    const diff = Date.now() - new Date(birthDate).getTime();
    const months = Math.floor(diff / (1000 * 60 * 60 * 24 * 30));
    if (months < 24) return `${months} ${t("months")}`;
    return `${Math.floor(months / 12)} ${t("years")}`;
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden p-5">
      <div className="flex items-center gap-4">
        <ChildAvatar id={child.id} firstName={child.first_name} lastName={child.last_name} size="lg" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 text-lg">
            {child.first_name} {child.last_name}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            {ageDisplay(child.birth_date)}
            {child.group_id && groupMap[child.group_id] && (
              <span className="ml-2 text-blue-600">· {groupMap[child.group_id]}</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ChildrenPage() {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const { user } = useAuth();
  const canWrite = user?.role === "admin_garderie" || user?.role === "super_admin";
  const [selectedChildId, setSelectedChildId] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    birth_date: "",
    group_id: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const { data, mutate } = useSWR("children-list", () => childrenApi.list());
  const { data: groupsData } = useSWR("groups-list-ch", () => groupsApi.list());

  const children: Child[] = (data as { data: Child[] } | undefined)?.data ?? [];
  const groups: Group[] = (groupsData as { data: Group[] } | undefined)?.data ?? [];
  const groupMap = Object.fromEntries(groups.map((g) => [g.id, g.name]));

  const selectedChild = children.find((c) => c.id === selectedChildId);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await childrenApi.create({
        first_name: form.first_name,
        last_name: form.last_name,
        birth_date: form.birth_date,
        group_id: form.group_id || undefined,
        notes: form.notes || undefined,
      });
      setForm({ first_name: "", last_name: "", birth_date: "", group_id: "", notes: "" });
      setShowForm(false);
      mutate();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Desktop sidebar: child list ── */}
      <aside className="hidden md:flex flex-col w-64 border-r border-slate-200 bg-white flex-shrink-0">
        <div className="px-4 py-4 border-b border-slate-100">
          <h1 className="text-base font-semibold text-slate-800">{t("title")}</h1>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {children.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-400">{t("noChildren")}</p>
          )}
          {children.map((child) => {
            const isActive = selectedChildId === child.id;
            return (
              <button
                key={child.id}
                onClick={() => setSelectedChildId(child.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition border-l-2 ${
                  isActive
                    ? "bg-blue-50 border-l-blue-600"
                    : "border-l-transparent hover:bg-slate-50"
                }`}
              >
                <ChildAvatar id={child.id} firstName={child.first_name} lastName={child.last_name} size="sm" />
                <span className={`text-sm truncate ${isActive ? "font-semibold text-blue-700" : "text-slate-700"}`}>
                  {child.first_name} {child.last_name}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── Desktop main content ── */}
      <div className="hidden md:flex flex-col flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h1 className="text-base font-semibold text-slate-800">{t("title")}</h1>
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

        {!selectedChildId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Plus className="w-12 h-12 opacity-30" />
            <p className="text-sm">{t("selectChild")}</p>
          </div>
        ) : selectedChild ? (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <ChildCard child={selectedChild} groupMap={groupMap} />
            <ChildDetails
              child={selectedChild}
              groups={groups}
              groupMap={groupMap}
              onUpdated={() => mutate()}
              canWrite={canWrite}
            />
          </div>
        ) : null}
      </div>

      {/* ── Mobile ── */}
      <div className="md:hidden flex flex-col h-full w-full overflow-hidden">
        {/* Mobile header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <h1 className="text-base font-semibold text-slate-800">{t("title")}</h1>
          {canWrite && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("add")}
            </button>
          )}
        </div>

        {/* Child chips */}
        {children.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-4 py-2.5 border-b border-slate-100 flex-shrink-0 scrollbar-none">
            {children.map((child) => {
              const isActive = selectedChildId === child.id;
              return (
                <button
                  key={child.id}
                  onClick={() => setSelectedChildId(child.id)}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
                    isActive ? "bg-white/25 text-white" : `${childAvatarColor(child.id)} text-white`
                  }`}>
                    {child.first_name[0]}
                  </span>
                  {child.first_name}
                </button>
              );
            })}
          </div>
        )}

        {!selectedChildId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Plus className="w-10 h-10 opacity-30" />
            <p className="text-sm">{t("selectChild")}</p>
          </div>
        ) : selectedChild ? (
          <div className="flex-1 overflow-y-auto pb-4">
            <div className="px-4 py-4 space-y-4">
              <ChildCard child={selectedChild} groupMap={groupMap} />
              <ChildDetails
                child={selectedChild}
                groups={groups}
                groupMap={groupMap}
                onUpdated={() => mutate()}
                canWrite={canWrite}
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Add form modal overlay (shown on both desktop and mobile) ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-800">{t("add")}</h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input
                  placeholder={t("firstName")}
                  value={form.first_name}
                  onChange={(e) => setForm((p) => ({ ...p, first_name: e.target.value }))}
                  className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <input
                  placeholder={t("lastName")}
                  value={form.last_name}
                  onChange={(e) => setForm((p) => ({ ...p, last_name: e.target.value }))}
                  className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <input
                type="date"
                value={form.birth_date}
                onChange={(e) => setForm((p) => ({ ...p, birth_date: e.target.value }))}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              <select
                value={form.group_id}
                onChange={(e) => setForm((p) => ({ ...p, group_id: e.target.value }))}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t("group")} ({tc("optional")})</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-3 pt-2">
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
          </div>
        </div>
      )}
    </div>
  );
}
