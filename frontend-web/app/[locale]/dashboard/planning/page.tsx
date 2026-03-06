"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { activitiesApi, menusApi, groupsApi } from "../../../../lib/api";
import { useAuth } from "../../../../hooks/useAuth";
import { ChevronLeft, ChevronRight, Edit2, Trash2, Plus, X, Loader2, Check, UtensilsCrossed, PartyPopper } from "lucide-react";
import { format, parse, startOfMonth, endOfMonth, addMonths, subMonths, getISODay } from "date-fns";
import { fr } from "date-fns/locale";
import { TextareaField } from "../../../../components/journal/TextareaField";
import { WEEK_DAYS } from "../../../../components/journal/journalTypes";
import { getMonday, formatDate, addDays } from "../../../../components/journal/journalUtils";
import { getTodayInMontreal, formatDateInMontreal } from "../../../../lib/dateUtils";

interface DailyMenuData {
  id?: string;
  date: string;
  menu?: string;
  collation_matin?: string;
  diner?: string;
  collation_apres_midi?: string;
}

interface Activity {
  id: string;
  title: string;
  description?: string;
  date: string;
  end_date?: string;
  capacity?: number;
  group_id?: string;
  type?: "theme" | "sortie";
  registration_count?: number;
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

function MenusSection() {
  const t = useTranslations("menus");
  const tj = useTranslations("journal");

  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(getTodayInMontreal()));
  const [localData, setLocalData] = useState<Record<string, Partial<DailyMenuData>>>({});
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [activeDayIndex, setActiveDayIndex] = useState<number>(() => {
    const today = getTodayInMontreal();
    const dayOfWeek = getISODay(today); // 1=Monday, 7=Sunday
    return Math.min(Math.max(dayOfWeek - 1, 0), 4); // Clamp to 0-4
  });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const weekDates = WEEK_DAYS.map((_, i) => addDays(weekStart, i));
  const weekStartStr = formatDate(weekStart);
  const today = formatDateInMontreal(getTodayInMontreal());

  const { data: menusData, mutate } = useSWR(["menus-week-planning", weekStartStr], () =>
    menusApi.getWeek(weekStartStr)
  );

  const serverMenus: DailyMenuData[] =
    (menusData as { data: DailyMenuData[] } | undefined)?.data ?? [];

  const getMenuForDate = (dateStr: string, section: "collation_matin" | "diner" | "collation_apres_midi"): string => {
    if (localData[dateStr]?.[section] !== undefined) return localData[dateStr][section] ?? "";
    return serverMenus.find((m) => m.date === dateStr)?.[section] ?? "";
  };

  const updateMenu = (dateStr: string, section: "collation_matin" | "diner" | "collation_apres_midi", value: string) => {
    setLocalData((prev) => ({
      ...prev,
      [dateStr]: { ...prev[dateStr], [section]: value },
    }));
  };

  // Auto-save debounce
  useEffect(() => {
    if (Object.keys(localData).length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (Object.keys(localData).length === 0) return;
      setSaveStatus("saving");
      try {
        await Promise.all(
          Object.entries(localData).map(([dateStr, sections]) =>
            menusApi.upsert({
              date: dateStr,
              collation_matin: sections.collation_matin,
              diner: sections.diner,
              collation_apres_midi: sections.collation_apres_midi,
            })
          )
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
    setWeekStart(addDays(weekStart, -7));
  };

  const nextWeek = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setLocalData({});
    setSaveStatus("idle");
    setWeekStart(addDays(weekStart, 7));
  };

  function SaveIndicator() {
    if (saveStatus === "saving")
      return (
        <span className="text-xs text-slate-400 flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Enregistrement...
        </span>
      );
    if (saveStatus === "saved")
      return (
        <span className="text-xs text-green-600 flex items-center gap-1">
          <Check className="w-3 h-3" /> Enregistré
        </span>
      );
    return null;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-100 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-800">{t("title")}</h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={prevWeek}
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
            title={t("prevWeek")}
          >
            <ChevronLeft className="w-4 h-4 text-slate-600" />
          </button>
          <span className="text-sm text-slate-600 font-medium whitespace-nowrap">
            {weekStart.toLocaleDateString("fr-CA", { day: "numeric", month: "short", year: "numeric" })}
          </span>
          <button
            onClick={nextWeek}
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
            title={t("nextWeek")}
          >
            <ChevronRight className="w-4 h-4 text-slate-600" />
          </button>
        </div>

        <div className="ml-auto">
          <SaveIndicator />
        </div>
      </div>

      {/* Mobile: Day chips + single day view */}
      <div className="md:hidden flex-1 overflow-auto flex flex-col">
        {/* Day chips */}
        <div className="flex-shrink-0 px-4 py-3 border-b border-slate-100">
          <div className="flex gap-2 overflow-x-auto scrollbar-none">
            {weekDates.map((date, i) => {
              const dateStr = formatDate(date);
              const isToday = dateStr === today;
              const isActive = i === activeDayIndex;

              return (
                <button
                  key={dateStr}
                  onClick={() => setActiveDayIndex(i)}
                  className={`flex-shrink-0 px-4 py-2 rounded-full font-medium text-sm transition whitespace-nowrap ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : isToday
                      ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {tj(`days.${WEEK_DAYS[i]}`).substring(0, 3)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active day content */}
        <div className="flex-1 overflow-auto px-4 py-4">
          {(() => {
            const date = weekDates[activeDayIndex];
            const dateStr = formatDate(date);
            const isToday = dateStr === today;
            const hasLocal = localData[dateStr] !== undefined;

            return (
              <div
                className={`rounded-xl border p-4 ${
                  isToday
                    ? "border-amber-300 bg-amber-50/60"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div
                  className={`text-xs font-semibold uppercase tracking-wide mb-0.5 ${
                    isToday ? "text-amber-600" : "text-slate-500"
                  }`}
                >
                  {tj(`days.${WEEK_DAYS[activeDayIndex]}`)}
                </div>
                <div
                  className={`text-sm font-medium mb-4 flex items-center gap-1.5 ${
                    isToday ? "text-amber-700" : "text-slate-700"
                  }`}
                >
                  {date.toLocaleDateString("fr-CA", { day: "numeric", month: "short" })}
                  {hasLocal && (
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
                  )}
                </div>

                {/* 3 Menu Sections in column */}
                <div className="space-y-4">
                  {/* Collation Matin */}
                  <div className="flex flex-col">
                    <label className="text-xs font-semibold text-slate-700 mb-2">🌅 Collation matin</label>
                    <TextareaField
                      value={getMenuForDate(dateStr, "collation_matin")}
                      onChange={(v) => updateMenu(dateStr, "collation_matin", v)}
                      placeholder={t("placeholder")}
                      rows={3}
                    />
                  </div>

                  {/* Dîner */}
                  <div className="flex flex-col">
                    <label className="text-xs font-semibold text-slate-700 mb-2">🍽️ Dîner</label>
                    <TextareaField
                      value={getMenuForDate(dateStr, "diner")}
                      onChange={(v) => updateMenu(dateStr, "diner", v)}
                      placeholder={t("placeholder")}
                      rows={3}
                    />
                  </div>

                  {/* Collation Après-midi */}
                  <div className="flex flex-col">
                    <label className="text-xs font-semibold text-slate-700 mb-2">🌙 Collation après-midi</label>
                    <TextareaField
                      value={getMenuForDate(dateStr, "collation_apres_midi")}
                      onChange={(v) => updateMenu(dateStr, "collation_apres_midi", v)}
                      placeholder={t("placeholder")}
                      rows={3}
                    />
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Desktop: Inverted grid (days × sections) */}
      <div className="hidden md:flex md:flex-col flex-1 overflow-auto">
        <div className="overflow-auto flex-1">
          <div>
            {/* Grid: auto column for day headers + 3 columns for sections */}
            <div className="grid gap-1" style={{ gridTemplateColumns: "auto repeat(3, 1fr)" }}>
              {/* Header row: empty cell + section labels */}
              <div /> {/* Empty corner cell */}
              {[
                { key: "collation_matin", label: "🌅 Matin" },
                { key: "diner", label: "🍽️ Dîner" },
                { key: "collation_apres_midi", label: "🌙 Soir" },
              ].map((section) => (
                <div
                  key={`header-${section.key}`}
                  className="text-center px-2 py-2 font-semibold text-xs bg-slate-100 text-slate-700 border border-slate-200"
                >
                  {section.label}
                </div>
              ))}

              {/* Day rows */}
              {weekDates.map((date, dayIndex) => {
                const dateStr = formatDate(date);
                const isToday = dateStr === today;
                const dayLabel = tj(`days.${WEEK_DAYS[dayIndex]}`);
                const dateLabel = date.toLocaleDateString("fr-CA", { day: "numeric", month: "short" });

                return (
                  <div key={`day-${dateStr}`}>
                    {/* Day header (left side) */}
                    <div
                      className={`px-2 py-2 font-semibold text-xs border border-slate-200 ${
                        isToday
                          ? "bg-amber-100 text-amber-800"
                          : "bg-slate-50 text-slate-700"
                      }`}
                    >
                      <div>{dayLabel}</div>
                      <div className="font-normal text-xs">{dateLabel}</div>
                    </div>

                    {/* Section cells for this day */}
                    {[
                      { key: "collation_matin", label: "🌅 Matin" },
                      { key: "diner", label: "🍽️ Dîner" },
                      { key: "collation_apres_midi", label: "🌙 Soir" },
                    ].map((section) => {
                      const hasLocal = localData[dateStr] !== undefined;

                      return (
                        <div
                          key={`cell-${dateStr}-${section.key}`}
                          className={`p-1 border border-slate-200 ${
                            isToday ? "bg-amber-50" : "bg-white"
                          }`}
                        >
                          <TextareaField
                            value={getMenuForDate(dateStr, section.key as "collation_matin" | "diner" | "collation_apres_midi")}
                            onChange={(v) =>
                              updateMenu(dateStr, section.key as "collation_matin" | "diner" | "collation_apres_midi", v)
                            }
                            placeholder={t("placeholder")}
                            rows={2}
                          />
                          {hasLocal && (
                            <div className="text-xs text-orange-500 mt-0.5 font-medium">● Modifié</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivitiesSection() {
  const t = useTranslations("activities");
  const { user } = useAuth();
  const [currentMonth, setCurrentMonth] = useState(getTodayInMontreal());
  const [showForm, setShowForm] = useState(false);
  const [showRegistrations, setShowRegistrations] = useState(false);
  const [selectedActivityForRegistrations, setSelectedActivityForRegistrations] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Activity> & { action?: string }>({});
  const [loading, setLoading] = useState(false);

  const monthStr = format(currentMonth, "yyyy-MM");

  const { data: activities = [], mutate } = useSWR(
    `activities-planning-${monthStr}`,
    () => activitiesApi.list(monthStr).then((r) => r.data.activities || [])
  );

  const { data: groupsResponse } = useSWR(
    "groups-planning",
    () => groupsApi.list()
  );
  const groupsData = groupsResponse?.data || [];

  // Redirect if not admin
  if (user && user.role !== "admin_garderie") {
    return (
      <div className="p-6 text-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700 inline-block">
          <p>{t("error.unauthorized")}</p>
        </div>
      </div>
    );
  }

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  const handleOpenForm = (activity?: Activity) => {
    if (activity) {
      setFormData({ ...activity, action: "edit" });
    } else {
      setFormData({ action: "create", date: formatDateInMontreal(getTodayInMontreal()), type: "sortie" });
    }
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const isTheme = formData.type === "theme";
      const normalizedGroupId = formData.group_id && formData.group_id !== "" ? formData.group_id : undefined;
      if (formData.action === "create") {
        await activitiesApi.create({
          title: formData.title!,
          description: formData.description,
          date: formData.date!,
          end_date: formData.end_date,
          capacity: isTheme ? undefined : formData.capacity,
          group_id: normalizedGroupId,
          type: formData.type || "sortie",
        });
      } else if (formData.action === "edit") {
        await activitiesApi.update(formData.id!, {
          title: formData.title,
          description: formData.description,
          date: formData.date,
          end_date: formData.end_date,
          capacity: isTheme ? undefined : formData.capacity,
          group_id: normalizedGroupId,
          type: formData.type,
        });
      }

      mutate();
      setShowForm(false);
      setFormData({});
    } catch (error) {
      console.error("Error saving activity:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (activityId: string) => {
    if (!confirm(t("confirm.delete"))) return;

    try {
      await activitiesApi.delete(activityId);
      mutate();
    } catch (error) {
      console.error("Error deleting activity:", error);
    }
  };

  return (
    <div className="space-y-6 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-800">{t("title")}</h2>
        </div>
        <button
          onClick={() => handleOpenForm()}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium text-sm"
        >
          <Plus className="w-4 h-4" />
          {t("create")}
        </button>
      </div>

      {/* Month navigation */}
      <div className="bg-white rounded-lg shadow p-4 flex items-center justify-between">
        <button
          onClick={handlePrevMonth}
          className="p-2 hover:bg-slate-100 rounded-lg transition"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h3 className="text-lg font-semibold text-slate-800">
          {format(currentMonth, "MMMM yyyy", { locale: fr })}
        </h3>
        <button
          onClick={handleNextMonth}
          className="p-2 hover:bg-slate-100 rounded-lg transition"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Activities list */}
      {activities.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-8 text-center text-slate-600">
          {t("empty")}
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map((activity: Activity) => (
            <div
              key={activity.id}
              className="bg-white border border-slate-200 rounded-lg p-4 flex items-start justify-between hover:shadow-md transition"
            >
              <div className="flex-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <h4 className="font-bold text-slate-800">{activity.title}</h4>
                  <span className={`inline-block px-2 py-1 text-xs font-medium rounded ${
                    activity.type === "theme"
                      ? "bg-violet-100 text-violet-700"
                      : "bg-orange-100 text-orange-700"
                  }`}>
                    {activity.type === "theme" ? `📚 ${t("form.typeTheme")}` : `🚌 ${t("form.typeSortie")}`}
                  </span>
                  {activity.group_id && groupsData.find((g: any) => g.id === activity.group_id) && (
                    <span className="inline-block px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                      {groupsData.find((g: any) => g.id === activity.group_id)?.name}
                    </span>
                  )}
                </div>
                {activity.description && (
                  <p className="text-slate-600 text-sm mt-1">{activity.description}</p>
                )}
                <div className="flex gap-4 mt-2 text-sm text-slate-600 flex-wrap">
                  <span>📅 {format(parse(activity.date, "yyyy-MM-dd", new Date()), "d MMMM yyyy", { locale: fr })}
                    {activity.end_date && activity.end_date !== activity.date &&
                      ` – ${format(parse(activity.end_date, "yyyy-MM-dd", new Date()), "d MMMM yyyy", { locale: fr })}`}
                  </span>
                  {activity.capacity && (
                    <span>
                      👥 {activity.registration_count || 0}/{activity.capacity} {t("registered")}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex gap-2 ml-4">
                {activity.type !== "theme" && (
                  <button
                    onClick={() => {
                      setSelectedActivityForRegistrations(activity.id);
                      setShowRegistrations(true);
                    }}
                    className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition"
                    title={t("registrations")}
                  >
                    👥
                  </button>
                )}
                <button
                  onClick={() => handleOpenForm(activity)}
                  className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(activity.id)}
                  className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Activity form modal */}
      {showForm && (
        <ActivityFormModal
          formData={formData}
          loading={loading}
          groups={groupsData}
          onSubmit={handleSubmit}
          onChange={(field, value) => setFormData({ ...formData, [field]: value })}
          onClose={() => {
            setShowForm(false);
            setFormData({});
          }}
        />
      )}

      {/* Registrations modal */}
      {showRegistrations && selectedActivityForRegistrations && (
        <RegistrationsModal
          activityId={selectedActivityForRegistrations}
          activity={activities.find((a: Activity) => a.id === selectedActivityForRegistrations)}
          onClose={() => {
            setShowRegistrations(false);
            setSelectedActivityForRegistrations(null);
          }}
        />
      )}
    </div>
  );
}

function RegistrationsModal({
  activityId,
  activity,
  onClose,
}: {
  activityId: string;
  activity?: Activity;
  onClose: () => void;
}) {
  const t = useTranslations("activities");
  const tc = useTranslations("common");

  const { data: registrationsData = [] } = useSWR(
    activityId ? ["registrations", activityId] : null,
    () => activitiesApi.getRegistrations(activityId).then((r) => r.data?.registrations || [])
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-800">
            {t("registrations")} - {activity?.title}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2 max-h-96 overflow-y-auto">
          {registrationsData.length === 0 ? (
            <p className="text-slate-600 text-center py-4">{t("noRegistrations")}</p>
          ) : (
            <div>
              <p className="text-sm text-slate-600 mb-3">
                {registrationsData.length} {t("inscribed")} {activity?.capacity ? `/ ${activity.capacity}` : ""}
              </p>
              {registrationsData.map((reg: any) => (
                <div
                  key={reg.id}
                  className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-slate-800">
                      {reg.first_name} {reg.last_name}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-4 mt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition font-medium"
          >
            {tc("close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActivityFormModal({
  formData,
  loading,
  groups,
  onSubmit,
  onChange,
  onClose,
}: {
  formData: Partial<Activity> & { action?: string };
  loading: boolean;
  groups: any[];
  onSubmit: (e: React.FormEvent) => Promise<void>;
  onChange: (field: string, value: any) => void;
  onClose: () => void;
}) {
  const t = useTranslations("activities");
  const tc = useTranslations("common");

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-800">
            {formData.action === "create" ? t("form.create") : t("form.edit")}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {/* Type selector */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              {t("form.type")}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onChange("type", "theme")}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg border-2 transition font-medium text-sm ${
                  formData.type === "theme"
                    ? "border-violet-500 bg-violet-50 text-violet-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                📚 {t("form.typeTheme")}
              </button>
              <button
                type="button"
                onClick={() => onChange("type", "sortie")}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg border-2 transition font-medium text-sm ${
                  (formData.type || "sortie") === "sortie"
                    ? "border-orange-500 bg-orange-50 text-orange-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                🚌 {t("form.typeSortie")}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              {t("form.title")} *
            </label>
            <input
              type="text"
              value={formData.title || ""}
              onChange={(e) => onChange("title", e.target.value)}
              required
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              {t("form.description")}
            </label>
            <textarea
              value={formData.description || ""}
              onChange={(e) => onChange("description", e.target.value)}
              rows={3}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              {t("form.date")} *
            </label>
            <input
              type="date"
              value={formData.date || ""}
              onChange={(e) => onChange("date", e.target.value)}
              required
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              {t("form.endDate")}
            </label>
            <input
              type="date"
              value={formData.end_date || ""}
              onChange={(e) => onChange("end_date", e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className={`grid gap-4 ${(formData.type || "sortie") === "sortie" ? "grid-cols-2" : "grid-cols-1"}`}>
            {(formData.type || "sortie") === "sortie" && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  {t("form.capacity")}
                </label>
                <input
                  type="number"
                  min="1"
                  value={formData.capacity || ""}
                  onChange={(e) => onChange("capacity", e.target.value ? parseInt(e.target.value) : null)}
                  placeholder={t("form.capacityPlaceholder")}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                {t("form.group")}
              </label>
              <select
                value={formData.group_id || ""}
                onChange={(e) => onChange("group_id", e.target.value || null)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t("form.noGroup")}</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium disabled:opacity-50"
            >
              {loading ? t("form.saving") : t("form.save")}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition font-medium disabled:opacity-50"
            >
              {tc("cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PlanningPage() {
  const t = useTranslations("planning");
  const [activeTab, setActiveTab] = useState<"menus" | "activities">("menus");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
        <h1 className="text-base font-semibold text-slate-800">{t("title")}</h1>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-200 px-6 flex-shrink-0">
        <TabButton
          active={activeTab === "menus"}
          onClick={() => setActiveTab("menus")}
        >
          🍽️ Menu
        </TabButton>
        <TabButton
          active={activeTab === "activities"}
          onClick={() => setActiveTab("activities")}
        >
          🎉 Activités
        </TabButton>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "menus" && <MenusSection />}
        {activeTab === "activities" && <ActivitiesSection />}
      </div>
    </div>
  );
}
