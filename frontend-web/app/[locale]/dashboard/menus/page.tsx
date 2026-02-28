"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { ChevronLeft, ChevronRight, Loader2, Check, UtensilsCrossed } from "lucide-react";
import { menusApi } from "../../../../lib/api";
import { TextareaField } from "../../../../components/journal/TextareaField";
import { WEEK_DAYS } from "../../../../components/journal/journalTypes";
import { getMonday, formatDate, addDays } from "../../../../components/journal/journalUtils";

interface DailyMenuData {
  id?: string;
  date: string;
  menu: string;
}

export default function MenusPage() {
  const t = useTranslations("menus");
  const tj = useTranslations("journal");

  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [localData, setLocalData] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const weekDates = WEEK_DAYS.map((_, i) => addDays(weekStart, i));
  const weekStartStr = formatDate(weekStart);
  const today = formatDate(new Date());

  const { data: menusData, mutate } = useSWR(["menus-week", weekStartStr], () =>
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
          <UtensilsCrossed className="w-5 h-5 text-amber-600" />
          <h1 className="text-base font-semibold text-slate-800">{t("title")}</h1>
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
