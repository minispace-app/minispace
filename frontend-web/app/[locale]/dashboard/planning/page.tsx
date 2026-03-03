"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { activitiesApi, menusApi } from "../../../../lib/api";
import { useAuth } from "../../../../hooks/useAuth";
import { ChevronLeft, ChevronRight, Edit2, Trash2, Plus, X, Loader2, Check, UtensilsCrossed, PartyPopper } from "lucide-react";
import { format, parse, startOfMonth, endOfMonth, addMonths, subMonths } from "date-fns";
import { fr } from "date-fns/locale";
import { TextareaField } from "../../../../components/journal/TextareaField";
import { WEEK_DAYS } from "../../../../components/journal/journalTypes";
import { getMonday, formatDate, addDays } from "../../../../components/journal/journalUtils";
import { getTodayInMontreal, formatDateInMontreal } from "../../../../lib/dateUtils";

interface DailyMenuData {
  id?: string;
  date: string;
  menu: string;
}

interface Activity {
  id: string;
  title: string;
  description?: string;
  date: string;
  capacity?: number;
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
  const [localData, setLocalData] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const weekDates = WEEK_DAYS.map((_, i) => addDays(weekStart, i));
  const weekStartStr = formatDate(weekStart);
  const today = formatDateInMontreal(getTodayInMontreal());

  const { data: menusData, mutate } = useSWR(["menus-week-planning", weekStartStr], () =>
    menusApi.getWeek(weekStartStr)
  );

  const serverMenus: DailyMenuData[] =
    (menusData as { data: DailyMenuData[] } | undefined)?.data ?? [];

  const getMenuForDate = (dateStr: string): string => {
    if (localData[dateStr] !== undefined) return localData[dateStr];
    return serverMenus.find((m) => m.date === dateStr)?.menu ?? "";
  };

  const updateMenu = (dateStr: string, value: string) => {
    setLocalData((prev) => ({ ...prev, [dateStr]: value }));
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
          Object.entries(localData).map(([dateStr, menu]) =>
            menusApi.upsert({ date: dateStr, menu })
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

      {/* Day fields */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-5">
          {weekDates.map((date, i) => {
            const dateStr = formatDate(date);
            const isToday = dateStr === today;
            const hasLocal = localData[dateStr] !== undefined;

            return (
              <div
                key={dateStr}
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
                  {tj(`days.${WEEK_DAYS[i]}`)}
                </div>
                <div
                  className={`text-sm font-medium mb-3 flex items-center gap-1.5 ${
                    isToday ? "text-amber-700" : "text-slate-700"
                  }`}
                >
                  {date.toLocaleDateString("fr-CA", { day: "numeric", month: "short" })}
                  {hasLocal && (
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
                  )}
                </div>
                <TextareaField
                  value={getMenuForDate(dateStr)}
                  onChange={(v) => updateMenu(dateStr, v)}
                  placeholder={t("placeholder")}
                  rows={5}
                />
              </div>
            );
          })}
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
  const [formData, setFormData] = useState<Partial<Activity> & { action?: string }>({});
  const [loading, setLoading] = useState(false);

  const monthStr = format(currentMonth, "yyyy-MM");

  const { data: activities = [], mutate } = useSWR(
    `activities-planning-${monthStr}`,
    () => activitiesApi.list(monthStr).then((r) => r.data.activities || [])
  );

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
      setFormData({ action: "create", date: formatDateInMontreal(getTodayInMontreal()) });
    }
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (formData.action === "create") {
        await activitiesApi.create({
          title: formData.title!,
          description: formData.description,
          date: formData.date!,
          capacity: formData.capacity,
        });
      } else if (formData.action === "edit") {
        await activitiesApi.update(formData.id!, {
          title: formData.title,
          description: formData.description,
          date: formData.date,
          capacity: formData.capacity,
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
                <h4 className="font-bold text-slate-800">{activity.title}</h4>
                {activity.description && (
                  <p className="text-slate-600 text-sm mt-1">{activity.description}</p>
                )}
                <div className="flex gap-4 mt-2 text-sm text-slate-600">
                  <span>📅 {format(parse(activity.date, "yyyy-MM-dd", new Date()), "d MMMM yyyy", { locale: fr })}</span>
                  {activity.capacity && (
                    <span>
                      👥 {activity.registration_count || 0}/{activity.capacity} {t("registered")}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex gap-2 ml-4">
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
          onSubmit={handleSubmit}
          onChange={(field, value) => setFormData({ ...formData, [field]: value })}
          onClose={() => {
            setShowForm(false);
            setFormData({});
          }}
        />
      )}
    </div>
  );
}

function ActivityFormModal({
  formData,
  loading,
  onSubmit,
  onChange,
  onClose,
}: {
  formData: Partial<Activity> & { action?: string };
  loading: boolean;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  onChange: (field: string, value: any) => void;
  onClose: () => void;
}) {
  const t = useTranslations("activities");

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

          <div className="grid grid-cols-2 gap-4">
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
              {t("common.cancel")}
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
