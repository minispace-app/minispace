"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { childrenApi, attendanceApi, journalApi, activitiesApi } from "../../../../lib/api";
import {
  ChevronLeft, ChevronRight, Clock, CheckCircle2, XCircle, AlertCircle,
  BookOpen, PlusCircle, Minus, X, CheckSquare, Square,
} from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, parseISO, getISODay, startOfWeek } from "date-fns";
import { fr, enUS } from "date-fns/locale";
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

export default function CalendarPage() {
  const t = useTranslations("calendar");
  const params = useParams();
  const locale = params.locale as string;

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [journalModalDate, setJournalModalDate] = useState<string | null>(null);
  const [statusModalDate, setStatusModalDate] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);

  const { data: children = [] } = useSWR("children", () =>
    childrenApi.list().then((r) => r.data as any[])
  );

  useEffect(() => {
    if (children.length > 0 && !selectedChild) {
      setSelectedChild(children[0].id);
    }
  }, [children, selectedChild]);

  const monthStr = format(currentMonth, "yyyy-MM");

  const { data: attendance = {}, mutate: mutateAttendance } = useSWR(
    selectedChild ? `attendance-${selectedChild}-${monthStr}` : null,
    () => attendanceApi.getMonth(selectedChild!, monthStr).then((r) => r.data.attendance || {})
  );

  const { data: journals = [] } = useSWR(
    selectedChild ? `journals-${selectedChild}-${monthStr}` : null,
    () => journalApi.getMonthSummary(selectedChild!, monthStr).then((r) => r.data.journals || [])
  );

  const { data: activities = [] } = useSWR(
    `activities-${monthStr}`,
    () => activitiesApi.list(monthStr, selectedChild || undefined).then((r) => r.data.activities || [])
  );

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  const dateLocale = locale === "en" ? enUS : fr;
  const allDays = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  // Only weekdays (Mon=1 … Fri=5, ISO)
  const days = allDays.filter((d) => getISODay(d) <= 5);
  // Empty cells before first weekday of month (Mon=0, Tue=1, …, Fri=4)
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

  const toggleDaySelection = (dateStr: string) => {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr);
      else next.add(dateStr);
      return next;
    });
  };

  const handleBatchStatus = async (status: "present" | "absent") => {
    if (selectedDates.size === 0) return;
    setBatchLoading(true);
    try {
      for (const date of Array.from(selectedDates)) {
        await attendanceApi.setStatus(selectedChild!, date, status);
      }
      setSelectedDates(new Set());
      setSelectionMode(false);
      mutateAttendance();
    } finally {
      setBatchLoading(false);
    }
  };

  const journalMap = journals.reduce((acc: Record<string, JournalDay>, j: JournalDay) => {
    acc[j.date] = j;
    return acc;
  }, {});

  const activitiesForDay = (date: Date) =>
    activities.filter((a: Activity) => a.date === format(date, "yyyy-MM-dd"));
  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const selectedDayActivities = activitiesForDay(selectedDate);
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

        {/* Toolbar: month nav + selection mode toggle */}
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => {
              setSelectionMode((v) => !v);
              setSelectedDates(new Set());
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
              selectionMode
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {selectionMode ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            {selectionMode ? `${selectedDates.size} sélectionné${selectedDates.size > 1 ? "s" : ""}` : "Sélectionner"}
          </button>
          {selectionMode && selectedDates.size > 0 && (
            <div className="flex gap-2">
              <button
                onClick={() => handleBatchStatus("present")}
                disabled={batchLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-green-100 text-green-700 border border-green-300 hover:bg-green-200 transition disabled:opacity-50"
              >
                ✓ {batchLoading ? "..." : "Présent"}
              </button>
              <button
                onClick={() => handleBatchStatus("absent")}
                disabled={batchLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-100 text-red-700 border border-red-300 hover:bg-red-200 transition disabled:opacity-50"
              >
                ✗ {batchLoading ? "..." : "Absent"}
              </button>
            </div>
          )}
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
            const dayActivities = disabled ? [] : activitiesForDay(day);
            const colors = disabled ? { bg: "bg-slate-50", text: "text-slate-300", icon: null } : ATTENDANCE_COLORS[dayAttendance];
            const isFuture = day > today;
            const isSelected = selectedDates.has(dateStr);
            const isToday = isSameDay(day, today);

            const handleClick = () => {
              if (disabled) return;
              if (selectionMode) {
                if (isFuture) toggleDaySelection(dateStr);
                return;
              }
              if (isFuture) setStatusModalDate(dateStr);
            };

            return (
              <div
                key={dateStr}
                onClick={handleClick}
                className={`h-24 rounded-lg border-2 p-2 transition ${
                  disabled
                    ? "bg-slate-50 border-slate-100 cursor-not-allowed opacity-40"
                    : isSelected
                    ? "bg-blue-100 border-blue-400 cursor-pointer shadow-sm"
                    : isToday
                    ? `${colors.bg} border-slate-900 cursor-pointer hover:shadow-md ring-2 ring-slate-900/20`
                    : `${colors.bg} border-slate-200 cursor-pointer hover:shadow-md`
                }`}
              >
                <div className={`text-sm font-semibold ${disabled ? "text-slate-300" : "text-slate-800"} flex items-center justify-between`}>
                  {format(day, "d")}
                  {isSelected && <CheckSquare className="w-3.5 h-3.5 text-blue-600" />}
                </div>
                {!disabled && (
                  <>
                    <div className="flex items-center justify-between gap-1 mt-1">
                      <span className="text-sm">{colors.icon}</span>
                      {dayJournal && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setJournalModalDate(dateStr); }}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >📋</button>
                      )}
                    </div>
                    {dayActivities.length > 0 && (
                      <div className="text-xs mt-0.5 space-y-0.5">
                        {dayActivities.slice(0, 1).map((a: Activity) => (
                          <div key={a.id} className="bg-white/60 px-1 py-0.5 rounded text-slate-700 truncate">
                            {a.title}
                          </div>
                        ))}
                        {dayActivities.length > 1 && (
                          <div className="text-slate-500">+{dayActivities.length - 1}</div>
                        )}
                      </div>
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

        {/* Toolbar: selection mode toggle */}
        <div className="flex gap-2 mb-3 flex-shrink-0">
          <button
            onClick={() => {
              setSelectionMode((v) => !v);
              setSelectedDates(new Set());
            }}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition ${
              selectionMode
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {selectionMode ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
            {selectionMode ? `${selectedDates.size}` : "Sélectionner"}
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
              const isFuture = day > today;
              const isSelected = selectedDates.has(dateStr);

              const handleClick = () => {
                if (disabled) return;
                if (selectionMode) {
                  if (isFuture) toggleDaySelection(dateStr);
                  return;
                }
                setSelectedDate(day);
              };

              return (
                <button
                  key={dateStr}
                  onClick={handleClick}
                  className={`aspect-square rounded p-1 transition flex flex-col items-center justify-center text-xs relative ${
                    disabled
                      ? "bg-slate-50 opacity-40 cursor-not-allowed"
                      : isSelected
                      ? "bg-blue-100 border border-blue-400 cursor-pointer shadow-sm"
                      : isSameDay(day, selectedDate)
                      ? "bg-blue-50 border border-blue-300 cursor-pointer"
                      : isToday
                      ? `${colors.bg} border border-slate-900 cursor-pointer ring-1 ring-slate-900/20`
                      : `${colors.bg} cursor-pointer hover:shadow-sm`
                  }`}
                >
                  <div className="font-semibold text-slate-800">{format(day, "d")}</div>
                  <div className="flex items-center justify-between gap-1 text-xs">
                    <span>{colors.icon}</span>
                    {dayJournal && <span>📋</span>}
                  </div>
                  {isSelected && <CheckSquare className="absolute w-3 h-3 text-blue-600 bottom-0.5 right-0.5" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Batch action buttons (when in selection mode with selected days) */}
        {selectionMode && selectedDates.size > 0 && (
          <div className="flex gap-2 mb-3 flex-shrink-0">
            <button
              onClick={() => handleBatchStatus("present")}
              disabled={batchLoading}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs font-medium bg-green-100 text-green-700 border border-green-300 hover:bg-green-200 transition disabled:opacity-50"
            >
              ✓ {batchLoading ? "..." : "Présent"}
            </button>
            <button
              onClick={() => handleBatchStatus("absent")}
              disabled={batchLoading}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs font-medium bg-red-100 text-red-700 border border-red-300 hover:bg-red-200 transition disabled:opacity-50"
            >
              ✗ {batchLoading ? "..." : "Absent"}
            </button>
          </div>
        )}

        {/* Day detail panel */}
        {!selectionMode && (isSameDay(selectedDate, today) || selectedDate > today) ? (
          <div className={`mt-2 rounded-lg p-3 border border-slate-200 flex-shrink-0 ${ATTENDANCE_COLORS[selectedDayAttendance].bg}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-lg">{ATTENDANCE_COLORS[selectedDayAttendance].icon}</span>
              <span className={`text-xs font-semibold ${ATTENDANCE_COLORS[selectedDayAttendance].text}`}>
                {format(selectedDate, "EEE d MMM", { locale: dateLocale })}
              </span>
            </div>

            {selectedDate > today && (
              <button
                onClick={() => setStatusModalDate(dateStr)}
                className="w-full px-3 py-1 bg-white text-blue-600 border border-blue-300 rounded text-xs font-medium hover:bg-blue-50 transition"
              >
                {t("changeStatus")}
              </button>
            )}

            {journalMap[dateStr] && (
              <button
                onClick={() => setJournalModalDate(dateStr)}
                className="w-full mt-2 px-3 py-1 bg-white text-blue-600 border border-blue-300 rounded text-xs font-medium hover:bg-blue-50 transition flex items-center justify-center gap-1"
              >
                📋 {t("viewJournal")}
              </button>
            )}
          </div>
        ) : null}
      </div>

      {/* Status modal */}
      {statusModalDate && (
        <StatusModal
          date={statusModalDate}
          childId={selectedChild!}
          onClose={() => setStatusModalDate(null)}
          onStatusChange={() => {
            setStatusModalDate(null);
            mutateAttendance();
          }}
        />
      )}

      {/* Journal modal */}
      {journalModalDate && selectedChild && (
        <JournalModal
          date={journalModalDate}
          childId={selectedChild}
          onClose={() => setJournalModalDate(null)}
        />
      )}
      </div>
      </div>
    </div>
  );
}

function StatusModal({
  date,
  childId,
  onClose,
  onStatusChange,
}: {
  date: string;
  childId: string;
  onClose: () => void;
  onStatusChange: () => void;
}) {
  const t = useTranslations("calendar");
  const [loading, setLoading] = useState(false);

  const handleSetStatus = async (status: "present" | "absent") => {
    setLoading(true);
    try {
      await attendanceApi.setStatus(childId, date, status);
      onStatusChange();
      onClose();
    } catch (error) {
      console.error("Error setting status:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-sm w-full p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-4">{t("statusModal.title")}</h3>
        <div className="space-y-3">
          <button
            onClick={() => handleSetStatus("present")}
            disabled={loading}
            className="w-full px-4 py-2 bg-green-100 text-green-700 border border-green-300 rounded-lg hover:bg-green-200 transition font-medium disabled:opacity-50"
          >
            ✓ {t("statusModal.present")}
          </button>
          <button
            onClick={() => handleSetStatus("absent")}
            disabled={loading}
            className="w-full px-4 py-2 bg-red-100 text-red-700 border border-red-300 rounded-lg hover:bg-red-200 transition font-medium disabled:opacity-50"
          >
            ✗ Absent
          </button>
          <button
            onClick={onClose}
            disabled={loading}
            className="w-full px-4 py-2 bg-slate-100 text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-200 transition font-medium disabled:opacity-50"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

function JournalModal({
  date,
  childId,
  onClose,
}: {
  date: string;
  childId: string;
  onClose: () => void;
}) {
  const t = useTranslations("calendar");
  const weekStart = format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), "yyyy-MM-dd");

  const { data: weekData } = useSWR(`journal-${childId}-${weekStart}`, () =>
    journalApi.getWeek(childId, weekStart).then((r) => r.data)
  );

  const journal = weekData?.find((j: any) => j.date === date);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-800">{t("journalModal.title")}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {journal ? (
          <div className="space-y-4">
            {journal.humeur && (
              <div>
                <span className="font-semibold text-slate-700">Humeur:</span> {journal.humeur}
              </div>
            )}
            {journal.appetit && (
              <div>
                <span className="font-semibold text-slate-700">Appétit:</span> {journal.appetit}
              </div>
            )}
            {journal.sommeil_minutes && (
              <div>
                <span className="font-semibold text-slate-700">Sommeil:</span> {journal.sommeil_minutes} min
              </div>
            )}
            {journal.message_educatrice && (
              <div>
                <span className="font-semibold text-slate-700">Message:</span> {journal.message_educatrice}
              </div>
            )}
            {journal.observations && (
              <div>
                <span className="font-semibold text-slate-700">Observations:</span> {journal.observations}
              </div>
            )}
            {journal.sante && (
              <div>
                <span className="font-semibold text-slate-700">Santé:</span> {journal.sante}
              </div>
            )}
          </div>
        ) : (
          <p className="text-slate-600">{t("journalModal.noData")}</p>
        )}

        <button
          onClick={onClose}
          className="mt-6 w-full px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition font-medium"
        >
          {t("common.close")}
        </button>
      </div>
    </div>
  );
}

function ActivityCard({
  activity,
  selectedChild,
}: {
  activity: Activity;
  selectedChild: string;
}) {
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    setLoading(true);
    try {
      if (activity.is_registered) {
        await activitiesApi.unregister(activity.id, selectedChild);
      } else {
        await activitiesApi.register(activity.id, selectedChild);
      }
      // Trigger refresh by calling the API
      window.location.reload();
    } catch (error) {
      console.error("Error toggling registration:", error);
    } finally {
      setLoading(false);
    }
  };

  const isFull = !!(activity.capacity && activity.registration_count! >= activity.capacity);

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h4 className="font-semibold text-slate-800">{activity.title}</h4>
          {activity.description && (
            <p className="text-sm text-slate-600 mt-1">{activity.description}</p>
          )}
          {activity.capacity && (
            <p className="text-xs text-slate-500 mt-1">
              Places: {activity.registration_count}/{activity.capacity}
            </p>
          )}
        </div>
        <button
          onClick={handleRegister}
          disabled={loading || (isFull && !activity.is_registered)}
          className={`ml-2 px-3 py-1 rounded-lg transition font-medium text-sm flex items-center gap-1 ${
            activity.is_registered
              ? "bg-red-100 text-red-600 hover:bg-red-200"
              : isFull
              ? "bg-slate-200 text-slate-500 cursor-not-allowed"
              : "bg-green-100 text-green-600 hover:bg-green-200"
          } disabled:opacity-50`}
        >
          {activity.is_registered ? (
            <>
              <Minus className="w-4 h-4" />
            </>
          ) : (
            <>
              <PlusCircle className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
