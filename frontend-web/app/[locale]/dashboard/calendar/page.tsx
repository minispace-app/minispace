"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { childrenApi, attendanceApi, journalApi, activitiesApi } from "../../../../lib/api";
import {
  ChevronLeft, ChevronRight, Clock, CheckCircle2, XCircle, AlertCircle,
  BookOpen, PlusCircle, Minus, X, CheckSquare, Square,
} from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, parseISO, getISODay, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale";
import { ChildAvatar, childAvatarColor } from "../../../../components/ChildAvatar";

interface AttendanceRecord {
  date: string;
  status: string;
}

interface JournalDay {
  date: string;
  sent: boolean;
}

interface Activity {
  id: string;
  title: string;
  description?: string;
  date: string;
  capacity?: number;
  registration_count?: number;
  is_registered?: boolean;
}

type AttendanceStatus = "attendu" | "present" | "absent" | "malade" | "vacances" | "present_hors_contrat";

const ATTENDANCE_COLORS: Record<AttendanceStatus, { bg: string; text: string; icon: React.ReactNode; label: string }> = {
  attendu: { bg: "bg-gray-100", text: "text-gray-600", icon: "⏰", label: "Attendu" },
  present: { bg: "bg-green-100", text: "text-green-600", icon: "✓", label: "Présent" },
  absent: { bg: "bg-red-100", text: "text-red-600", icon: "✗", label: "Absent" },
  malade: { bg: "bg-orange-100", text: "text-orange-600", icon: "🤒", label: "Malade" },
  vacances: { bg: "bg-blue-100", text: "text-blue-600", icon: "🏖", label: "Vacances" },
  present_hors_contrat: { bg: "bg-purple-100", text: "text-purple-600", icon: "✓", label: "Hors contrat" },
};

export default function StaffCalendarPage() {
  const t = useTranslations("calendar");
  const dateLocale = fr;

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());

  const { data: children = [] } = useSWR("children", () =>
    childrenApi.list().then((r) => r.data as any[])
  );

  useEffect(() => {
    if (children.length > 0 && !selectedChild) {
      setSelectedChild(children[0].id);
    }
  }, [children, selectedChild]);

  const monthStr = format(currentMonth, "yyyy-MM");

  const { data: attendance = {} } = useSWR(
    selectedChild ? `attendance-${selectedChild}-${monthStr}` : null,
    () => attendanceApi.getMonth(selectedChild!, monthStr).then((r) => r.data.attendance || {})
  );

  const { data: journals = [] } = useSWR(
    selectedChild ? `journals-${selectedChild}-${monthStr}` : null,
    () => journalApi.getMonthSummary(selectedChild!, monthStr).then((r) => r.data.journals || [])
  );

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  const allDays = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  // Only weekdays (Mon=1 … Fri=5, ISO)
  const days = allDays.filter((d) => getISODay(d) <= 5);
  const firstDayOffset = days.length > 0 ? getISODay(days[0]) - 1 : 0;

  // Selected child schedule info
  const selectedChildData = children.find((c: any) => c.id === selectedChild);
  const childScheduleDays: number[] = selectedChildData?.schedule_days ?? [1, 2, 3, 4, 5];
  const childStartDate: Date | null = selectedChildData?.start_date ? parseISO(selectedChildData.start_date) : null;

  const isDayDisabled = (day: Date) => {
    if (childStartDate && day < childStartDate) return true;
    if (!childScheduleDays.includes(getISODay(day))) return true;
    return false;
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const journalMap = journals.reduce((acc: Record<string, JournalDay>, j: JournalDay) => {
    acc[j.date] = j;
    return acc;
  }, {});

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const selectedDayAttendance = attendance[dateStr] as AttendanceStatus | undefined || "present";

  return (
    <div className="flex h-screen bg-slate-50" style={{ height: "100dvh" }}>
      {/* ── Desktop sidebar (md+) ── */}
      {children.length > 1 && (
        <aside className="hidden md:flex w-60 bg-white border-r border-slate-200 flex-col flex-shrink-0">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800">{t("selectChild")}</h2>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {children.map((child: any) => {
              const isActive = selectedChild === child.id;
              return (
                <button
                  key={child.id}
                  onClick={() => setSelectedChild(child.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition border-l-2 ${
                    isActive ? "bg-blue-50 border-l-blue-600" : "border-l-transparent hover:bg-slate-50"
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
      )}

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile child chips (only if multiple) */}
        {children.length > 1 && (
          <div className="md:hidden flex gap-2 overflow-x-auto px-4 py-2.5 border-b border-slate-100 flex-shrink-0 scrollbar-none">
            {children.map((child: any) => {
              const isActive = selectedChild === child.id;
              return (
                <button
                  key={child.id}
                  onClick={() => setSelectedChild(child.id)}
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

        {/* Calendar content */}
        <div className="flex-1 overflow-auto p-6">
          {/* Desktop: Monthly Calendar */}
          <div className="hidden md:block bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-slate-800">
                {format(currentMonth, "MMMM yyyy", { locale: dateLocale })}
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={handlePrevMonth}
                  className="p-2 hover:bg-slate-100 rounded-lg transition"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={handleNextMonth}
                  className="p-2 hover:bg-slate-100 rounded-lg transition"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Calendar grid — Mon to Fri only */}
            <div className="grid grid-cols-5 gap-2 mb-6">
              {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => (
                <div key={day} className="text-center font-semibold text-slate-600 py-2 text-sm">
                  {t(`day_${day.toLowerCase()}`)}
                </div>
              ))}

              {Array.from({ length: firstDayOffset }).map((_, i) => (
                <div key={`empty-${i}`} className="h-24 bg-slate-50 rounded-lg" />
              ))}

              {days.map((day) => {
                const dateStr = format(day, "yyyy-MM-dd");
                const disabled = isDayDisabled(day);
                const dayAttendance = disabled ? "present" : (attendance[dateStr] || "present") as AttendanceStatus;
                const dayJournal = !disabled && journalMap[dateStr];
                const colors = disabled ? { bg: "bg-slate-50", text: "text-slate-300", icon: null } : ATTENDANCE_COLORS[dayAttendance];
                const isToday = isSameDay(day, today);

                return (
                  <div
                    key={dateStr}
                    className={`h-24 rounded-lg border-2 p-2 transition ${
                      disabled
                        ? "bg-slate-50 border-slate-100 cursor-not-allowed opacity-40"
                        : isToday
                        ? `${colors.bg} border-slate-900 cursor-pointer hover:shadow-md ring-2 ring-slate-900/20`
                        : `${colors.bg} border-slate-200 cursor-pointer hover:shadow-md`
                    }`}
                  >
                    <div className={`text-sm font-semibold ${disabled ? "text-slate-300" : "text-slate-800"} flex items-center justify-between`}>
                      {format(day, "d")}
                    </div>
                    {!disabled && (
                      <>
                        <div className="flex items-center gap-1 mt-1">
                          <span className="text-sm">{colors.icon}</span>
                        </div>
                        {dayJournal && (
                          <button className="text-xs text-blue-600 hover:text-blue-800 mt-1">📋</button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="text-xs text-slate-600 space-y-1">
              <div className="font-semibold mb-2">{t("legend")}</div>
              <div className="grid grid-cols-3 gap-4">
                {["present", "absent"].map((status) => {
                  const { icon, label } = ATTENDANCE_COLORS[status as AttendanceStatus];
                  return (
                    <div key={status} className="flex items-center gap-2">
                      <span>{icon}</span>
                      <span>{label}</span>
                    </div>
                  );
                })}
                <div className="flex items-center gap-2">
                  <span>📋</span>
                  <span>{t("hasJournal")}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Mobile: Small calendar grid */}
          <div className="md:hidden bg-white rounded-lg shadow p-4 flex flex-col h-full overflow-hidden">
            {/* Month navigation */}
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <button
                onClick={handlePrevMonth}
                className="p-2 hover:bg-slate-100 rounded-lg transition"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <h2 className="text-sm font-semibold text-slate-800">
                {format(currentMonth, "MMM yyyy", { locale: dateLocale })}
              </h2>
              <button
                onClick={handleNextMonth}
                className="p-2 hover:bg-slate-100 rounded-lg transition"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Small calendar grid */}
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-5 gap-1">
                {/* Day headers */}
                {["Lun", "Mar", "Mer", "Jeu", "Ven"].map((day) => (
                  <div key={day} className="text-center font-semibold text-slate-500 py-1 text-xs">
                    {day}
                  </div>
                ))}

                {/* Empty cells */}
                {Array.from({ length: firstDayOffset }).map((_, i) => (
                  <div key={`empty-${i}`} />
                ))}

                {/* Days */}
                {days.map((day) => {
                  const dateStr = format(day, "yyyy-MM-dd");
                  const disabled = isDayDisabled(day);
                  const dayAttendance = disabled ? "present" : (attendance[dateStr] || "present") as AttendanceStatus;
                  const dayJournal = !disabled && journalMap[dateStr];
                  const colors = disabled ? { bg: "bg-slate-50", text: "text-slate-300", icon: null } : ATTENDANCE_COLORS[dayAttendance];
                  const isToday = isSameDay(day, today);

                  return (
                    <button
                      key={dateStr}
                      className={`aspect-square rounded p-1 transition flex flex-col items-center justify-center text-xs ${
                        disabled
                          ? "bg-slate-50 opacity-40 cursor-not-allowed"
                          : isToday
                          ? `${colors.bg} border border-slate-900 cursor-pointer ring-1 ring-slate-900/20`
                          : `${colors.bg} cursor-pointer hover:shadow-sm`
                      }`}
                    >
                      <div className="font-semibold text-slate-800">{format(day, "d")}</div>
                      <div className="text-xs">{colors.icon}</div>
                      {dayJournal && <div className="text-xs">📋</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
