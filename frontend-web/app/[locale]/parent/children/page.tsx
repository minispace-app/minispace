"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { childrenApi, groupsApi } from "../../../../lib/api";
import { User, Pencil, Check, X } from "lucide-react";

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

function ChildCard({
  child,
  groupMap,
  onUpdated,
}: {
  child: Child;
  groupMap: Record<string, string>;
  onUpdated: () => void;
}) {
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
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
          <User className="w-6 h-6 text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800">
            {child.first_name} {child.last_name}
          </p>
          {!editing && (
            <p className="text-sm text-slate-500 mt-0.5">
              {age(child.birth_date, t("months"), t("years"))}
              {child.group_id && groupMap[child.group_id] && (
                <span className="ml-2 text-blue-600">· {groupMap[child.group_id]}</span>
              )}
            </p>
          )}
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-slate-400 hover:text-blue-500 transition"
            title={t("editBirthDate")}
          >
            <Pencil className="w-4 h-4" />
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <label className="block text-xs font-medium text-slate-500 mb-1">
            {t("birthDate")}
          </label>
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
        </div>
      )}
    </div>
  );
}

export default function ParentChildrenPage() {
  const t = useTranslations("children");
  const { data, mutate } = useSWR("parent-children", () => childrenApi.list());
  const { data: groupsData } = useSWR("groups-parent", () => groupsApi.list());

  const children: Child[] = (data as { data: Child[] } | undefined)?.data ?? [];
  const groups: Group[] = (groupsData as { data: Group[] } | undefined)?.data ?? [];
  const groupMap = Object.fromEntries(groups.map((g) => [g.id, g.name]));

  return (
    <div className="p-8">
      <h1 className="text-xl font-bold text-slate-800 mb-6">{t("myChildren")}</h1>

      {children.length === 0 ? (
        <p className="text-center text-slate-400 py-16">
          {t("noChildrenParent")}
          <br />
          <span className="text-sm">
            {t("contactGarderie")}
          </span>
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {children.map((child) => (
            <ChildCard
              key={child.id}
              child={child}
              groupMap={groupMap}
              onUpdated={() => mutate()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
