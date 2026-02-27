"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { childrenApi, groupsApi } from "../../../../lib/api";
import { ChildAvatar, childAvatarColor } from "../../../../components/ChildAvatar";
import { Users, Pencil, Check, X } from "lucide-react";

interface Child {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  group_id: string | null;
}

interface Group {
  id: string;
  name: string;
}

function age(birthDate: string, monthsLabel: string, yearsLabel: string) {
  const diff = Date.now() - new Date(birthDate).getTime();
  const months = Math.floor(diff / (1000 * 60 * 60 * 24 * 30));
  if (months < 24) return `${months} ${monthsLabel}`;
  return `${Math.floor(months / 12)} ${yearsLabel}`;
}

function ChildCard({ child, groupMap }: { child: Child; groupMap: Record<string, string> }) {
  const t = useTranslations("children");
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden p-5">
      <div className="flex items-center gap-4">
        <ChildAvatar id={child.id} firstName={child.first_name} lastName={child.last_name} size="lg" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 text-lg">
            {child.first_name} {child.last_name}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            {age(child.birth_date, t("months"), t("years"))}
            {child.group_id && groupMap[child.group_id] && (
              <span className="ml-2 text-blue-600">· {groupMap[child.group_id]}</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function ChildBirthDateEdit({ child, onUpdated }: { child: Child; onUpdated: () => void }) {
  const tc = useTranslations("common");
  const t = useTranslations("children");
  const [editing, setEditing] = useState(false);
  const [birthDate, setBirthDate] = useState(child.birth_date);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await childrenApi.update(child.id, { birth_date: birthDate });
      setEditing(false);
      onUpdated();
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setBirthDate(child.birth_date);
    setEditing(false);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <Pencil className="w-4 h-4 text-slate-500" />
          {t("birthDate")}
        </h3>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium transition"
          >
            {tc("edit")}
          </button>
        )}
      </div>
      <div className="px-5 py-4">
        {!editing ? (
          <p className="text-sm text-slate-700">{child.birth_date}</p>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              title={tc("save")}
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={handleCancel}
              className="p-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
              title={tc("cancel")}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ParentChildrenPage() {
  const t = useTranslations("children");
  const [selectedChildId, setSelectedChildId] = useState<string>("");

  const { data, mutate } = useSWR("parent-children", () => childrenApi.list().then((r) => r.data as Child[]));
  const { data: groupsData } = useSWR("groups-parent", () => groupsApi.list());

  const children: Child[] = data ?? [];
  const groups: Group[] = (groupsData as { data: Group[] } | undefined)?.data ?? [];
  const groupMap = Object.fromEntries(groups.map((g) => [g.id, g.name]));

  const selectedChild = children.find((c) => c.id === selectedChildId);

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex flex-col w-64 border-r border-slate-200 bg-white flex-shrink-0">
        <div className="px-4 py-4 border-b border-slate-100">
          <h1 className="text-base font-semibold text-slate-800">{t("myChildren")}</h1>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {children.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-400">{t("noChildrenParent")}</p>
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
        <div className="px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h1 className="text-base font-semibold text-slate-800">{t("myChildren")}</h1>
        </div>

        {!selectedChildId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Users className="w-12 h-12 opacity-30" />
            <p className="text-sm">{t("selectChild")}</p>
          </div>
        ) : selectedChild ? (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <ChildCard child={selectedChild} groupMap={groupMap} />
            <ChildBirthDateEdit child={selectedChild} onUpdated={() => mutate()} />
          </div>
        ) : null}
      </div>

      {/* ── Mobile ── */}
      <div className="md:hidden flex flex-col h-full w-full overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <h1 className="text-base font-semibold text-slate-800">{t("myChildren")}</h1>
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
                    isActive ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
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
            <Users className="w-10 h-10 opacity-30" />
            <p className="text-sm">{t("selectChild")}</p>
          </div>
        ) : selectedChild ? (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            <ChildCard child={selectedChild} groupMap={groupMap} />
            <ChildBirthDateEdit child={selectedChild} onUpdated={() => mutate()} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
