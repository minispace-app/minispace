"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { ChevronLeft, ChevronRight, Save, Send } from "lucide-react";
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

type DayData = Omit<DailyJournal, "child_id" | "id">;

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

function emptyDay(date: string): DayData {
  return {
    date,
    temperature: null,
    menu: null,
    appetit: null,
    humeur: null,
    sommeil_minutes: null,
    sante: null,
    medicaments: null,
    message_educatrice: null,
    observations: null,
  };
}

export default function JournalDashboardPage() {
  const t = useTranslations("journal");
  const tc = useTranslations("common");

  const today = formatDate(new Date());

  const [selectedChildId, setSelectedChildId] = useState<string>("");
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [savingAll, setSavingAll] = useState(false);
  const [localData, setLocalData] = useState<Record<string, DayData>>({});
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendMessage, setSendMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const weekDates = WEEK_DAYS.map((_, i) => addDays(weekStart, i));
  const weekStartStr = formatDate(weekStart);

  const { data: childrenData } = useSWR("children-list-journal", () => childrenApi.list());
  const children: Child[] = (childrenData as { data: Child[] } | undefined)?.data ?? [];

  const swrKey = selectedChildId ? ["journal-week", selectedChildId, weekStartStr] : null;
  const { data: journalData, mutate } = useSWR(swrKey, () =>
    journalApi.getWeek(selectedChildId, weekStartStr)
  );

  const serverEntries: DailyJournal[] =
    (journalData as { data: DailyJournal[] } | undefined)?.data ?? [];

  const getDayData = useCallback(
    (dateStr: string): DayData => {
      if (localData[dateStr]) return localData[dateStr];
      const server = serverEntries.find((e) => e.date === dateStr);
      return server ?? emptyDay(dateStr);
    },
    [localData, serverEntries]
  );

  const updateField = (
    dateStr: string,
    field: keyof DayData,
    value: DayData[keyof DayData]
  ) => {
    setLocalData((prev) => ({
      ...prev,
      [dateStr]: {
        ...(prev[dateStr] ?? getDayData(dateStr)),
        [field]: value,
      },
    }));
  };

  const handleSaveAll = async () => {
    if (!selectedChildId) return;
    setSavingAll(true);
    try {
      await Promise.all(
        weekDates.map(async (date) => {
          const dateStr = formatDate(date);
          const day = getDayData(dateStr);
          await journalApi.upsert({
            child_id: selectedChildId,
            date: dateStr,
            temperature: day.temperature ?? null,
            menu: day.menu ?? null,
            appetit: day.appetit ?? null,
            humeur: day.humeur ?? null,
            sommeil_minutes: day.sommeil_minutes ?? null,
            sante: day.sante ?? null,
            medicaments: day.medicaments ?? null,
            message_educatrice: day.message_educatrice ?? null,
            observations: day.observations ?? null,
          });
        })
      );
      setLocalData({});
      mutate();
    } finally {
      setSavingAll(false);
    }
  };

  const prevWeek = () => {
    setWeekStart((d) => addDays(d, -7));
    setLocalData({});
  };
  const nextWeek = () => {
    setWeekStart((d) => addDays(d, 7));
    setLocalData({});
  };

  const handleSendToParents = async () => {
    setSendingEmail(true);
    setSendMessage(null);
    try {
      await journalApi.sendAllToParents(weekStartStr);
      setSendMessage({ type: "success", text: t("sendSuccess") });
      setTimeout(() => setSendMessage(null), 4000);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setSendMessage({
        type: "error",
        text: e?.response?.data?.error || t("sendError"),
      });
    } finally {
      setSendingEmail(false);
    }
  };

  function renderField(field: FieldKey, day: DayData, dateStr: string) {
    const set = (val: DayData[keyof DayData]) => updateField(dateStr, field as keyof DayData, val);
    switch (field) {
      case "temperature":
        return (
          <WeatherPicker
            value={day.temperature ?? null}
            onChange={(v) => set(v)}
          />
        );
      case "appetit":
        return (
          <EmojiPicker
            options={APPETIT_OPTIONS}
            value={day.appetit ?? null}
            onChange={(v) => set(v)}
          />
        );
      case "humeur":
        return (
          <EmojiPicker
            options={HUMEUR_OPTIONS}
            value={day.humeur ?? null}
            onChange={(v) => set(v)}
          />
        );
      case "sommeil":
        return (
          <SleepBar
            value={day.sommeil_minutes ?? null}
            onChange={(v) => updateField(dateStr, "sommeil_minutes", v)}
          />
        );
      case "menu":
        return (
          <TextareaField
            value={day.menu ?? ""}
            onChange={(v) => set(v)}
            placeholder={t("menuPlaceholder")}
            rows={2}
          />
        );
      case "sante":
        return (
          <TextareaField
            value={day.sante ?? ""}
            onChange={(v) => set(v)}
            placeholder={t("healthPlaceholder")}
            rows={2}
          />
        );
      case "medicaments":
        return (
          <TextareaField
            value={day.medicaments ?? ""}
            onChange={(v) => set(v)}
            placeholder={t("medicationsPlaceholder")}
            rows={2}
          />
        );
      case "message_educatrice":
        return (
          <TextareaField
            value={day.message_educatrice ?? ""}
            onChange={(v) => set(v)}
            placeholder={t("messagePlaceholder")}
            rows={2}
          />
        );
      case "observations":
        return (
          <TextareaField
            value={day.observations ?? ""}
            onChange={(v) => set(v)}
            placeholder={t("observationsPlaceholder")}
            rows={3}
          />
        );
    }
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <h1 className="text-xl font-bold text-slate-800 flex-1">{t("title")}</h1>

        {/* Child selector */}
        <select
          value={selectedChildId}
          onChange={(e) => {
            setSelectedChildId(e.target.value);
            setLocalData({});
          }}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{t("selectChild")}</option>
          {children.map((c) => (
            <option key={c.id} value={c.id}>
              {c.first_name} {c.last_name}
            </option>
          ))}
        </select>

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

      {/* Messages */}
      {sendMessage && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm font-medium ${
            sendMessage.type === "success"
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {sendMessage.text}
        </div>
      )}

      {!selectedChildId ? (
        <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
          {t("noChild")}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <div
              className="grid min-w-[900px]"
              style={{ gridTemplateColumns: "160px repeat(5, 1fr)" }}
            >
              {/* Header row */}
              <div className="p-3 text-xs font-semibold text-slate-400 uppercase tracking-wide" />
              {weekDates.map((date, i) => {
                const dateStr = formatDate(date);
                const isToday = dateStr === today;
                return (
                  <div
                    key={i}
                    className={`p-3 text-center border-b border-slate-200 ${
                      isToday ? "bg-blue-50" : ""
                    }`}
                  >
                    <div
                      className={`text-xs font-semibold uppercase tracking-wide ${
                        isToday ? "text-blue-600" : "text-slate-500"
                      }`}
                    >
                      {t(`days.${WEEK_DAYS[i]}`)}
                    </div>
                    <div
                      className={`text-sm mt-0.5 font-medium ${
                        isToday ? "text-blue-700" : "text-slate-700"
                      }`}
                    >
                      {date.toLocaleDateString("fr-CA", { month: "short", day: "numeric" })}
                    </div>
                    {isToday && (
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mx-auto mt-1" />
                    )}
                  </div>
                );
              })}

              {/* Field rows */}
              {FIELD_ROWS.map((field) => (
                <>
                  {/* Label column */}
                  <div
                    key={`label-${field}`}
                    className="p-3 text-xs font-medium text-slate-500 border-b border-slate-100 flex items-start pt-4"
                  >
                    {t(`fields.${field === "sommeil" ? "sommeil" : field}`)}
                  </div>

                  {/* Day columns */}
                  {weekDates.map((date, di) => {
                    const dateStr = formatDate(date);
                    const day = getDayData(dateStr);
                    const isToday = dateStr === today;
                    return (
                      <div
                        key={`${field}-${di}`}
                        className={`p-2 border-b border-slate-100 border-l border-l-slate-50 ${
                          isToday ? "bg-blue-50/40" : ""
                        }`}
                      >
                        {renderField(field, day, dateStr)}
                      </div>
                    );
                  })}
                </>
              ))}
            </div>
          </div>

          {/* Action bar */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-100">
            <button
              onClick={handleSaveAll}
              disabled={savingAll}
              className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-900 disabled:opacity-50 transition"
            >
              <Save className="w-4 h-4" />
              {savingAll ? tc("loading") : t("saveWeek")}
            </button>

            <button
              onClick={handleSendToParents}
              disabled={sendingEmail}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
            >
              <Send className="w-4 h-4" />
              {sendingEmail ? t("sending") : t("sendToParents")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
