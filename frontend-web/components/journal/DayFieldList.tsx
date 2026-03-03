"use client";

import { Sun, StickyNote, Smile, Heart, Moon, Stethoscope, Pill, MessageCircle, BookOpen, UserX, UtensilsCrossed } from "lucide-react";
import { WeatherPicker } from "./WeatherPicker";
import { EmojiPicker, EmojiOption } from "./EmojiPicker";
import { SleepBar } from "./SleepBar";
import { TextareaField } from "./TextareaField";
import { DailyJournal } from "./journalTypes";

interface Props {
  day: Partial<DailyJournal>;
  readOnly?: boolean;
  onFieldChange?: (field: keyof DailyJournal, value: unknown) => void;
  appetitOptions: EmojiOption[];
  humeurOptions: EmojiOption[];
  menuDuJour?: string | null;
  placeholders?: {
    menu?: string;
    sante?: string;
    medicaments?: string;
    message_educatrice?: string;
    observations?: string;
  };
}

interface FieldConfig {
  key: keyof DailyJournal;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const FIELD_CONFIGS: FieldConfig[] = [
  { key: "temperature",        label: "Température",              Icon: Sun },
  { key: "menu",               label: "Note alimentaire",         Icon: StickyNote },
  { key: "appetit",            label: "Appétit",                  Icon: Smile },
  { key: "humeur",             label: "Humeur",                   Icon: Heart },
  { key: "sommeil_minutes",    label: "Sommeil",                  Icon: Moon },
  { key: "sante",              label: "État de santé",            Icon: Stethoscope },
  { key: "medicaments",        label: "Médicaments",              Icon: Pill },
  { key: "message_educatrice", label: "Message éducatrice",       Icon: MessageCircle },
  { key: "observations",       label: "Observations / Anecdotes", Icon: BookOpen },
];

export function DayFieldList({
  day,
  readOnly = false,
  onFieldChange,
  appetitOptions,
  humeurOptions,
  menuDuJour,
  placeholders = {},
}: Props) {
  const isAbsent = !!day.absent;
  const set = (field: keyof DailyJournal) => (val: unknown) => onFieldChange?.(field, val);

  function renderControl(cfg: FieldConfig) {
    switch (cfg.key) {
      case "temperature":
        return (
          <WeatherPicker
            value={day.temperature ?? null}
            onChange={set("temperature") as (v: string | null) => void}
            readOnly={readOnly || isAbsent}
          />
        );
      case "appetit":
        return (
          <EmojiPicker
            options={appetitOptions}
            value={day.appetit ?? null}
            onChange={set("appetit") as (v: string | null) => void}
            readOnly={readOnly || isAbsent}
          />
        );
      case "humeur":
        return (
          <EmojiPicker
            options={humeurOptions}
            value={day.humeur ?? null}
            onChange={set("humeur") as (v: string | null) => void}
            readOnly={readOnly || isAbsent}
          />
        );
      case "sommeil_minutes":
        return (
          <SleepBar
            value={day.sommeil_minutes ?? null}
            onChange={set("sommeil_minutes") as (v: number | null) => void}
            readOnly={readOnly || isAbsent}
          />
        );
      case "menu":
        return (
          <TextareaField
            value={day.menu ?? ""}
            onChange={set("menu") as (v: string) => void}
            readOnly={readOnly || isAbsent}
            placeholder={placeholders.menu ?? "Exception pour cet enfant..."}
            rows={2}
          />
        );
      case "sante":
        return (
          <TextareaField
            value={day.sante ?? ""}
            onChange={set("sante") as (v: string) => void}
            readOnly={readOnly || isAbsent}
            placeholder={placeholders.sante ?? "Santé..."}
            rows={2}
          />
        );
      case "medicaments":
        return (
          <TextareaField
            value={day.medicaments ?? ""}
            onChange={set("medicaments") as (v: string) => void}
            readOnly={readOnly || isAbsent}
            placeholder={placeholders.medicaments ?? "Médicaments..."}
            rows={2}
          />
        );
      case "message_educatrice":
        return (
          <TextareaField
            value={day.message_educatrice ?? ""}
            onChange={set("message_educatrice") as (v: string) => void}
            readOnly={readOnly || isAbsent}
            placeholder={placeholders.message_educatrice ?? "Message..."}
            rows={2}
          />
        );
      case "observations":
        return (
          <TextareaField
            value={day.observations ?? ""}
            onChange={set("observations") as (v: string) => void}
            readOnly={readOnly || isAbsent}
            placeholder={placeholders.observations ?? "Observations et anecdotes..."}
            rows={3}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="divide-y divide-slate-100">
      {/* Menu du jour card (garderie-level, read-only) */}
      {menuDuJour && (
        <div className="px-4 py-3">
          <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
            <UtensilsCrossed className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-amber-700 block mb-1">
                Menu du jour
              </span>
              <p className="text-sm text-amber-900 whitespace-pre-wrap">{menuDuJour}</p>
            </div>
          </div>
        </div>
      )}

      {/* Absent toggle */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserX className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Absent
          </span>
        </div>
        {readOnly ? (
          isAbsent ? (
            <span className="px-3 py-1 rounded-full bg-red-100 text-red-600 text-xs font-semibold">
              Absent
            </span>
          ) : null
        ) : (
          <button
            type="button"
            onClick={() => onFieldChange?.("absent", !isAbsent)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              isAbsent ? "bg-red-500" : "bg-slate-200"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                isAbsent ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        )}
      </div>

      {/* Absent banner */}
      {isAbsent && (
        <div className="px-4 py-4 flex items-center gap-3 bg-red-50">
          <UserX className="w-5 h-5 text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-600 font-medium">Enfant absent ce jour</span>
        </div>
      )}

      {/* Fields — dimmed when absent */}
      <div className={isAbsent ? "opacity-30 pointer-events-none select-none" : ""}>
        {FIELD_CONFIGS.map((cfg) => {
          // In readOnly mode, skip the menu (food note) field if it is empty
          if (cfg.key === "menu" && readOnly && !day.menu) return null;

          return (
            <div key={cfg.key} className="px-4 py-3 border-t border-slate-100">
              <div className="flex items-center gap-2 mb-2">
                <cfg.Icon className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {cfg.label}
                </span>
              </div>
              <div>{renderControl(cfg)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
