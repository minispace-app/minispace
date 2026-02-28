"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { ChevronLeft, ChevronRight, BookOpen } from "lucide-react";
import { childrenApi, journalApi, menusApi } from "../../../../lib/api";
import { ChildAvatar, childAvatarColor } from "../../../../components/ChildAvatar";
import { WeatherPicker } from "../../../../components/journal/WeatherPicker";
import { EmojiPicker } from "../../../../components/journal/EmojiPicker";
import { SleepBar } from "../../../../components/journal/SleepBar";
import { TextareaField } from "../../../../components/journal/TextareaField";
import { DayTabBar } from "../../../../components/journal/DayTabBar";
import { DayFieldList } from "../../../../components/journal/DayFieldList";
import {
  DailyJournal,
  WEEK_DAYS,
  FIELD_ROWS,
  APPETIT_OPTIONS,
  HUMEUR_OPTIONS,
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


function emptyEntry(date: string): DailyJournal {
  return { child_id: "", date, temperature: null, menu: null, appetit: null, humeur: null, sommeil_minutes: null, sante: null, medicaments: null, message_educatrice: null, observations: null };
}

function renderReadOnlyField(field: FieldKey, day: DailyJournal) {
  switch (field) {
    case "temperature":        return <WeatherPicker value={day.temperature ?? null} readOnly />;
    case "appetit":            return <EmojiPicker options={APPETIT_OPTIONS} value={day.appetit ?? null} readOnly />;
    case "humeur":             return <EmojiPicker options={HUMEUR_OPTIONS} value={day.humeur ?? null} readOnly />;
    case "sommeil":            return <SleepBar value={day.sommeil_minutes ?? null} readOnly />;
    case "menu":               return <TextareaField value={day.menu ?? ""} readOnly />;
    case "sante":              return <TextareaField value={day.sante ?? ""} readOnly />;
    case "medicaments":        return <TextareaField value={day.medicaments ?? ""} readOnly />;
    case "message_educatrice": return <TextareaField value={day.message_educatrice ?? ""} readOnly />;
    case "observations":       return <TextareaField value={day.observations ?? ""} readOnly rows={3} />;
  }
}

export default function ParentJournalPage() {
  const t = useTranslations("journal");

  const [selectedChildId, setSelectedChildId] = useState<string>("");
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [activeDayIndex, setActiveDayIndex] = useState(() => getDefaultActiveDayIndex(getMonday(new Date())));

  const weekDates = WEEK_DAYS.map((_, i) => addDays(weekStart, i));
  const weekStartStr = formatDate(weekStart);
  const today = formatDate(new Date());

  const { data: childrenData } = useSWR("children-list-parent-journal", () => childrenApi.list());
  const children: Child[] = (childrenData as { data: Child[] } | undefined)?.data ?? [];

  const effectiveChildId = selectedChildId || (children.length > 0 ? children[0].id : "");

  const swrKey = effectiveChildId ? ["journal-week", effectiveChildId, weekStartStr] : null;
  const { data: journalData } = useSWR(swrKey, () =>
    journalApi.getWeek(effectiveChildId, weekStartStr)
  );

  const serverEntries: DailyJournal[] =
    (journalData as { data: DailyJournal[] } | undefined)?.data ?? [];

  const { data: menusData } = useSWR(["menus-week-parent", weekStartStr], () =>
    menusApi.getWeek(weekStartStr)
  );
  interface MenuEntry { date: string; menu: string; }
  const serverMenus: MenuEntry[] =
    (menusData as { data: MenuEntry[] } | undefined)?.data ?? [];
  const getMenuForDate = (dateStr: string): string | null =>
    serverMenus.find((m) => m.date === dateStr)?.menu ?? null;

  const getDayData = (dateStr: string): DailyJournal =>
    serverEntries.find((e) => e.date === dateStr) ?? emptyEntry(dateStr);

  const prevWeek = () => {
    const newStart = addDays(weekStart, -7);
    setWeekStart(newStart);
    setActiveDayIndex(getDefaultActiveDayIndex(newStart));
  };

  const nextWeek = () => {
    const newStart = addDays(weekStart, 7);
    setWeekStart(newStart);
    setActiveDayIndex(getDefaultActiveDayIndex(newStart));
  };

  const tabs = weekDates.map((date, i) => {
    const dateStr = formatDate(date);
    const serverEntry = serverEntries.find((e) => e.date === dateStr);
    return {
      dateStr,
      label: t(`days.${WEEK_DAYS[i]}`).slice(0, 3),
      hasData: !!serverEntry,
      hasUnsaved: false,
      isToday: dateStr === today,
      isAbsent: !!serverEntry?.absent,
    };
  });

  // ── Shared week nav ────────────────────────────────────────────────────────
  const WeekNav = () => (
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

  // ── Desktop content ────────────────────────────────────────────────────────
  const DesktopContent = () => (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-100 flex-shrink-0">
        <WeekNav />
      </div>

      {!effectiveChildId ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
          <BookOpen className="w-12 h-12 opacity-30" />
          <p className="text-sm">{t("noChild")}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto px-6 py-4">
          <div className="grid min-w-[600px]" style={{ gridTemplateColumns: "160px repeat(5, 1fr)" }}>
            <div className="p-3" />
            {weekDates.map((date, i) => {
              const dateStr = formatDate(date);
              const isToday = dateStr === today;
              const isAbsent = !!getDayData(dateStr).absent;
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
                    <div key={`${field}-${di}`} className={`p-2 border-b border-slate-100 border-l border-l-slate-50 ${isAbsent ? "bg-red-50/40 opacity-30" : isToday ? "bg-blue-50/40" : ""}`}>
                      {renderReadOnlyField(field, day)}
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
      {/* ── Desktop sidebar: child list (only if multiple children) ── */}
      {children.length > 1 && (
        <aside className="hidden md:flex flex-col w-64 border-r border-slate-200 bg-white flex-shrink-0">
          <div className="px-4 py-4 border-b border-slate-100">
            <h1 className="text-base font-semibold text-slate-800">{t("title")}</h1>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {children.map((child) => {
              const isActive = effectiveChildId === child.id;
              return (
                <button
                  key={child.id}
                  onClick={() => setSelectedChildId(child.id)}
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

      {/* ── Desktop main content ── */}
      <div className="hidden md:flex flex-1 flex-col min-w-0">
        {/* Title when no sidebar */}
        {children.length <= 1 && (
          <div className="px-6 py-4 border-b border-slate-100 flex-shrink-0">
            <h1 className="text-base font-semibold text-slate-800">{t("title")}</h1>
          </div>
        )}
        <DesktopContent />
      </div>

      {/* ── Mobile ── */}
      <div className="md:hidden flex flex-col h-full w-full overflow-hidden">
        {/* Mobile header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <h1 className="text-base font-semibold text-slate-800">{t("title")}</h1>
          <WeekNav />
        </div>

        {/* Child chips (only if multiple) */}
        {children.length > 1 && (
          <div className="flex gap-2 overflow-x-auto px-4 py-2.5 border-b border-slate-100 flex-shrink-0 scrollbar-none">
            {children.map((child) => {
              const isActive = effectiveChildId === child.id;
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

        {!effectiveChildId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
            <BookOpen className="w-10 h-10 opacity-30" />
            <p className="text-sm">{t("noChild")}</p>
          </div>
        ) : (
          <>
            <DayTabBar tabs={tabs} activeIndex={activeDayIndex} onSelect={setActiveDayIndex} />
            <div className="flex-1 overflow-y-auto pb-6">
              {(() => {
                const dayEntry = getDayData(formatDate(weekDates[activeDayIndex]));
                if (dayEntry.absent) {
                  return (
                    <div className="flex flex-col items-center py-12 text-red-400">
                      <span className="text-4xl mb-3">🏠</span>
                      <p className="text-sm font-medium text-red-500">Enfant absent ce jour</p>
                    </div>
                  );
                }
                if (!hasDayData(dayEntry)) {
                  return (
                    <div className="flex flex-col items-center py-12 text-slate-400">
                      <BookOpen className="w-10 h-10 mb-3 opacity-40" />
                      <p className="text-sm">{t("noEntryForDay")}</p>
                    </div>
                  );
                }
                return (
                  <DayFieldList
                    day={dayEntry}
                    menuDuJour={getMenuForDate(formatDate(weekDates[activeDayIndex]))}
                    readOnly={true}
                    appetitOptions={APPETIT_OPTIONS}
                    humeurOptions={HUMEUR_OPTIONS}
                  />
                );
              })()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
