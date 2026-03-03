"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import useSWR, { mutate as globalMutate } from "swr";
import { childrenApi, groupsApi, attendanceApi, journalApi, activitiesApi } from "../../../../lib/api";
import { ChildAvatar, childAvatarColor } from "../../../../components/ChildAvatar";
import { Users, Pencil, Check, X, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, parseISO, getISODay, startOfWeek } from "date-fns";
import { fr, enUS } from "date-fns/locale";

interface Child {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  group_id: string | null;
  schedule_days?: number[] | null;
  start_date?: string | null;
}

interface Group {
  id: string;
  name: string;
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
  end_date?: string;
  type?: "theme" | "sortie";
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
  vacances: { bg: "bg-blue-100", text: "text-blue-600", icon: "🏖", label: "Vacances" }, // legacy display only
  present_hors_contrat: { bg: "bg-purple-100", text: "text-purple-600", icon: "✓", label: "Hors contrat" },
};

function age(birthDate: string, monthsLabel: string, yearsLabel: string) {
  const diff = Date.now() - new Date(birthDate).getTime();
  const months = Math.floor(diff / (1000 * 60 * 60 * 24 * 30));
  if (months < 24) return `${months} ${monthsLabel}`;
  return `${Math.floor(months / 12)} ${yearsLabel}`;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
        active
          ? "border-blue-600 text-blue-600"
          : "border-transparent text-slate-600 hover:text-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

function ParentJournalsSection({ child }: { child: Child }) {
  const t = useTranslations("calendar");
  const monthStr = format(new Date(), "yyyy-MM");

  const { data: weekData } = useSWR(
    `journals-week-${child.id}-${monthStr}`,
    () => journalApi.getMonthSummary(child.id, monthStr).then((r) => r.data as { journals: JournalDay[] })
  );
  const journals = weekData?.journals || [];

  if (journals.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 text-center">
        <p className="text-slate-500">Aucun journal de bord pour ce mois</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-blue-50">
          <h3 className="text-sm font-semibold text-slate-800">Journaux de bord du mois</h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {journals.map((journal) => (
              <div
                key={journal.date}
                className={`p-4 rounded-lg border-2 transition ${
                  journal.sent
                    ? 'bg-green-50 border-green-200'
                    : 'bg-yellow-50 border-yellow-200'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="font-semibold text-slate-800">
                    {format(parseISO(journal.date), "EEEE d MMMM", { locale: fr })}
                  </span>
                  <span className={`text-xs font-medium px-2 py-1 rounded ${
                    journal.sent
                      ? 'bg-green-100 text-green-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {journal.sent ? '✓ Envoyé' : '⏳ Brouillon'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
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

// ── DayDetailModal ──
// Bottom-sheet on mobile, centered modal on desktop.
// Shows: attendance, journal, activities (theme + sortie) for one day.
function DayDetailModal({
  date,
  child,
  onClose,
  monthStr,
}: {
  date: string;
  child: Child;
  onClose: () => void;
  monthStr: string;
}) {
  const t = useTranslations("calendar");
  const params = useParams();
  const locale = params.locale as string;
  const dateLocale = locale === "en" ? enUS : fr;

  const [statusLoading, setStatusLoading] = useState(false);
  const [registerLoading, setRegisterLoading] = useState<string | null>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateObj = parseISO(date);
  const isFuture = dateObj >= today;

  // SWR keys matching the calendar's keys → shared cache
  const attendanceKey = `attendance-${child.id}-${monthStr}`;
  const activitiesKey = `activities-${child.id}-${monthStr}`;
  const weekStart = format(startOfWeek(dateObj, { weekStartsOn: 1 }), "yyyy-MM-dd");
  const journalKey = `journal-${child.id}-${weekStart}`;

  const { data: attendance = {}, mutate: mutateAttendance } = useSWR(
    attendanceKey,
    () => attendanceApi.getMonth(child.id, monthStr).then((r) => r.data.attendance || {})
  );

  const { data: weekData } = useSWR(journalKey, () =>
    journalApi.getWeek(child.id, weekStart).then((r) => r.data)
  );
  const journal = weekData?.find((j: any) => j.date === date);

  const { data: activities = [], mutate: mutateActivities } = useSWR(
    activitiesKey,
    () => activitiesApi.list(monthStr, child.id).then((r) => r.data.activities || [])
  );

  // Activities for this specific day (including multi-day)
  const dayActivities: Activity[] = activities.filter((a: Activity) => {
    const end = a.end_date || a.date;
    return date >= a.date && date <= end;
  });

  const currentStatus = (attendance[date] || "present") as AttendanceStatus;

  const handleSetStatus = async (status: string) => {
    setStatusLoading(true);
    try {
      await attendanceApi.setStatus(child.id, date, status);
      mutateAttendance();
      // Also mutate the calendar's attendance key
      globalMutate(attendanceKey);
    } catch (error) {
      console.error("Error setting status:", error);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleRegister = async (activityId: string) => {
    setRegisterLoading(activityId);
    try {
      await activitiesApi.register(activityId, child.id);
      mutateActivities();
      globalMutate(activitiesKey);
    } catch (error) {
      console.error("Error registering:", error);
    } finally {
      setRegisterLoading(null);
    }
  };

  const handleUnregister = async (activityId: string) => {
    setRegisterLoading(activityId);
    try {
      await activitiesApi.unregister(activityId, child.id);
      mutateActivities();
      globalMutate(activitiesKey);
    } catch (error) {
      console.error("Error unregistering:", error);
    } finally {
      setRegisterLoading(null);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl md:rounded-xl w-full md:max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <h3 className="text-lg font-bold text-slate-800 capitalize">
            {format(dateObj, "EEEE d MMMM", { locale: dateLocale })}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* ── ATTENDANCE ── */}
          <section>
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
              {t("dayDetail.attendance")}
            </h4>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm">{ATTENDANCE_COLORS[currentStatus]?.icon}</span>
              <span className="text-sm font-medium text-slate-700">
                {ATTENDANCE_COLORS[currentStatus]?.label}
              </span>
            </div>
            {isFuture && (
              <div className="flex gap-2">
                {(["present", "absent"] as const).map((status) => {
                  const isActive = currentStatus === status;
                  const labels: Record<string, string> = {
                    present: t("dayDetail.present"),
                    absent: t("dayDetail.absent"),
                  };
                  return (
                    <button
                      key={status}
                      onClick={() => handleSetStatus(status)}
                      disabled={statusLoading}
                      className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition border ${
                        isActive
                          ? `${ATTENDANCE_COLORS[status].bg} ${ATTENDANCE_COLORS[status].text} border-current`
                          : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                      } disabled:opacity-50`}
                    >
                      {statusLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                      ) : (
                        labels[status]
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── JOURNAL ── */}
          <section>
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
              {t("dayDetail.journal")}
            </h4>
            {journal ? (
              <div className="bg-slate-50 rounded-lg p-4 space-y-2 text-sm">
                {journal.humeur && (
                  <div className="flex gap-2">
                    <span className="font-semibold text-slate-700">Humeur:</span>
                    <span className="text-slate-600">{journal.humeur}</span>
                  </div>
                )}
                {journal.appetit && (
                  <div className="flex gap-2">
                    <span className="font-semibold text-slate-700">Appétit:</span>
                    <span className="text-slate-600">{journal.appetit}</span>
                  </div>
                )}
                {journal.sommeil_minutes && (
                  <div className="flex gap-2">
                    <span className="font-semibold text-slate-700">Sommeil:</span>
                    <span className="text-slate-600">{journal.sommeil_minutes} min</span>
                  </div>
                )}
                {journal.message_educatrice && (
                  <div className="flex gap-2">
                    <span className="font-semibold text-slate-700">Message:</span>
                    <span className="text-slate-600">{journal.message_educatrice}</span>
                  </div>
                )}
                {journal.observations && (
                  <div className="flex gap-2">
                    <span className="font-semibold text-slate-700">Observations:</span>
                    <span className="text-slate-600">{journal.observations}</span>
                  </div>
                )}
                {journal.sante && (
                  <div className="flex gap-2">
                    <span className="font-semibold text-slate-700">Santé:</span>
                    <span className="text-slate-600">{journal.sante}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic">{t("dayDetail.noJournal")}</p>
            )}
          </section>

          {/* ── ACTIVITIES ── */}
          <section>
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
              {t("dayDetail.activities")}
            </h4>
            {dayActivities.length === 0 ? (
              <p className="text-sm text-slate-400 italic">{t("dayDetail.noActivities")}</p>
            ) : (
              <div className="space-y-3">
                {dayActivities.map((activity) => {
                  const isTheme = activity.type === "theme";
                  const isRegistered = activity.is_registered;
                  const isFull = activity.capacity != null && (activity.registration_count || 0) >= activity.capacity;
                  const loading = registerLoading === activity.id;

                  return (
                    <div
                      key={activity.id}
                      className={`rounded-xl border-2 p-4 ${
                        isTheme
                          ? "border-violet-200 bg-violet-50/50"
                          : "border-orange-200 bg-orange-50/50"
                      }`}
                    >
                      {/* Type badge */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-xs font-bold uppercase tracking-wide ${
                          isTheme ? "text-violet-600" : "text-orange-600"
                        }`}>
                          {isTheme ? `📚 ${t("dayDetail.theme")}` : `🚌 ${t("dayDetail.sortie")}`}
                        </span>
                        {!isTheme && activity.capacity != null && (
                          <span className="text-xs text-slate-500 ml-auto">
                            {activity.registration_count || 0}/{activity.capacity}
                          </span>
                        )}
                      </div>

                      {/* Title */}
                      <p className="font-semibold text-slate-800">{activity.title}</p>

                      {/* Date range if multi-day */}
                      {activity.end_date && activity.end_date !== activity.date && (
                        <p className="text-xs text-slate-500 mt-1">
                          {format(parseISO(activity.date), "d MMM", { locale: dateLocale })} – {format(parseISO(activity.end_date), "d MMM", { locale: dateLocale })}
                        </p>
                      )}

                      {/* Description */}
                      {activity.description && (
                        <p className="text-sm text-slate-600 mt-1">{activity.description}</p>
                      )}

                      {/* Registration button for sortie only */}
                      {!isTheme && isFuture && (
                        <div className="mt-3">
                          {isRegistered ? (
                            <button
                              onClick={() => handleUnregister(activity.id)}
                              disabled={loading}
                              className="w-full px-4 py-2.5 bg-green-100 text-green-700 border border-green-300 rounded-lg font-medium text-sm hover:bg-red-50 hover:text-red-600 hover:border-red-300 transition disabled:opacity-50"
                            >
                              {loading ? (
                                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                              ) : (
                                <>✓ {t("dayDetail.registered")} — {t("dayDetail.tapToUnregister")}</>
                              )}
                            </button>
                          ) : isFull ? (
                            <button
                              disabled
                              className="w-full px-4 py-2.5 bg-slate-100 text-slate-400 border border-slate-200 rounded-lg font-medium text-sm cursor-not-allowed"
                            >
                              {t("dayDetail.full")}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleRegister(activity.id)}
                              disabled={loading}
                              className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 transition disabled:opacity-50"
                            >
                              {loading ? (
                                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                              ) : (
                                t("dayDetail.register")
                              )}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ── ParentCalendarSection ──
function ParentCalendarSection({
  child,
  currentMonth,
  setCurrentMonth,
  dayDetailDate,
  setDayDetailDate,
}: {
  child: Child;
  currentMonth: Date;
  setCurrentMonth: (date: Date) => void;
  dayDetailDate: string | null;
  setDayDetailDate: (date: string | null) => void;
}) {
  const t = useTranslations("calendar");
  const params = useParams();
  const locale = params.locale as string;

  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  const monthStr = format(currentMonth, "yyyy-MM");

  const { data: attendance = {}, mutate: mutateAttendance } = useSWR(
    `attendance-${child.id}-${monthStr}`,
    () => attendanceApi.getMonth(child.id, monthStr).then((r) => r.data.attendance || {})
  );

  const { data: journals = [] } = useSWR(
    `journals-${child.id}-${monthStr}`,
    () => journalApi.getMonthSummary(child.id, monthStr).then((r) => r.data.journals || [])
  );

  const { data: activities = [] } = useSWR(
    `activities-${child.id}-${monthStr}`,
    () => activitiesApi.list(monthStr, child.id).then((r) => r.data.activities || [])
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const toggleDate = (dateStr: string) => {
    // Parents can only select future dates
    if (new Date(dateStr) < today) return;
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr); else next.add(dateStr);
      return next;
    });
  };

  const clearSelection = () => { setSelectedDates(new Set()); setSelectMode(false); };

  const handleBulkStatus = async (status: string) => {
    if (selectedDates.size === 0) return;
    setBulkLoading(true);
    try {
      await attendanceApi.setBulkStatus(child.id, Array.from(selectedDates), status);
      mutateAttendance();
      clearSelection();
    } finally {
      setBulkLoading(false);
    }
  };

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  const dateLocale = locale === "en" ? enUS : fr;
  const allDays = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  const days = allDays.filter((d) => getISODay(d) <= 5);
  const firstDayOffset = days.length > 0 ? getISODay(days[0]) - 1 : 0;

  const childScheduleDays: number[] = child.schedule_days ?? [1, 2, 3, 4, 5];
  const childStartDate: Date | null = child.start_date ? parseISO(child.start_date) : null;

  const isDayDisabled = (day: Date) => {
    if (childStartDate && day < childStartDate) return true;
    if (!childScheduleDays.includes(getISODay(day))) return true;
    return false;
  };

  const journalMap = journals.reduce((acc: Record<string, JournalDay>, j: JournalDay) => {
    acc[j.date] = j;
    return acc;
  }, {});

  // Multi-day aware: an activity covers a day if dateStr is between a.date and a.end_date
  const activitiesForDay = (date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    return activities.filter((a: Activity) => {
      const end = a.end_date || a.date;
      return dateStr >= a.date && dateStr <= end;
    });
  };

  return (
    <div className="space-y-4">
      {/* Desktop: Monthly Calendar */}
      <div className="hidden md:block bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-slate-800">
            {format(currentMonth, "MMMM yyyy", { locale: dateLocale })}
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => { setSelectMode(!selectMode); setSelectedDates(new Set()); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                selectMode ? "bg-blue-600 text-white border-blue-600" : "text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {selectMode ? `✓ ${selectedDates.size} sélectionné(s)` : "Sélection multiple"}
            </button>
            <button onClick={handlePrevMonth} className="p-2 hover:bg-slate-100 rounded-lg transition">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button onClick={handleNextMonth} className="p-2 hover:bg-slate-100 rounded-lg transition">
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
            const isFutureDay = day >= today;
            const dayAttendance = disabled ? "present" : (attendance[dateStr] || "present") as AttendanceStatus;
            const dayJournal = !disabled && journalMap[dateStr];
            const dayActivities = disabled ? [] : activitiesForDay(day);
            const colors = disabled ? { bg: "bg-slate-50", text: "text-slate-300", icon: null } : ATTENDANCE_COLORS[dayAttendance];
            const isToday = isSameDay(day, today);
            const isSelected = selectedDates.has(dateStr);
            const canSelect = !disabled && isFutureDay;

            const hasTheme = dayActivities.some((a: Activity) => a.type === "theme");
            const hasSortie = dayActivities.some((a: Activity) => a.type !== "theme");

            return (
              <div
                key={dateStr}
                onClick={() => {
                  if (disabled) return;
                  if (selectMode && canSelect) toggleDate(dateStr);
                  else if (!selectMode) setDayDetailDate(dateStr);
                }}
                className={`h-24 rounded-lg border-2 p-2 transition overflow-hidden flex flex-col ${
                  disabled ? "bg-slate-50 border-slate-100 cursor-not-allowed opacity-40"
                  : isSelected ? "bg-blue-100 border-blue-500 cursor-pointer ring-2 ring-blue-400/40"
                  : isToday ? `${colors.bg} border-slate-900 cursor-pointer hover:shadow-md ring-2 ring-slate-900/20`
                  : `${colors.bg} border-slate-200 cursor-pointer hover:shadow-md`
                }`}
              >
                <div className={`text-sm font-semibold ${disabled ? "text-slate-300" : "text-slate-800"} flex items-center justify-between`}>
                  {format(day, "d")}
                  <div className="flex gap-0.5 items-center">
                    {isSelected && <span className="w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">✓</span>}
                    {!isSelected && !disabled && (hasTheme || hasSortie) && (
                      <>
                        {hasTheme && <span className="w-2 h-2 rounded-full bg-violet-500" />}
                        {hasSortie && <span className="w-2 h-2 rounded-full bg-orange-500" />}
                      </>
                    )}
                  </div>
                </div>
                {!disabled && (
                  <>
                    <div className="flex items-center justify-between gap-1 mt-1">
                      <span className="text-sm">{colors.icon}</span>
                      {dayJournal && <span className="text-xs">📋</span>}
                    </div>
                    {dayActivities.length > 0 && !isSelected && (
                      <div className="text-xs mt-1 space-y-0.5 flex-1 overflow-hidden">
                        <div className="truncate text-slate-600">{dayActivities[0].title}</div>
                        {dayActivities.length > 1 && <div className="text-slate-400">+{dayActivities.length - 1}</div>}
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
          <div className="grid grid-cols-4 gap-4">
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
              <span className="w-2 h-2 rounded-full bg-violet-500" />
              <span>{t("dayDetail.theme")}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-orange-500" />
              <span>{t("dayDetail.sortie")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile: Small calendar grid */}
      <div className="md:hidden bg-white rounded-lg shadow p-4 flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <button onClick={handlePrevMonth} className="p-2 hover:bg-slate-100 rounded-lg transition">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-800">
              {format(currentMonth, "MMM yyyy", { locale: dateLocale })}
            </h2>
            <button
              onClick={() => { setSelectMode(!selectMode); setSelectedDates(new Set()); }}
              className={`px-2 py-1 rounded text-xs font-medium border transition ${
                selectMode ? "bg-blue-600 text-white border-blue-600" : "text-slate-600 border-slate-200"
              }`}
            >
              {selectMode ? `✓ ${selectedDates.size}` : "Multi"}
            </button>
          </div>
          <button onClick={handleNextMonth} className="p-2 hover:bg-slate-100 rounded-lg transition">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-5 gap-1">
            {["Lun", "Mar", "Mer", "Jeu", "Ven"].map((day) => (
              <div key={day} className="text-center font-semibold text-slate-500 py-1 text-xs">{day}</div>
            ))}
            {Array.from({ length: firstDayOffset }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {days.map((day) => {
              const dateStr = format(day, "yyyy-MM-dd");
              const disabled = isDayDisabled(day);
              const isFutureDay = day >= today;
              const dayAttendance = disabled ? "present" : (attendance[dateStr] || "present") as AttendanceStatus;
              const dayActivities = disabled ? [] : activitiesForDay(day);
              const colors = disabled ? { bg: "bg-slate-50", text: "text-slate-300", icon: null } : ATTENDANCE_COLORS[dayAttendance];
              const isToday = isSameDay(day, today);
              const isSelected = selectedDates.has(dateStr);
              const canSelect = !disabled && isFutureDay;
              const hasTheme = dayActivities.some((a: Activity) => a.type === "theme");
              const hasSortie = dayActivities.some((a: Activity) => a.type !== "theme");

              return (
                <button
                  key={dateStr}
                  onClick={() => {
                    if (disabled) return;
                    if (selectMode && canSelect) toggleDate(dateStr);
                    else if (!selectMode) setDayDetailDate(dateStr);
                  }}
                  disabled={disabled}
                  className={`aspect-square rounded p-1 transition flex flex-col items-center justify-center text-xs ${
                    disabled ? "bg-slate-50 opacity-40 cursor-not-allowed"
                    : isSelected ? "bg-blue-100 border-2 border-blue-500"
                    : isToday ? `${colors.bg} border border-slate-900 ring-1 ring-slate-900/20`
                    : `${colors.bg} hover:shadow-sm`
                  }`}
                >
                  <div className="font-semibold text-slate-800">{format(day, "d")}</div>
                  {isSelected
                    ? <span className="text-blue-600 text-[10px] font-bold">✓</span>
                    : <div className="text-xs">{colors.icon}</div>
                  }
                  {!isSelected && (hasTheme || hasSortie) && (
                    <div className="flex gap-0.5 mt-0.5">
                      {hasTheme && <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />}
                      {hasSortie && <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectMode && selectedDates.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-white rounded-xl shadow-2xl border border-slate-200 px-4 py-3 flex items-center gap-3 max-w-sm w-full mx-4">
          <span className="text-sm font-semibold text-slate-700 whitespace-nowrap">
            {selectedDates.size} jour{selectedDates.size > 1 ? "s" : ""}
          </span>
          <div className="flex gap-2 flex-1">
            {(["present", "absent"] as const).map((status) => (
              <button
                key={status}
                onClick={() => handleBulkStatus(status)}
                disabled={bulkLoading}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition ${
                  status === "present"
                    ? "bg-green-100 text-green-700 hover:bg-green-200 border-green-300"
                    : "bg-red-100 text-red-700 hover:bg-red-200 border-red-300"
                } disabled:opacity-50`}
              >
                {bulkLoading
                  ? <Loader2 className="w-3 h-3 animate-spin inline" />
                  : status === "present" ? "✓ Présent" : "✗ Absent"
                }
              </button>
            ))}
          </div>
          <button onClick={clearSelection} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Day detail modal */}
      {dayDetailDate && (
        <DayDetailModal
          date={dayDetailDate}
          child={child}
          monthStr={monthStr}
          onClose={() => setDayDetailDate(null)}
        />
      )}
    </div>
  );
}

export default function ParentChildrenPage() {
  const t = useTranslations("children");
  const [selectedChildId, setSelectedChildId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"calendar" | "profile">("calendar");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);

  // Reset to calendar tab when child changes
  useEffect(() => {
    setActiveTab("calendar");
  }, [selectedChildId]);

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
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Tab bar */}
            <div className="flex border-b border-slate-200 px-6 flex-shrink-0">
              <TabButton
                active={activeTab === "calendar"}
                onClick={() => setActiveTab("calendar")}
              >
                📅 Calendrier
              </TabButton>
              <TabButton
                active={activeTab === "profile"}
                onClick={() => setActiveTab("profile")}
              >
                👤 Profil
              </TabButton>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {activeTab === "calendar" && selectedChild && (
                <ParentCalendarSection
                  child={selectedChild}
                  currentMonth={currentMonth}
                  setCurrentMonth={setCurrentMonth}
                  dayDetailDate={dayDetailDate}
                  setDayDetailDate={setDayDetailDate}
                />
              )}
              {activeTab === "profile" && (
                <div className="space-y-4">
                  <ChildCard child={selectedChild} groupMap={groupMap} />
                  <ChildBirthDateEdit child={selectedChild} onUpdated={() => mutate()} />
                </div>
              )}
            </div>
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
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Tab bar */}
            <div className="flex border-b border-slate-200 px-4 flex-shrink-0 overflow-x-auto">
              <TabButton
                active={activeTab === "calendar"}
                onClick={() => setActiveTab("calendar")}
              >
                📅 Cal
              </TabButton>
              <TabButton
                active={activeTab === "profile"}
                onClick={() => setActiveTab("profile")}
              >
                👤 Profil
              </TabButton>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto pb-4">
              <div className="px-4 py-4 space-y-4">
                {activeTab === "calendar" && selectedChild && (
                  <ParentCalendarSection
                    child={selectedChild}
                    currentMonth={currentMonth}
                    setCurrentMonth={setCurrentMonth}
                    dayDetailDate={dayDetailDate}
                    setDayDetailDate={setDayDetailDate}
                  />
                )}
                {activeTab === "profile" && (
                  <>
                    <ChildCard child={selectedChild} groupMap={groupMap} />
                    <ChildBirthDateEdit child={selectedChild} onUpdated={() => mutate()} />
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
