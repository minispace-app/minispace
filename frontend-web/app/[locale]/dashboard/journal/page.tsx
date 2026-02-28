"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { ChevronLeft, ChevronRight, Loader2, Check, BookOpen, Clock, Send } from "lucide-react";
import { childrenApi, journalApi, menusApi, settingsApi } from "../../../../lib/api";
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

interface Child {
  id: string;
  first_name: string;
  last_name: string;
}

type FieldKey = typeof FIELD_ROWS[number];


export default function JournalDashboardPage() {
  const t = useTranslations("journal");

  const [selectedChildId, setSelectedChildId] = useState<string>("");
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [localData, setLocalData] = useState<Record<string, DayData>>({});
  const [activeDayIndex, setActiveDayIndex] = useState(() => getDefaultActiveDayIndex(getMonday(new Date())));
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sendStatus, setSendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const weekDates = WEEK_DAYS.map((_, i) => addDays(weekStart, i));
  const weekStartStr = formatDate(weekStart);
  const today = formatDate(new Date());

  const { data: settingsData } = useSWR("settings", () =>
    settingsApi.get().then((r) => r.data as { journal_auto_send_time: string })
  );
  const autoSendTime = settingsData?.journal_auto_send_time ?? "16:30";

  const { data: childrenData } = useSWR("children-list-journal", () => childrenApi.list());
  const children: Child[] = (childrenData as { data: Child[] } | undefined)?.data ?? [];

  const swrKey = selectedChildId ? ["journal-week", selectedChildId, weekStartStr] : null;
  const { data: journalData, mutate } = useSWR(swrKey, () =>
    journalApi.getWeek(selectedChildId, weekStartStr)
  );

  const serverEntries: DailyJournal[] =
    (journalData as { data: DailyJournal[] } | undefined)?.data ?? [];

  const { data: menusData } = useSWR(["menus-week-journal", weekStartStr], () =>
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
    setLocalData((prev) => ({
      ...prev,
      [dateStr]: { ...(prev[dateStr] ?? getDayData(dateStr)), [field]: value },
    }));
  };

  // Auto-save debounce
  useEffect(() => {
    if (Object.keys(localData).length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!selectedChildId || Object.keys(localData).length === 0) return;
      setSaveStatus("saving");
      try {
        await Promise.all(
          Object.entries(localData).map(([dateStr, day]) => {
            const { date: _date, ...fields } = day;
            return journalApi.upsert({ child_id: selectedChildId, date: dateStr, ...fields });
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

  const selectChild = (id: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setLocalData({});
    setSaveStatus("idle");
    setSelectedChildId(id);
  };

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

  const handleSendToParents = async () => {
    if (!selectedChildId) return;
    setSendStatus("sending");
    try {
      await journalApi.sendToParents(selectedChildId, weekStartStr);
      setSendStatus("sent");
      setTimeout(() => setSendStatus("idle"), 3000);
    } catch {
      setSendStatus("error");
      setTimeout(() => setSendStatus("idle"), 3000);
    }
  };

  const sendButton = selectedChildId ? (
    <button
      onClick={handleSendToParents}
      disabled={sendStatus === "sending"}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
        sendStatus === "sent"
          ? "bg-green-50 text-green-700 border border-green-200"
          : sendStatus === "error"
          ? "bg-red-50 text-red-700 border border-red-200"
          : "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
      }`}
    >
      {sendStatus === "sending" ? (
        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Envoi...</>
      ) : sendStatus === "sent" ? (
        <><Check className="w-3.5 h-3.5" /> Envoyé</>
      ) : sendStatus === "error" ? (
        <>Erreur</>
      ) : (
        <><Send className="w-3.5 h-3.5" /> Envoyer aux parents</>
      )}
    </button>
  ) : null;

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

  // ── Shared week nav bar (JSX variable, NOT a component)
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

  // ── Desktop content (JSX variable, NOT a component — avoids remount on every keystroke)
  const desktopContent = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-100 flex-shrink-0">
        {weekNav}
        <div className="flex items-center gap-1.5 text-xs text-slate-400 ml-2">
          <Clock className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Envoi automatique à <strong className="text-slate-600">{autoSendTime}</strong> en semaine</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {saveIndicator}
          {sendButton}
        </div>
      </div>

      {/* Grid */}
      {!selectedChildId ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
          <BookOpen className="w-12 h-12 opacity-30" />
          <p className="text-sm">{t("selectChild")}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-6 py-4">
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
              <>
                <div key={`label-${field}`} className="p-3 text-xs font-medium text-slate-500 border-b border-slate-100 flex items-start pt-4">
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
              </>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Desktop sidebar: child list ── */}
      <aside className="hidden md:flex flex-col w-64 border-r border-slate-200 bg-white flex-shrink-0">
        <div className="px-4 py-4 border-b border-slate-100">
          <h1 className="text-base font-semibold text-slate-800">{t("title")}</h1>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {children.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-400">{t("noChild")}</p>
          )}
          {children.map((child) => {
            const isActive = selectedChildId === child.id;
            return (
              <button
                key={child.id}
                onClick={() => selectChild(child.id)}
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
      <div className="hidden md:flex flex-1 flex-col min-w-0">
        {desktopContent}
      </div>

      {/* ── Mobile ── */}
      <div className="md:hidden flex flex-col h-full w-full overflow-hidden">
        {/* Mobile header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <h1 className="text-base font-semibold text-slate-800">{t("title")}</h1>
          {weekNav}
        </div>

        {/* Auto-send notice */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-slate-100 bg-slate-50 flex-shrink-0">
          <Clock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          <span className="text-xs text-slate-400">
            Envoi automatique à <strong className="text-slate-600">{autoSendTime}</strong> en semaine
          </span>
        </div>

        {/* Child chips */}
        {children.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-4 py-2.5 border-b border-slate-100 flex-shrink-0 scrollbar-none">
            {children.map((child) => {
              const isActive = selectedChildId === child.id;
              return (
                <button
                  key={child.id}
                  onClick={() => selectChild(child.id)}
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
            <BookOpen className="w-10 h-10 opacity-30" />
            <p className="text-sm">{t("selectChild")}</p>
          </div>
        ) : (
          <>
            <DayTabBar tabs={tabs} activeIndex={activeDayIndex} onSelect={setActiveDayIndex} />
            <div className="flex-1 overflow-y-auto pb-20">
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
            {/* Save indicator + send button — floating bottom */}
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-between z-20">
              <div>{saveIndicator}</div>
              {sendButton}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
