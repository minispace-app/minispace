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
  menu?: string;
  collation_matin?: string;
  diner?: string;
  collation_apres_midi?: string;
}

export default function MenusPage() {
  const t = useTranslations("menus");
  const tj = useTranslations("journal");

  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [localData, setLocalData] = useState<Record<string, Partial<DailyMenuData>>>({});
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Record<string, Partial<DailyMenuData>>>({});

  const weekDates = WEEK_DAYS.map((_, i) => addDays(weekStart, i));
  const weekStartStr = formatDate(weekStart);
  const today = formatDate(new Date());

  const { data: menusData, mutate } = useSWR(["menus-week", weekStartStr], () =>
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

    // Store current localData as pending save
    pendingSaveRef.current = { ...localData };

    saveTimerRef.current = setTimeout(async () => {
      if (Object.keys(pendingSaveRef.current).length === 0) return;
      setSaveStatus("saving");
      try {
        await Promise.all(
          Object.entries(pendingSaveRef.current).map(([dateStr, sections]) =>
            menusApi.upsert({
              date: dateStr,
              collation_matin: sections.collation_matin,
              diner: sections.diner,
              collation_apres_midi: sections.collation_apres_midi,
            })
          )
        );

        // Only clear data that was actually saved, keep any new changes
        setLocalData((prev) => {
          const newData = { ...prev };
          Object.keys(pendingSaveRef.current).forEach((dateStr) => {
            delete newData[dateStr];
          });
          return newData;
        });
        pendingSaveRef.current = {};
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
      <div className="flex flex-col gap-3 px-4 md:px-6 py-3 md:py-4 flex-shrink-0 md:flex-row md:items-center">
        <div className="flex items-center gap-2">
          <UtensilsCrossed className="w-5 h-5 text-amber-600" />
          <h1 className="text-base md:text-base font-semibold text-slate-800">{t("title")}</h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={prevWeek}
            className="px-3 py-2.5 md:py-2 md:p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition active:bg-slate-100"
            title={t("prevWeek")}
          >
            <ChevronLeft className="w-4 h-4 text-slate-600" />
          </button>
          <span className="text-sm md:text-sm text-slate-600 font-medium whitespace-nowrap flex-1 text-center md:flex-none">
            {weekStart.toLocaleDateString("fr-CA", { day: "numeric", month: "short", year: "numeric" })}
          </span>
          <button
            onClick={nextWeek}
            className="px-3 py-2.5 md:py-2 md:p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition active:bg-slate-100"
            title={t("nextWeek")}
          >
            <ChevronRight className="w-4 h-4 text-slate-600" />
          </button>
        </div>

        <div className="md:ml-auto">
          <SaveIndicator />
        </div>
      </div>

      {/* Day fields */}
      <div className="flex-1 overflow-auto px-3 md:px-6 py-3 md:py-4">
        <div className="grid gap-3 md:gap-4 grid-cols-1 md:grid-cols-5">
          {weekDates.map((date, i) => {
            const dateStr = formatDate(date);
            const isToday = dateStr === today;
            const hasLocal = localData[dateStr] !== undefined;

            return (
              <div
                key={dateStr}
                className={`rounded-lg md:rounded-xl border p-3 md:p-4 ${
                  isToday
                    ? "border-amber-300 bg-amber-50/60"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div
                  className={`text-xs md:text-xs font-semibold uppercase tracking-wide mb-1 ${
                    isToday ? "text-amber-600" : "text-slate-500"
                  }`}
                >
                  {tj(`days.${WEEK_DAYS[i]}`)}
                </div>
                <div
                  className={`text-sm md:text-sm font-medium mb-3 md:mb-4 flex items-center gap-1.5 ${
                    isToday ? "text-amber-700" : "text-slate-700"
                  }`}
                >
                  {date.toLocaleDateString("fr-CA", { day: "numeric", month: "short" })}
                  {hasLocal && (
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
                  )}
                </div>
                {/* 3 Menu Sections */}
                <div className="space-y-2 md:space-y-3">
                  {/* Collation Matin */}
                  <div>
                    <label className="text-xs md:text-xs font-semibold text-slate-700 block mb-1">🌅</label>
                    <TextareaField
                      value={getMenuForDate(dateStr, "collation_matin")}
                      onChange={(v) => updateMenu(dateStr, "collation_matin", v)}
                      placeholder="Matin"
                      rows={3}
                    />
                  </div>

                  {/* Dîner */}
                  <div>
                    <label className="text-xs md:text-xs font-semibold text-slate-700 block mb-1">🍽️</label>
                    <TextareaField
                      value={getMenuForDate(dateStr, "diner")}
                      onChange={(v) => updateMenu(dateStr, "diner", v)}
                      placeholder="Midi"
                      rows={3}
                    />
                  </div>

                  {/* Collation Après-midi */}
                  <div>
                    <label className="text-xs md:text-xs font-semibold text-slate-700 block mb-1">🌙</label>
                    <TextareaField
                      value={getMenuForDate(dateStr, "collation_apres_midi")}
                      onChange={(v) => updateMenu(dateStr, "collation_apres_midi", v)}
                      placeholder="Après-midi"
                      rows={3}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
