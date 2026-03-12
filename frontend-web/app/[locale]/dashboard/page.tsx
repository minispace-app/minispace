"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "../../../hooks/useAuth";
import useSWR from "swr";
import { groupsApi, childrenApi, messagesApi, attendanceApi } from "../../../lib/api";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, getISODay, isSameDay } from "date-fns";
import { fr, enUS } from "date-fns/locale";
import { useParams } from "next/navigation";
import { AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { ChildAvatar } from "../../../components/ChildAvatar";
import { DayTabBar } from "../../../components/journal/DayTabBar";

const fetcher = (fn: () => Promise<{ data: unknown }>) => fn().then((r) => r.data);

interface Child {
  id: string;
  first_name: string;
  last_name: string;
  photo_url?: string | null;
}

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const { user } = useAuth();
  const params = useParams();
  const locale = (params?.locale as string) || "fr";
  const dateLocale = locale === "en" ? enUS : fr;

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
  const attendanceRecords = (attendance as { data: { attendance?: { child_id: string; date: string; status: string }[] } } | undefined)?.data?.attendance || [];

  // Get this week (Monday to Friday only)
  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd }).filter(
    (d) => getISODay(d) <= 5
  );

  // Initialize activeDayIndex to today's day in the week
  const getTodayIndex = () => {
    const todayStr = format(today, "yyyy-MM-dd");
    const index = weekDays.findIndex((d) => format(d, "yyyy-MM-dd") === todayStr);
    return index >= 0 ? index : 0;
  };
  const [activeDayIndex, setActiveDayIndex] = useState(() => getTodayIndex());

  // Group absent children by day + calculate totals
  const absentByDay: Record<string, Child[]> = {};
  const totalByDay: Record<string, { absent: number; present: number; total: number }> = {};

  weekDays.forEach((day) => {
    const dateStr = format(day, "yyyy-MM-dd");
    const absentIds = new Set(
      attendanceRecords
        .filter((r) => r.date === dateStr && r.status === "absent")
        .map((r) => r.child_id)
    );
    const presentIds = new Set(
      attendanceRecords
        .filter((r) => r.date === dateStr && r.status === "present")
        .map((r) => r.child_id)
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
    <div className="px-8 pb-10 pt-8">
      <h1 className="text-h1 font-bold text-ink mb-6">
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
        <div className="bg-surface-card/80 backdrop-blur-sm rounded-xl p-6 mb-8 shadow-soft">
          <div className="flex items-center gap-2 mb-6">
            <AlertCircle size={18} strokeWidth={1.5} className="text-ink-secondary" />
            <h2 className="text-h3 font-semibold text-ink">
              {t("weekPresence")} ({format(weekStart, "d MMM", { locale: dateLocale })} - {format(weekEnd, "d MMM", { locale: dateLocale })})
            </h2>
          </div>

          {/* Desktop: Summary table with children */}
          <div className="hidden md:block bg-surface-card rounded-xl p-4 mb-6 overflow-x-auto shadow-soft">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-border-soft">
                  <th className="text-left py-3 px-4 font-semibold text-ink w-32">Jour</th>
                  {weekDays.map((day) => {
                    const isToday = isSameDay(day, today);
                    return (
                      <th key={format(day, "yyyy-MM-dd")} className="py-3 px-2 font-semibold text-ink min-w-max">
                        <div className="text-center">
                          {isToday ? (
                            <div className="inline-flex flex-col items-center bg-accent-yellow/40 rounded-xl px-4 py-1.5">
                              <span className="text-caption font-bold text-ink uppercase tracking-wide">
                                {format(day, "EEE", { locale: dateLocale })}
                              </span>
                              <span className="text-caption font-semibold text-ink">
                                {format(day, "d MMM", { locale: dateLocale })}
                              </span>
                            </div>
                          ) : (
                            <>
                              <div className="text-caption font-semibold text-ink-muted uppercase tracking-wide">
                                {format(day, "EEE", { locale: dateLocale })}
                              </div>
                              <div className="text-caption font-normal text-ink-muted">
                                {format(day, "d MMM", { locale: dateLocale })}
                              </div>
                            </>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border-soft hover:bg-surface-soft transition-all duration-[180ms]">
                  <td className="py-4 px-4 text-left font-medium text-ink w-32">{t("absences")}</td>
                  {weekDays.map((day) => {
                    const dateStr = format(day, "yyyy-MM-dd");
                    const totals = totalByDay[dateStr];
                    const presentCount = (childrenList?.length ?? 0) - totals.absent;
                    const totalCount = childrenList?.length ?? 0;
                    const absentThisDay = absentByDay[dateStr] || [];
                    const isToday = isSameDay(day, today);
                    return (
                      <td
                        key={dateStr}
                        className={`py-4 px-4 align-top ${isToday ? "bg-accent-yellow/10" : ""}`}
                      >
                        <div className="space-y-2">
                          {absentThisDay.length > 0 ? (
                            <>
                              {absentThisDay.map((child) => (
                                <div
                                  key={child.id}
                                  className="flex items-center gap-2 p-2 bg-status-danger/10 rounded-lg"
                                >
                                  <ChildAvatar
                                    id={child.id}
                                    firstName={child.first_name}
                                    lastName={child.last_name}
                                    size="sm"
                                    photoUrl={child.photo_url ? `${process.env.NEXT_PUBLIC_API_URL}/media/files/${child.photo_url}` : null}
                                  />
                                  <span className="text-caption font-medium text-status-danger truncate">
                                    {child.first_name}
                                  </span>
                                </div>
                              ))}
                              <div className="text-caption font-semibold text-ink-muted pt-2 border-t border-border-soft">
                                {presentCount}/{totalCount}
                              </div>
                            </>
                          ) : (
                            <div className="text-caption font-semibold text-status-success p-2 bg-status-success/10 rounded-lg text-center">
                              {t("allPresent", { total: totalCount })}
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
          <div className="md:hidden bg-surface-card rounded-xl p-6 mb-6 shadow-soft">
            {/* Day navigation */}
            <div className="flex items-center justify-center gap-4 mb-8">
              <button
                onClick={() => setActiveDayIndex(Math.max(0, activeDayIndex - 1))}
                disabled={activeDayIndex === 0}
                className="w-9 h-9 flex items-center justify-center hover:bg-surface-soft rounded-pill transition-all duration-[180ms] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={18} strokeWidth={1.5} className="text-ink-secondary" />
              </button>

              <div className="text-center flex-1">
                {weekDays.length > 0 && activeDayIndex < weekDays.length && (() => {
                  const activeDay = weekDays[activeDayIndex];
                  return (
                    <h3 className="text-h2 font-bold text-ink">
                      {format(activeDay, "EEEE", { locale: dateLocale })}
                      <br />
                      <span className="text-h3 font-semibold text-ink-secondary">
                        {format(activeDay, "d MMMM", { locale: dateLocale })}
                      </span>
                    </h3>
                  );
                })()}
              </div>

              <button
                onClick={() => setActiveDayIndex(Math.min(weekDays.length - 1, activeDayIndex + 1))}
                disabled={activeDayIndex === weekDays.length - 1}
                className="w-9 h-9 flex items-center justify-center hover:bg-surface-soft rounded-pill transition-all duration-[180ms] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight size={18} strokeWidth={1.5} className="text-ink-secondary" />
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
                            className="flex items-center gap-4 p-4 bg-status-danger/10 rounded-xl"
                          >
                            <ChildAvatar
                              id={child.id}
                              firstName={child.first_name}
                              lastName={child.last_name}
                              size="md"
                              photoUrl={child.photo_url ? `${process.env.NEXT_PUBLIC_API_URL}/media/files/${child.photo_url}` : null}
                            />
                            <div className="flex-1">
                              <span className="text-body-lg font-semibold text-status-danger">
                                {child.first_name} {child.last_name}
                              </span>
                              <div className="text-body text-status-danger/70 mt-0.5">
                                Absent
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="text-body-lg font-bold text-ink-secondary pt-6 border-t border-border-soft text-center py-4">
                        {t("presentCount", { present: presentCount, total: totalCount })}
                      </div>
                    </>
                  ) : (
                    <div className="text-body-lg font-bold text-status-success p-6 bg-status-success/10 rounded-xl text-center">
                      {t("allPresentMobile", { total: totalCount })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

        </div>
      )}

      <div className="bg-surface-card rounded-xl p-6 shadow-card">
        <h2 className="text-h3 font-semibold text-ink mb-4">{t("recentMessages")}</h2>
        {recentMessages && recentMessages.length > 0 ? (
          <ul className="space-y-3">
            {recentMessages.map((msg) => (
              <li
                key={msg.id}
                className="flex items-start gap-3 p-3 bg-surface-soft rounded-lg hover:bg-border-soft transition-all duration-[180ms]"
              >
                <span className="flex-1 text-body text-ink line-clamp-2">
                  {msg.content}
                </span>
                <span className="text-caption text-ink-muted whitespace-nowrap">
                  {new Date(msg.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-ink-muted">Aucun message récent</p>
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
  const valueColors = {
    blue: "text-primary",
    green: "text-accent-green",
    purple: "text-accent-purple",
  };

  return (
    <div className="bg-surface-card rounded-xl p-5 shadow-card hover:shadow-hover transition-all duration-[180ms] ease-out hover:-translate-y-0.5">
      <p className={`text-display font-bold leading-none mb-1 ${valueColors[color]}`}>{value}</p>
      <p className="text-caption text-ink-muted font-medium">{label}</p>
    </div>
  );
}
