"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "../../../hooks/useAuth";
import useSWR from "swr";
import { groupsApi, childrenApi, messagesApi, attendanceApi } from "../../../lib/api";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, getISODay } from "date-fns";
import { fr } from "date-fns/locale";
import { AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { ChildAvatar } from "../../../components/ChildAvatar";
import { DayTabBar } from "../../../components/journal/DayTabBar";

const fetcher = (fn: () => Promise<{ data: unknown }>) => fn().then((r) => r.data);

interface Child {
  id: string;
  first_name: string;
  last_name: string;
}

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const { user } = useAuth();
  const dateLocale = fr;
  const [activeDayIndex, setActiveDayIndex] = useState(0);

  const { data: messages } = useSWR("messages", () => messagesApi.list(1, 5));
  const { data: children } = useSWR("children", () => childrenApi.list());
  const { data: groups } = useSWR("groups", () => groupsApi.list());

  const currentMonth = format(new Date(), "yyyy-MM");
  const { data: attendance } = useSWR(
    user?.role === "educateur" || user?.role === "admin_garderie" ? `attendance-${currentMonth}` : null,
    () => attendanceApi.getMonthAllChildren(currentMonth)
  );

  const recentMessages = (messages as { data: { data?: unknown[] } } | undefined)?.data as { id: string; content: string; created_at: string; message_type: string }[] | undefined;
  const childrenList = (children as { data: unknown[] } | undefined)?.data as Child[] | undefined;
  const groupsList = (groups as { data: unknown[] } | undefined)?.data as { id: string }[] | undefined;

  // Get absent children for the week
  const attendanceRecords = (attendance as { data: { attendance?: [string, string, string][] } } | undefined)?.data?.attendance || [];

  // Get this week (Monday to Friday only)
  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd }).filter(
    (d) => getISODay(d) <= 5
  );

  // Group absent children by day + calculate totals
  const absentByDay: Record<string, Child[]> = {};
  const totalByDay: Record<string, { absent: number; present: number; total: number }> = {};

  weekDays.forEach((day) => {
    const dateStr = format(day, "yyyy-MM-dd");
    const absentIds = new Set(
      attendanceRecords
        .filter(([_, date, status]) => date === dateStr && status === "absent")
        .map(([childId]) => childId)
    );
    const presentIds = new Set(
      attendanceRecords
        .filter(([_, date, status]) => date === dateStr && status === "present")
        .map(([childId]) => childId)
    );
    const absentThisDay = childrenList?.filter((child) => absentIds.has(child.id)) ?? [];
    const total = childrenList?.length ?? 0;

    if (absentThisDay.length > 0) {
      absentByDay[dateStr] = absentThisDay;
    }

    totalByDay[dateStr] = {
      absent: absentThisDay.length,
      present: presentIds.size,
      total: total,
    };
  });

  const hasAbsentThisWeek = Object.keys(absentByDay).length > 0;

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

      {/* Absent children section - Week view with summary table */}
      {(user?.role === "educateur" || user?.role === "admin_garderie") && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-8">
          <div className="flex items-center gap-2 mb-6">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <h2 className="font-semibold text-red-900">
              Récapitulatif de la semaine ({format(weekStart, "d MMM", { locale: dateLocale })} - {format(weekEnd, "d MMM", { locale: dateLocale })})
            </h2>
          </div>

          {/* Desktop: Summary table with children */}
          <div className="hidden md:block bg-white rounded-lg p-4 mb-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 font-semibold text-slate-700 w-32">Jour</th>
                  {weekDays.map((day) => (
                    <th key={format(day, "yyyy-MM-dd")} className="py-3 px-4 font-semibold text-slate-700 min-w-max">
                      <div className="text-center">
                        {format(day, "EEE", { locale: dateLocale })}
                        <div className="text-xs font-normal text-slate-500">
                          {format(day, "d MMM", { locale: dateLocale })}
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="py-4 px-4 text-left font-medium text-slate-700 w-32">Absences</td>
                  {weekDays.map((day, idx) => {
                    const dateStr = format(day, "yyyy-MM-dd");
                    const totals = totalByDay[dateStr];
                    const presentCount = (childrenList?.length ?? 0) - totals.absent;
                    const totalCount = childrenList?.length ?? 0;
                    const absentThisDay = absentByDay[dateStr] || [];

                    return (
                      <td
                        key={dateStr}
                        className="py-4 px-4 align-top"
                      >
                        <div className="space-y-2">
                          {absentThisDay.length > 0 ? (
                            <>
                              {absentThisDay.map((child) => (
                                <div
                                  key={child.id}
                                  className="flex items-center gap-2 p-2 bg-red-50 rounded-lg border border-red-100"
                                >
                                  <ChildAvatar
                                    id={child.id}
                                    firstName={child.first_name}
                                    lastName={child.last_name}
                                    size="sm"
                                  />
                                  <span className="text-xs font-medium text-red-700 truncate">
                                    {child.first_name}
                                  </span>
                                </div>
                              ))}
                              <div className="text-xs font-semibold text-slate-500 pt-2 border-t border-red-100">
                                {presentCount}/{totalCount}
                              </div>
                            </>
                          ) : (
                            <div className="text-xs font-semibold text-green-600 p-2 bg-green-50 rounded-lg border border-green-100 text-center">
                              ✓ {totalCount}/{totalCount}
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Mobile: Full screen day view */}
          <div className="md:hidden bg-white rounded-lg p-6 mb-6">
            {/* Day navigation */}
            <div className="flex items-center justify-center gap-4 mb-8">
              <button
                onClick={() => setActiveDayIndex(Math.max(0, activeDayIndex - 1))}
                disabled={activeDayIndex === 0}
                className="p-2 hover:bg-slate-100 rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-6 h-6 text-slate-600" />
              </button>

              <div className="text-center flex-1">
                {weekDays.length > 0 && activeDayIndex < weekDays.length && (() => {
                  const activeDay = weekDays[activeDayIndex];
                  return (
                    <h3 className="text-2xl font-bold text-slate-800">
                      {format(activeDay, "EEEE", { locale: dateLocale })}
                      <br />
                      <span className="text-lg font-semibold text-slate-600">
                        {format(activeDay, "d MMMM", { locale: dateLocale })}
                      </span>
                    </h3>
                  );
                })()}
              </div>

              <button
                onClick={() => setActiveDayIndex(Math.min(weekDays.length - 1, activeDayIndex + 1))}
                disabled={activeDayIndex === weekDays.length - 1}
                className="p-2 hover:bg-slate-100 rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-6 h-6 text-slate-600" />
              </button>
            </div>

            {/* Day content */}
            {weekDays.length > 0 && activeDayIndex < weekDays.length && (() => {
              const activeDay = weekDays[activeDayIndex];
              const dateStr = format(activeDay, "yyyy-MM-dd");
              const totals = totalByDay[dateStr];
              const presentCount = (childrenList?.length ?? 0) - totals.absent;
              const totalCount = childrenList?.length ?? 0;
              const absentThisDay = absentByDay[dateStr] || [];

              return (
                <div className="space-y-5">
                  {absentThisDay.length > 0 ? (
                    <>
                      <div className="space-y-4">
                        {absentThisDay.map((child) => (
                          <div
                            key={child.id}
                            className="flex items-center gap-4 p-4 bg-red-50 rounded-lg border border-red-100"
                          >
                            <ChildAvatar
                              id={child.id}
                              firstName={child.first_name}
                              lastName={child.last_name}
                              size="md"
                            />
                            <div className="flex-1">
                              <span className="text-base font-semibold text-red-700">
                                {child.first_name} {child.last_name}
                              </span>
                              <div className="text-sm text-red-600 mt-1">
                                Absent
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="text-lg font-bold text-slate-700 pt-6 border-t border-red-100 text-center py-4">
                        {presentCount}/{totalCount} présents
                      </div>
                    </>
                  ) : (
                    <div className="text-lg font-bold text-green-600 p-6 bg-green-50 rounded-lg border-2 border-green-200 text-center">
                      ✓ {totalCount}/{totalCount} présents
                    </div>
                  )}
                </div>
              );
            })()}
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
