"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { childrenApi, groupsApi, usersApi, attendanceApi, journalApi, activitiesApi, menusApi, settingsApi } from "../../../../lib/api";
import { useAuth } from "../../../../hooks/useAuth";
import { Plus, ChevronDown, ChevronUp, UserPlus, X, Pencil, ChevronLeft, ChevronRight, Loader2, Check, BookOpen, Clock } from "lucide-react";
import { ChildAvatar, childAvatarColor } from "../../../../components/ChildAvatar";
import { WeatherPicker } from "../../../../components/journal/WeatherPicker";
import { EmojiPicker } from "../../../../components/journal/EmojiPicker";
import { SleepBar } from "../../../../components/journal/SleepBar";
import { TextareaField } from "../../../../components/journal/TextareaField";
import { DayTabBar } from "../../../../components/journal/DayTabBar";
import { DayFieldList } from "../../../../components/journal/DayFieldList";
import {
  DailyJournal,
  DayData,
  WEEK_DAYS,
  FIELD_ROWS,
  APPETIT_OPTIONS,
  HUMEUR_OPTIONS,
  emptyDay,
  hasDayData,
} from "../../../../components/journal/journalTypes";
import {
  getMonday,
  formatDate,
  addDays,
  getDefaultActiveDayIndex,
} from "../../../../components/journal/journalUtils";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, parseISO, getISODay } from "date-fns";
import { fr } from "date-fns/locale";

interface Child {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  group_id: string | null;
  is_active: boolean;
  start_date: string | null;
  schedule_days: number[] | null;
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

interface JournalDay {
  date: string;
  sent: boolean;
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

  const DAYS = [
    { num: 1, label: "Lun" }, { num: 2, label: "Mar" }, { num: 3, label: "Mer" },
    { num: 4, label: "Jeu" }, { num: 5, label: "Ven" },
  ];

  // Edit state
  const [firstName, setFirstName] = useState(child.first_name);
  const [lastName, setLastName] = useState(child.last_name);
  const [birthDate, setBirthDate] = useState(child.birth_date);
  const [groupId, setGroupId] = useState(child.group_id ?? "");
  const [startDate, setStartDate] = useState(child.start_date ?? "");
  const [scheduleDays, setScheduleDays] = useState<number[]>(child.schedule_days ?? [1, 2, 3, 4, 5]);
  const [savingEdit, setSavingEdit] = useState(false);

  // Update state when child changes
  useEffect(() => {
    setFirstName(child.first_name);
    setLastName(child.last_name);
    setBirthDate(child.birth_date);
    setGroupId(child.group_id ?? "");
    setStartDate(child.start_date ?? "");
    setScheduleDays(child.schedule_days ?? [1, 2, 3, 4, 5]);
  }, [child.id]);

  const toggleDay = (day: number) =>
    setScheduleDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort());

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
        start_date: startDate || undefined,
        schedule_days: scheduleDays,
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
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Date de commencement
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-2">
                Jours de présence
              </label>
              <div className="flex gap-2">
                {DAYS.map(({ num, label }) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => toggleDay(num)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition ${
                      scheduleDays.includes(num)
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-slate-400 border-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
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
                  setStartDate(child.start_date ?? "");
                  setScheduleDays(child.schedule_days ?? [1, 2, 3, 4, 5]);
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

function CalendarSection({
  child,
  currentMonth,
  setCurrentMonth,
  statusModalDate,
  setStatusModalDate,
}: {
  child: Child;
  currentMonth: Date;
  setCurrentMonth: (date: Date) => void;
  statusModalDate: string | null;
  setStatusModalDate: (date: string | null) => void;
}) {
  const t = useTranslations("calendar");

  const monthStr = format(currentMonth, "yyyy-MM");
  const { data: attendanceData, mutate: mutateAttendance } = useSWR(
    `attendance-${child.id}-${monthStr}`,
    () => attendanceApi.getMonth(child.id, monthStr).then((r) => r.data as { attendance: Record<string, string> })
  );
  const attendance = attendanceData?.attendance || {};

  const { data: journalsData } = useSWR(
    `journals-${child.id}-${monthStr}`,
    () => journalApi.getMonthSummary(child.id, monthStr).then((r) => r.data as { journals: JournalDay[] })
  );
  const journals = journalsData?.journals || [];

  const { data: activitiesData } = useSWR(
    `activities-${monthStr}`,
    () => activitiesApi.list(monthStr, child.id).then((r) => r.data as any)
  );
  const activities = activitiesData?.activities || [];

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  const allDays = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  // Only weekdays (Mon=1 … Fri=5, ISO)
  const days = allDays.filter((d) => getISODay(d) <= 5);
  const firstDayOffset = days.length > 0 ? getISODay(days[0]) - 1 : 0;

  // Child schedule info
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
            {format(currentMonth, "MMMM yyyy", { locale: fr })}
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

            return (
              <div
                key={dateStr}
                onClick={() => !disabled && setStatusModalDate(dateStr)}
                className={`h-24 rounded-lg border-2 p-2 transition overflow-hidden flex flex-col ${
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
                    <div className="flex items-center justify-between gap-1 mt-1">
                      <span className="text-sm">{colors.icon}</span>
                      {dayJournal && (
                        <button className="text-xs text-blue-600 hover:text-blue-800">📋</button>
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
      <div className="md:hidden bg-white rounded-lg shadow p-4 flex flex-col overflow-hidden">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <button
            onClick={handlePrevMonth}
            className="p-2 hover:bg-slate-100 rounded-lg transition"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-semibold text-slate-800">
            {format(currentMonth, "MMM yyyy", { locale: fr })}
          </h2>
          <button
            onClick={handleNextMonth}
            className="p-2 hover:bg-slate-100 rounded-lg transition"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Small calendar grid */}
        <div className="overflow-y-auto">
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
                  onClick={() => !disabled && setStatusModalDate(dateStr)}
                  disabled={disabled}
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

      {/* Status modal */}
      {statusModalDate && (
        <StaffStatusModal
          date={statusModalDate}
          childId={child.id}
          onClose={() => setStatusModalDate(null)}
          onStatusChange={() => {
            setStatusModalDate(null);
            mutateAttendance();
          }}
        />
      )}
    </div>
  );
}

function StaffStatusModal({
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

  const handleSetStatus = async (status: string) => {
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

  const statuses: Array<{ key: string; label: string; color: string }> = [
    { key: "present", label: "✓ Présent", color: "bg-green-100 text-green-700 border-green-300 hover:bg-green-200" },
    { key: "absent", label: "✗ Absent", color: "bg-red-100 text-red-700 border-red-300 hover:bg-red-200" },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-sm w-full p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-4">Marquer la présence</h3>
        <div className="space-y-3">
          {statuses.map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => handleSetStatus(key)}
              disabled={loading}
              className={`w-full px-4 py-2 rounded-lg font-medium border transition disabled:opacity-50 ${color}`}
            >
              {label}
            </button>
          ))}
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

function JournalsSection({
  child,
  weekStart,
  setWeekStart,
  localData,
  setLocalData,
  activeDayIndex,
  setActiveDayIndex,
  saveStatus,
  setSaveStatus,
  saveTimerRef,
}: {
  child: Child;
  weekStart: Date;
  setWeekStart: (date: Date) => void;
  localData: Record<string, DayData>;
  setLocalData: (data: Record<string, DayData>) => void;
  activeDayIndex: number;
  setActiveDayIndex: (index: number) => void;
  saveStatus: "idle" | "saving" | "saved";
  setSaveStatus: (status: "idle" | "saving" | "saved") => void;
  saveTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}) {
  const t = useTranslations("journal");

  const weekStartStr = formatDate(weekStart);
  const weekDates = WEEK_DAYS.map((_, i) => addDays(weekStart, i));
  const today = formatDate(new Date());

  const { data: settingsData } = useSWR("settings-journal", () =>
    settingsApi.get().then((r) => r.data as { journal_auto_send_time: string })
  );
  const autoSendTime = settingsData?.journal_auto_send_time ?? "16:30";

  const swrKey = child?.id ? ["journal-week-dash", child.id, weekStartStr] : null;
  const { data: journalData, mutate } = useSWR(swrKey, () =>
    journalApi.getWeek(child.id, weekStartStr)
  );

  const serverEntries: DailyJournal[] =
    (journalData as { data: DailyJournal[] } | undefined)?.data ?? [];

  const { data: menusData } = useSWR(["menus-week-journal-dash", weekStartStr], () =>
    menusApi.getWeek(weekStartStr)
  );
  interface MenuEntry { date: string; menu: string; }
  const serverMenus: MenuEntry[] =
    (menusData as { data: MenuEntry[] } | undefined)?.data ?? [];
  const getMenuForDate = (dateStr: string): string | null =>
    serverMenus.find((m) => m.date === dateStr)?.menu ?? null;

  const getDayData = useCallback(
    (dateStr: string): DayData => {
      if (localData[dateStr]) return localData[dateStr];
      const server = serverEntries.find((e) => e.date === dateStr);
      return server ?? emptyDay(dateStr);
    },
    [localData, serverEntries]
  );

  const updateField = (dateStr: string, field: keyof DayData, value: DayData[keyof DayData]) => {
    setLocalData({
      ...localData,
      [dateStr]: { ...(localData[dateStr] ?? getDayData(dateStr)), [field]: value },
    });
  };

  // Auto-save debounce
  useEffect(() => {
    if (Object.keys(localData).length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!child?.id || Object.keys(localData).length === 0) return;
      setSaveStatus("saving");
      try {
        await Promise.all(
          Object.entries(localData).map(([dateStr, day]) => {
            const { date: _date, ...fields } = day;
            return journalApi.upsert({ child_id: child.id, date: dateStr, ...fields });
          })
        );
        setLocalData({});
        mutate();
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("idle");
      }
    }, 1500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localData]);

  const prevWeek = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setLocalData({});
    setSaveStatus("idle");
    const newStart = addDays(weekStart, -7);
    setWeekStart(newStart);
    setActiveDayIndex(getDefaultActiveDayIndex(newStart));
  };

  const nextWeek = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setLocalData({});
    setSaveStatus("idle");
    const newStart = addDays(weekStart, 7);
    setWeekStart(newStart);
    setActiveDayIndex(getDefaultActiveDayIndex(newStart));
  };

  const saveIndicator =
    saveStatus === "saving" ? (
      <span className="text-xs text-slate-400 flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" /> Enregistrement...
      </span>
    ) : saveStatus === "saved" ? (
      <span className="text-xs text-green-600 flex items-center gap-1">
        <Check className="w-3 h-3" /> Enregistré
      </span>
    ) : null;

  const tabs = weekDates.map((date, i) => {
    const dateStr = formatDate(date);
    const serverEntry = serverEntries.find((e) => e.date === dateStr);
    const localEntry = localData[dateStr];
    const isAbsent = !!(localEntry ? localEntry.absent : serverEntry?.absent);
    return {
      dateStr,
      label: t(`days.${WEEK_DAYS[i]}`).slice(0, 3),
      hasData: !!serverEntry,
      hasUnsaved: !!(localEntry && hasDayData(localEntry)),
      isToday: dateStr === today,
      isAbsent,
    };
  });

  function renderField(field: FieldKey, day: DayData, dateStr: string) {
    const set = (val: DayData[keyof DayData]) => updateField(dateStr, field as keyof DayData, val);
    switch (field) {
      case "temperature": return <WeatherPicker value={day.temperature ?? null} onChange={(v) => set(v)} />;
      case "appetit":     return <EmojiPicker options={APPETIT_OPTIONS} value={day.appetit ?? null} onChange={(v) => set(v)} />;
      case "humeur":      return <EmojiPicker options={HUMEUR_OPTIONS} value={day.humeur ?? null} onChange={(v) => set(v)} />;
      case "sommeil":     return <SleepBar value={day.sommeil_minutes ?? null} onChange={(v) => updateField(dateStr, "sommeil_minutes", v)} />;
      case "menu":        return <TextareaField value={day.menu ?? ""} onChange={(v) => set(v)} placeholder={t("menuNotePlaceholder")} rows={2} />;
      case "sante":       return <TextareaField value={day.sante ?? ""} onChange={(v) => set(v)} placeholder={t("healthPlaceholder")} rows={2} />;
      case "medicaments": return <TextareaField value={day.medicaments ?? ""} onChange={(v) => set(v)} placeholder={t("medicationsPlaceholder")} rows={2} />;
      case "message_educatrice": return <TextareaField value={day.message_educatrice ?? ""} onChange={(v) => set(v)} placeholder={t("messagePlaceholder")} rows={2} />;
      case "observations": return <TextareaField value={day.observations ?? ""} onChange={(v) => set(v)} placeholder={t("observationsPlaceholder")} rows={3} />;
    }
  }

  // Week nav bar
  const weekNav = (
    <div className="flex items-center gap-2">
      <button onClick={prevWeek} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition" title={t("prevWeek")}>
        <ChevronLeft className="w-4 h-4 text-slate-600" />
      </button>
      <span className="text-sm text-slate-600 font-medium whitespace-nowrap">
        {weekStart.toLocaleDateString("fr-CA", { day: "numeric", month: "short", year: "numeric" })}
      </span>
      <button onClick={nextWeek} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition" title={t("nextWeek")}>
        <ChevronRight className="w-4 h-4 text-slate-600" />
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">
        {weekNav}
        <div className="flex items-center gap-1.5 text-xs text-slate-400 ml-2">
          <Clock className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Envoi automatique à <strong className="text-slate-600">{autoSendTime}</strong> en semaine</span>
        </div>
        <div className="ml-auto">
          {saveIndicator}
        </div>
      </div>

      {/* Desktop: Grid */}
      <div className="hidden md:block overflow-x-auto">
        <div className="grid min-w-[800px]" style={{ gridTemplateColumns: "160px repeat(5, 1fr)" }}>
          {/* Header row */}
          <div className="p-3 text-xs font-semibold text-slate-400 uppercase tracking-wide" />
          {weekDates.map((date, i) => {
            const dateStr = formatDate(date);
            const isToday = dateStr === today;
            const day = getDayData(dateStr);
            const isAbsent = !!day.absent;
            const hasUnsaved = !!(localData[dateStr] && hasDayData(localData[dateStr]));
            const menuDuJour = getMenuForDate(dateStr);
            return (
              <div key={i} className={`p-3 text-center border-b border-slate-200 ${isAbsent ? "bg-red-50" : isToday ? "bg-blue-50" : ""}`}>
                <div className={`text-xs font-semibold uppercase tracking-wide ${isAbsent ? "text-red-400" : isToday ? "text-blue-600" : "text-slate-500"}`}>
                  {t(`days.${WEEK_DAYS[i]}`)}
                </div>
                <div className={`text-sm font-medium mt-0.5 ${isAbsent ? "text-red-500" : isToday ? "text-blue-700" : "text-slate-700"}`}>
                  {date.getDate()}{" "}
                  <span className="font-normal text-slate-400">
                    {date.toLocaleDateString("fr-CA", { month: "short" })}
                  </span>
                </div>
                {isAbsent ? (
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 mx-auto mt-1" />
                ) : hasUnsaved ? (
                  <div className="w-1.5 h-1.5 rounded-full bg-orange-400 mx-auto mt-1" />
                ) : isToday ? (
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mx-auto mt-1" />
                ) : null}
                {menuDuJour && (
                  <div className="mt-1.5 flex items-center gap-1 text-xs text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 max-w-full overflow-hidden" title={menuDuJour}>
                    <span className="flex-shrink-0">🍽</span>
                    <span className="truncate">{menuDuJour}</span>
                  </div>
                )}
              </div>
            );
          })}

          {/* Absent toggle row */}
          <div className="p-3 text-xs font-medium text-slate-500 border-b border-slate-100 flex items-center pt-4 gap-1.5">
            Absent
          </div>
          {weekDates.map((date, di) => {
            const dateStr = formatDate(date);
            const day = getDayData(dateStr);
            const isAbsent = !!day.absent;
            const isToday = dateStr === today;
            return (
              <div key={`absent-${di}`} className={`p-2 border-b border-slate-100 border-l border-l-slate-50 flex items-center justify-center ${isAbsent ? "bg-red-50" : isToday ? "bg-blue-50/40" : ""}`}>
                <button
                  type="button"
                  onClick={() => updateField(dateStr, "absent" as keyof DayData, !isAbsent)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${isAbsent ? "bg-red-500" : "bg-slate-200"}`}
                >
                  <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${isAbsent ? "translate-x-5" : "translate-x-1"}`} />
                </button>
              </div>
            );
          })}

          {/* Field rows */}
          {FIELD_ROWS.map((field) => (
            <div key={`field-${field}`} className="contents">
              <div className="p-3 text-xs font-medium text-slate-500 border-b border-slate-100 flex items-start pt-4">
                {t(`fields.${field === "sommeil" ? "sommeil" : field}`)}
              </div>
              {weekDates.map((date, di) => {
                const dateStr = formatDate(date);
                const day = getDayData(dateStr);
                const isAbsent = !!day.absent;
                const isToday = dateStr === today;
                return (
                  <div key={`${field}-${di}`} className={`p-2 border-b border-slate-100 border-l border-l-slate-50 ${isAbsent ? "bg-red-50/40 opacity-30 pointer-events-none select-none" : isToday ? "bg-blue-50/40" : ""}`}>
                    {renderField(field, day, dateStr)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile: Day tabs */}
      <div className="md:hidden space-y-2">
        <DayTabBar tabs={tabs} activeIndex={activeDayIndex} onSelect={setActiveDayIndex} />
        <div className="space-y-4">
          <DayFieldList
            day={getDayData(formatDate(weekDates[activeDayIndex]))}
            menuDuJour={getMenuForDate(formatDate(weekDates[activeDayIndex]))}
            readOnly={false}
            onFieldChange={(field, value) =>
              updateField(formatDate(weekDates[activeDayIndex]), field as keyof DayData, value as DayData[keyof DayData])
            }
            appetitOptions={APPETIT_OPTIONS}
            humeurOptions={HUMEUR_OPTIONS}
            placeholders={{
              menu: t("menuNotePlaceholder"),
              sante: t("healthPlaceholder"),
              medicaments: t("medicationsPlaceholder"),
              message_educatrice: t("messagePlaceholder"),
              observations: t("observationsPlaceholder"),
            }}
          />
        </div>
        {/* Save indicator */}
        <div className="pt-4 flex justify-center">
          {saveIndicator}
        </div>
      </div>
    </div>
  );
}

type FieldKey = typeof FIELD_ROWS[number];

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
  const [activeTab, setActiveTab] = useState<"calendar" | "journals" | "profile">("calendar");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [statusModalDate, setStatusModalDate] = useState<string | null>(null);
  // Journal tab state
  const [journalWeekStart, setJournalWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [journalLocalData, setJournalLocalData] = useState<Record<string, DayData>>({});
  const [journalActiveDayIndex, setJournalActiveDayIndex] = useState(() => getDefaultActiveDayIndex(getMonday(new Date())));
  const [journalSaveStatus, setJournalSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const journalSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const CREATE_DAYS = [
    { num: 1, label: "Lun" }, { num: 2, label: "Mar" }, { num: 3, label: "Mer" },
    { num: 4, label: "Jeu" }, { num: 5, label: "Ven" },
  ];
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    birth_date: "",
    group_id: "",
    notes: "",
    start_date: "",
    schedule_days: [1, 2, 3, 4, 5] as number[],
  });
  const [saving, setSaving] = useState(false);

  const toggleCreateDay = (day: number) =>
    setForm((p) => ({
      ...p,
      schedule_days: p.schedule_days.includes(day)
        ? p.schedule_days.filter((d) => d !== day)
        : [...p.schedule_days, day].sort(),
    }));

  // Reset journal state when child changes (but keep activeTab)
  useEffect(() => {
    setJournalWeekStart(getMonday(new Date()));
    setJournalLocalData({});
    setJournalActiveDayIndex(getDefaultActiveDayIndex(getMonday(new Date())));
    setJournalSaveStatus("idle");
    if (journalSaveTimerRef.current) clearTimeout(journalSaveTimerRef.current);
  }, [selectedChildId]);

  const { data, mutate } = useSWR("children-list", () => childrenApi.list());

  // Auto-select first child when list loads
  useEffect(() => {
    const childrenList: Child[] = (data as { data: Child[] } | undefined)?.data ?? [];
    if (childrenList.length > 0 && !selectedChildId) {
      setSelectedChildId(childrenList[0].id);
    }
  }, [data, selectedChildId]);
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
        start_date: form.start_date || undefined,
        schedule_days: form.schedule_days,
      });
      setForm({ first_name: "", last_name: "", birth_date: "", group_id: "", notes: "", start_date: "", schedule_days: [1, 2, 3, 4, 5] });
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
                <CalendarSection
                  child={selectedChild}
                  currentMonth={currentMonth}
                  setCurrentMonth={setCurrentMonth}
                  statusModalDate={statusModalDate}
                  setStatusModalDate={setStatusModalDate}
                />
              )}
              {activeTab === "journals" && selectedChild && (
                <JournalsSection
                  child={selectedChild}
                  weekStart={journalWeekStart}
                  setWeekStart={setJournalWeekStart}
                  localData={journalLocalData}
                  setLocalData={setJournalLocalData}
                  activeDayIndex={journalActiveDayIndex}
                  setActiveDayIndex={setJournalActiveDayIndex}
                  saveStatus={journalSaveStatus}
                  setSaveStatus={setJournalSaveStatus}
                  saveTimerRef={journalSaveTimerRef}
                />
              )}
              {activeTab === "profile" && (
                <div className="space-y-4">
                  <ChildCard child={selectedChild} groupMap={groupMap} />
                  <ChildDetails
                    child={selectedChild}
                    groups={groups}
                    groupMap={groupMap}
                    onUpdated={() => mutate()}
                    canWrite={canWrite}
                  />
                </div>
              )}
            </div>
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
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Tab bar */}
            <div className="flex border-b border-slate-200 px-4 flex-shrink-0">
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
                  <CalendarSection
                    child={selectedChild}
                    currentMonth={currentMonth}
                    setCurrentMonth={setCurrentMonth}
                    statusModalDate={statusModalDate}
                    setStatusModalDate={setStatusModalDate}
                  />
                )}
                {activeTab === "journals" && selectedChild && (
                  <JournalsSection
                    child={selectedChild}
                    weekStart={journalWeekStart}
                    setWeekStart={setJournalWeekStart}
                    localData={journalLocalData}
                    setLocalData={setJournalLocalData}
                    activeDayIndex={journalActiveDayIndex}
                    setActiveDayIndex={setJournalActiveDayIndex}
                    saveStatus={journalSaveStatus}
                    setSaveStatus={setJournalSaveStatus}
                    saveTimerRef={journalSaveTimerRef}
                  />
                )}
                {activeTab === "profile" && (
                  <>
                    <ChildCard child={selectedChild} groupMap={groupMap} />
                    <ChildDetails
                      child={selectedChild}
                      groups={groups}
                      groupMap={groupMap}
                      onUpdated={() => mutate()}
                      canWrite={canWrite}
                    />
                  </>
                )}
              </div>
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
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Date de commencement <span className="font-normal text-slate-400">({tc("optional")})</span>
                </label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-2">
                  Jours de présence
                </label>
                <div className="flex gap-2">
                  {CREATE_DAYS.map(({ num, label }) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => toggleCreateDay(num)}
                      className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition ${
                        form.schedule_days.includes(num)
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-400 border-slate-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
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
