"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { childrenApi, groupsApi, attendanceApi, journalApi, activitiesApi } from "../../../../lib/api";
import { ChildAvatar, childAvatarColor } from "../../../../components/ChildAvatar";
import { Users, Pencil, Check, X, ChevronLeft, ChevronRight } from "lucide-react";
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

function ParentCalendarSection({
  child,
  currentMonth,
  setCurrentMonth,
  statusModalDate,
  setStatusModalDate,
  journalModalDate,
  setJournalModalDate,
}: {
  child: Child;
  currentMonth: Date;
  setCurrentMonth: (date: Date) => void;
  statusModalDate: string | null;
  setStatusModalDate: (date: string | null) => void;
  journalModalDate: string | null;
  setJournalModalDate: (date: string | null) => void;
}) {
  const t = useTranslations("calendar");
  const params = useParams();
  const locale = params.locale as string;

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
    `activities-${monthStr}`,
    () => activitiesApi.list(monthStr, child.id).then((r) => r.data.activities || [])
  );

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

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const journalMap = journals.reduce((acc: Record<string, JournalDay>, j: JournalDay) => {
    acc[j.date] = j;
    return acc;
  }, {});

  const activitiesForDay = (date: Date) =>
    activities.filter((a: any) => a.date === format(date, "yyyy-MM-dd"));

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
            const dayActivities = disabled ? [] : activitiesForDay(day);
            const colors = disabled ? { bg: "bg-slate-50", text: "text-slate-300", icon: null } : ATTENDANCE_COLORS[dayAttendance];
            const isToday = isSameDay(day, today);
            const isFuture = day > today;

            return (
              <div
                key={dateStr}
                onClick={() => !disabled && isFuture && setStatusModalDate(dateStr)}
                className={`h-24 rounded-lg border-2 p-2 transition overflow-hidden flex flex-col ${
                  disabled
                    ? "bg-slate-50 border-slate-100 cursor-not-allowed opacity-40"
                    : !isFuture
                    ? "bg-slate-50 border-slate-100 cursor-not-allowed"
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
                      <div className="text-xs mt-1 space-y-0.5 flex-1 overflow-y-auto">
                        {dayActivities.slice(0, 1).map((a: any) => (
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

              const handleClick = () => {
                if (disabled || !isFuture) return;
                setStatusModalDate(dateStr);
              };

              return (
                <button
                  key={dateStr}
                  onClick={handleClick}
                  disabled={disabled || !isFuture}
                  className={`aspect-square rounded p-1 transition flex flex-col items-center justify-center text-xs ${
                    disabled || !isFuture
                      ? "bg-slate-50 opacity-40 cursor-not-allowed"
                      : isToday
                      ? `${colors.bg} border border-slate-900 cursor-pointer ring-1 ring-slate-900/20`
                      : `${colors.bg} cursor-pointer hover:shadow-sm`
                  }`}
                >
                  <div className="font-semibold text-slate-800">{format(day, "d")}</div>
                  <div className="text-xs">{colors.icon}</div>
                  {dayJournal && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setJournalModalDate(dateStr); }}
                      className="text-xs hover:scale-110 transition"
                    >
                      📋
                    </button>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Status modal */}
      {statusModalDate && (
        <ParentStatusModal
          date={statusModalDate}
          childId={child.id}
          onClose={() => setStatusModalDate(null)}
          onStatusChange={() => {
            setStatusModalDate(null);
            mutateAttendance();
          }}
        />
      )}

      {/* Journal modal */}
      {journalModalDate && (
        <JournalModal
          date={journalModalDate}
          childId={child.id}
          onClose={() => setJournalModalDate(null)}
        />
      )}
    </div>
  );
}

function ParentStatusModal({
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
          Fermer
        </button>
      </div>
    </div>
  );
}

export default function ParentChildrenPage() {
  const t = useTranslations("children");
  const [selectedChildId, setSelectedChildId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"calendar" | "journals" | "profile">("calendar");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [statusModalDate, setStatusModalDate] = useState<string | null>(null);
  const [journalModalDate, setJournalModalDate] = useState<string | null>(null);

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
                active={activeTab === "journals"}
                onClick={() => setActiveTab("journals")}
              >
                📖 Journaux
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
                  statusModalDate={statusModalDate}
                  setStatusModalDate={setStatusModalDate}
                  journalModalDate={journalModalDate}
                  setJournalModalDate={setJournalModalDate}
                />
              )}
              {activeTab === "journals" && selectedChild && (
                <ParentJournalsSection child={selectedChild} />
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
                active={activeTab === "journals"}
                onClick={() => setActiveTab("journals")}
              >
                📖 Journaux
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
                    statusModalDate={statusModalDate}
                    setStatusModalDate={setStatusModalDate}
                    journalModalDate={journalModalDate}
                    setJournalModalDate={setJournalModalDate}
                  />
                )}
                {activeTab === "journals" && selectedChild && (
                  <ParentJournalsSection child={selectedChild} />
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
