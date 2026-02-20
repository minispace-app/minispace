"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { childrenApi, journalApi } from "../../../../lib/api";
import { WeatherPicker } from "../../../../components/journal/WeatherPicker";
import { EmojiPicker, EmojiOption } from "../../../../components/journal/EmojiPicker";
import { SleepBar } from "../../../../components/journal/SleepBar";
import { TextareaField } from "../../../../components/journal/TextareaField";

interface Child {
  id: string;
  first_name: string;
  last_name: string;
}

interface DailyJournal {
  id?: string;
  child_id: string;
  date: string;
  temperature?: string | null;
  menu?: string | null;
  appetit?: string | null;
  humeur?: string | null;
  sommeil_minutes?: number | null;
  sante?: string | null;
  medicaments?: string | null;
  message_educatrice?: string | null;
  observations?: string | null;
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const WEEK_DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"] as const;

const APPETIT_OPTIONS: EmojiOption[] = [
  { value: "comme_habitude", emoji: "😊", label: "Comme d'habitude" },
  { value: "peu",             emoji: "😐", label: "Peu" },
  { value: "beaucoup",        emoji: "😄", label: "Beaucoup" },
  { value: "refuse",          emoji: "😤", label: "Refuse" },
];

const HUMEUR_OPTIONS: EmojiOption[] = [
  { value: "tres_bien",  emoji: "😄", label: "Très bien" },
  { value: "bien",       emoji: "🙂", label: "Bien" },
  { value: "difficile",  emoji: "😕", label: "Difficile" },
  { value: "pleurs",     emoji: "😢", label: "Pleurs" },
];

const FIELD_ROWS = [
  "temperature",
  "menu",
  "appetit",
  "humeur",
  "sommeil",
  "sante",
  "medicaments",
  "message_educatrice",
  "observations",
] as const;

type FieldKey = typeof FIELD_ROWS[number];

function emptyDay(date: string): DailyJournal {
  return { child_id: "", date, temperature: null, menu: null, appetit: null, humeur: null, sommeil_minutes: null, sante: null, medicaments: null, message_educatrice: null, observations: null };
}

function renderReadOnlyField(field: FieldKey, day: DailyJournal) {
  switch (field) {
    case "temperature":
      return <WeatherPicker value={day.temperature ?? null} readOnly />;
    case "appetit":
      return <EmojiPicker options={APPETIT_OPTIONS} value={day.appetit ?? null} readOnly />;
    case "humeur":
      return <EmojiPicker options={HUMEUR_OPTIONS} value={day.humeur ?? null} readOnly />;
    case "sommeil":
      return <SleepBar value={day.sommeil_minutes ?? null} readOnly />;
    case "menu":
      return <TextareaField value={day.menu ?? ""} readOnly />;
    case "sante":
      return <TextareaField value={day.sante ?? ""} readOnly />;
    case "medicaments":
      return <TextareaField value={day.medicaments ?? ""} readOnly />;
    case "message_educatrice":
      return <TextareaField value={day.message_educatrice ?? ""} readOnly />;
    case "observations":
      return <TextareaField value={day.observations ?? ""} readOnly rows={3} />;
  }
}

export default function ParentJournalPage() {
  const t = useTranslations("journal");

  const [selectedChildId, setSelectedChildId] = useState<string>("");
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));

  const weekDates = WEEK_DAYS.map((_, i) => addDays(weekStart, i));
  const weekStartStr = formatDate(weekStart);

  const { data: childrenData } = useSWR("children-list-parent-journal", () => childrenApi.list());
  const children: Child[] = (childrenData as { data: Child[] } | undefined)?.data ?? [];

  // Auto-select first child
  const effectiveChildId = selectedChildId || (children.length > 0 ? children[0].id : "");

  const swrKey = effectiveChildId ? ["journal-week", effectiveChildId, weekStartStr] : null;
  const { data: journalData } = useSWR(swrKey, () =>
    journalApi.getWeek(effectiveChildId, weekStartStr)
  );

  const serverEntries: DailyJournal[] =
    (journalData as { data: DailyJournal[] } | undefined)?.data ?? [];

  const getDayData = (dateStr: string): DailyJournal => {
    return serverEntries.find((e) => e.date === dateStr) ?? emptyDay(dateStr);
  };

  const prevWeek = () => setWeekStart((d) => addDays(d, -7));
  const nextWeek = () => setWeekStart((d) => addDays(d, 7));

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <h1 className="text-xl font-bold text-slate-800 flex-1">{t("title")}</h1>

        {/* Child selector (only shown if multiple children) */}
        {children.length > 1 && (
          <select
            value={effectiveChildId}
            onChange={(e) => setSelectedChildId(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.first_name} {c.last_name}
              </option>
            ))}
          </select>
        )}

        {/* Week navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={prevWeek}
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
            title={t("prevWeek")}
          >
            <ChevronLeft className="w-4 h-4 text-slate-600" />
          </button>
          <span className="text-sm text-slate-600 font-medium whitespace-nowrap">
            {weekStartStr}
          </span>
          <button
            onClick={nextWeek}
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
            title={t("nextWeek")}
          >
            <ChevronRight className="w-4 h-4 text-slate-600" />
          </button>
        </div>
      </div>

      {!effectiveChildId ? (
        <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
          {t("noChild")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div
            className="grid min-w-[700px]"
            style={{ gridTemplateColumns: "160px repeat(5, 1fr)" }}
          >
            {/* Header row */}
            <div className="p-3" />
            {weekDates.map((date, i) => (
              <div key={i} className="p-3 text-center border-b border-slate-200">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {t(`days.${WEEK_DAYS[i]}`)}
                </div>
                <div className="text-sm text-slate-700 mt-0.5">
                  {date.toLocaleDateString("fr-CA", { month: "short", day: "numeric" })}
                </div>
              </div>
            ))}

            {/* Field rows */}
            {FIELD_ROWS.map((field) => (
              <>
                <div
                  key={`label-${field}`}
                  className="p-3 text-xs font-medium text-slate-500 border-b border-slate-100 flex items-start pt-4"
                >
                  {t(`fields.${field === "sommeil" ? "sommeil" : field}`)}
                </div>
                {weekDates.map((date, di) => {
                  const dateStr = formatDate(date);
                  const day = getDayData(dateStr);
                  return (
                    <div
                      key={`${field}-${di}`}
                      className="p-2 border-b border-slate-100 border-l border-l-slate-50"
                    >
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
}
