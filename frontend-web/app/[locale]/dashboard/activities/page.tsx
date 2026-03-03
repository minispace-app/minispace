"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { activitiesApi } from "../../../../lib/api";
import { useAuth } from "../../../../hooks/useAuth";
import { ChevronLeft, ChevronRight, Edit2, Trash2, Plus, X } from "lucide-react";
import { format, parse, startOfMonth, endOfMonth, addMonths, subMonths } from "date-fns";
import { fr } from "date-fns/locale";

interface Activity {
  id: string;
  title: string;
  description?: string;
  date: string;
  capacity?: number;
  registration_count?: number;
}

export default function ActivitiesPage() {
  const t = useTranslations("activities");
  const { user } = useAuth();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<Partial<Activity> & { action?: string }>({});
  const [loading, setLoading] = useState(false);

  const monthStr = format(currentMonth, "yyyy-MM");

  const { data: activities = [], mutate } = useSWR(
    `activities-${monthStr}`,
    () => activitiesApi.list(monthStr).then((r) => r.data.activities || [])
  );

  // Redirect if not admin
  if (user && user.role !== "admin_garderie") {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700">
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
      setFormData({ action: "create", date: format(new Date(), "yyyy-MM-dd") });
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
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-slate-800">{t("title")}</h1>
        <button
          onClick={() => handleOpenForm()}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
        >
          <Plus className="w-4 h-4" />
          {t("create")}
        </button>
      </div>

      {/* Month navigation */}
      <div className="bg-white rounded-lg shadow p-4 mb-6 flex items-center justify-between">
        <button
          onClick={handlePrevMonth}
          className="p-2 hover:bg-slate-100 rounded-lg transition"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-semibold text-slate-800">
          {format(currentMonth, "MMMM yyyy", { locale: fr })}
        </h2>
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
                <h3 className="font-bold text-slate-800 text-lg">{activity.title}</h3>
                {activity.description && (
                  <p className="text-slate-600 mt-1">{activity.description}</p>
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
