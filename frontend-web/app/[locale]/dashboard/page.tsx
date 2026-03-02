"use client";

import { useTranslations } from "next-intl";
import { useAuth } from "../../../hooks/useAuth";
import useSWR from "swr";
import { groupsApi, childrenApi, messagesApi, attendanceApi } from "../../../lib/api";
import { format } from "date-fns";
import { AlertCircle } from "lucide-react";
import { ChildAvatar } from "../../../components/ChildAvatar";

const fetcher = (fn: () => Promise<{ data: unknown }>) => fn().then((r) => r.data);

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const { user } = useAuth();

  const { data: messages } = useSWR("messages", () => messagesApi.list(1, 5));
  const { data: children } = useSWR("children", () => childrenApi.list());
  const { data: groups } = useSWR("groups", () => groupsApi.list());

  const today = format(new Date(), "yyyy-MM");
  const { data: attendance } = useSWR(
    user?.role === "educateur" || user?.role === "admin_garderie" ? `attendance-${today}` : null,
    () => attendanceApi.getMonthAllChildren(today)
  );

  const recentMessages = (messages as { data: { data?: unknown[] } } | undefined)?.data as { id: string; content: string; created_at: string; message_type: string }[] | undefined;
  const childrenList = (children as { data: unknown[] } | undefined)?.data as { id: string; first_name: string; last_name: string }[] | undefined;
  const groupsList = (groups as { data: unknown[] } | undefined)?.data as { id: string }[] | undefined;

  // Get absent children for today
  const attendanceRecords = (attendance as { data: { attendance?: [string, string, string][] } } | undefined)?.data?.attendance || [];
  const todayStr = format(new Date(), "yyyy-MM-dd");

  const absentToday = new Set(
    attendanceRecords
      .filter(([_, date, status]) => date === todayStr && status === "absent")
      .map(([childId]) => childId)
  );

  const absentChildren = childrenList?.filter((child) => absentToday.has(child.id)) ?? [];

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">
        {user ? t("welcome", { name: user.first_name }) : "Tableau de bord"}
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard
          label="Messages"
          value={recentMessages?.length ?? 0}
          color="blue"
        />
        <StatCard
          label={t("childrenCount", { count: childrenList?.length ?? 0 })}
          value={childrenList?.length ?? 0}
          color="green"
        />
        <StatCard
          label={t("groupsCount", { count: groupsList?.length ?? 0 })}
          value={groupsList?.length ?? 0}
          color="purple"
        />
      </div>

      {/* Absent children section */}
      {(user?.role === "educateur" || user?.role === "admin_garderie") && absentChildren.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <h2 className="font-semibold text-red-900">Enfants absents aujourd'hui</h2>
          </div>
          <div className="space-y-2">
            {absentChildren.map((child) => (
              <div key={child.id} className="flex items-center gap-3 bg-white rounded-lg p-3">
                <ChildAvatar
                  id={child.id}
                  firstName={child.first_name}
                  lastName={child.last_name}
                  size="sm"
                />
                <div>
                  <p className="font-medium text-slate-800">{child.first_name} {child.last_name}</p>
                  <p className="text-xs text-slate-500">Absent - {format(new Date(), "d MMMM yyyy")}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="font-semibold text-slate-800 mb-4">{t("recentMessages")}</h2>
        {recentMessages && recentMessages.length > 0 ? (
          <ul className="space-y-3">
            {recentMessages.map((msg) => (
              <li
                key={msg.id}
                className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg"
              >
                <span className="flex-1 text-sm text-slate-700 line-clamp-2">
                  {msg.content}
                </span>
                <span className="text-xs text-slate-400 whitespace-nowrap">
                  {new Date(msg.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">Aucun message récent</p>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "blue" | "green" | "purple";
}) {
  const colors = {
    blue: "bg-blue-50 border-blue-100 text-blue-700",
    green: "bg-emerald-50 border-emerald-100 text-emerald-700",
    purple: "bg-violet-50 border-violet-100 text-violet-700",
  };

  return (
    <div className={`rounded-xl border p-5 ${colors[color]}`}>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-sm mt-1 opacity-80">{label}</p>
    </div>
  );
}
