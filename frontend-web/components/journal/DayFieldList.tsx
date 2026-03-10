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
  menuDuJour?: { collation_matin?: string; diner?: string; collation_apres_midi?: string } | null;
  weeklyTheme?: { title: string; date: string; end_date?: string } | null;
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

const MEALS_FIELDS: FieldConfig[] = [
  { key: "menu", label: "Notes sur les repas", Icon: StickyNote },
];

const WELLBEING_FIELDS: FieldConfig[] = [
  { key: "temperature",     label: "Température",              Icon: Sun },
  { key: "appetit",         label: "Appétit",                  Icon: Smile },
  { key: "humeur",          label: "Humeur",                   Icon: Heart },
  { key: "sommeil_minutes", label: "Sommeil",                  Icon: Moon },
  { key: "sante",           label: "État de santé",            Icon: Stethoscope },
  { key: "medicaments",     label: "Médicaments",              Icon: Pill },
];

const MESSAGE_FIELDS: FieldConfig[] = [
  { key: "message_educatrice", label: "Message de l'éducatrice", Icon: MessageCircle },
  { key: "observations",       label: "Observations / Anecdotes", Icon: BookOpen },
];

export function DayFieldList({
  day,
  readOnly = false,
  onFieldChange,
  appetitOptions,
  humeurOptions,
  menuDuJour,
  weeklyTheme,
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
    <div className="bg-surface-card rounded-xl shadow-card overflow-hidden">
      {/* Weekly theme card (read-only) */}
      {weeklyTheme && (
        <div className="px-4 py-3 border-b border-border-soft">
          <div className="flex items-start gap-2 p-3 bg-[#EAE8FF] rounded-xl">
            <span className="text-xl flex-shrink-0 mt-0.5">📚</span>
            <div className="flex-1">
              <span className="text-caption font-semibold uppercase tracking-wide text-accent-purple block mb-1">
                Thème de la semaine
              </span>
              <p className="text-body text-ink font-medium">{weeklyTheme.title}</p>
            </div>
          </div>
        </div>
      )}

      {/* Menu du jour card (garderie-level, read-only) */}
      {menuDuJour && (() => {
        const hasMenu = menuDuJour.collation_matin || menuDuJour.diner || menuDuJour.collation_apres_midi;
        if (!hasMenu) return null;
        return (
          <div className="px-4 py-3 border-b border-border-soft space-y-2">
            {menuDuJour.collation_matin && (
              <div className="flex items-start gap-2 p-3 bg-accent-blue/15 rounded-xl">
                <span className="text-xl flex-shrink-0 mt-0.5">🌅</span>
                <div className="flex-1">
                  <span className="text-caption font-semibold uppercase tracking-wide text-accent-blue block mb-1">
                    Collation matin
                  </span>
                  <p className="text-body text-ink whitespace-pre-wrap">{menuDuJour.collation_matin}</p>
                </div>
              </div>
            )}
            {menuDuJour.diner && (
              <div className="flex items-start gap-2 p-3 bg-accent-orange/15 rounded-xl">
                <UtensilsCrossed className="w-4 h-4 text-accent-orange flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="text-caption font-semibold uppercase tracking-wide text-accent-orange block mb-1">
                    Dîner
                  </span>
                  <p className="text-body text-ink whitespace-pre-wrap">{menuDuJour.diner}</p>
                </div>
              </div>
            )}
            {menuDuJour.collation_apres_midi && (
              <div className="flex items-start gap-2 p-3 bg-accent-purple/15 rounded-xl">
                <span className="text-xl flex-shrink-0 mt-0.5">🌙</span>
                <div className="flex-1">
                  <span className="text-caption font-semibold uppercase tracking-wide text-accent-purple block mb-1">
                    Collation après-midi
                  </span>
                  <p className="text-body text-ink whitespace-pre-wrap">{menuDuJour.collation_apres_midi}</p>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Absent toggle */}
      <div className="px-4 py-3 border-b border-border-soft flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserX className="w-4 h-4 text-ink-muted flex-shrink-0" />
          <span className="text-caption font-semibold uppercase tracking-wide text-ink-secondary">
            Absent
          </span>
        </div>
        {readOnly ? (
          isAbsent ? (
            <span className="rounded-pill bg-status-danger/15 text-status-danger text-caption font-semibold px-2 py-1">
              Absent
            </span>
          ) : null
        ) : (
          <button
            type="button"
            onClick={() => onFieldChange?.("absent", !isAbsent)}
            className={`relative inline-flex h-6 w-11 items-center rounded-pill transition-all duration-[180ms] focus:outline-none ${
              isAbsent ? "bg-status-danger" : "bg-border-soft"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-pill bg-white shadow transition-transform duration-[180ms] ${
                isAbsent ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        )}
      </div>

      {/* Absent banner */}
      {isAbsent && (
        <div className="px-4 py-3 flex items-center gap-3 bg-status-danger/8 border-b border-border-soft">
          <UserX className="w-4 h-4 text-status-danger flex-shrink-0" />
          <span className="text-body text-status-danger font-medium">Enfant absent ce jour</span>
        </div>
      )}

      {/* Fields — dimmed when absent */}
      <div className={isAbsent ? "opacity-30 pointer-events-none select-none" : ""}>

        {/* Section: Repas du jour */}
        <div className="bg-accent-orange/5">
          <div className="px-4 pt-4 pb-2">
            <h3 className="text-caption font-bold uppercase tracking-wider text-accent-orange mb-3 flex items-center gap-2">
              <span>🍽️</span>
              Repas du jour
            </h3>
          </div>
          {MEALS_FIELDS.map((cfg) => {
            if (cfg.key === "menu" && readOnly && !day.menu) return null;
            return (
              <div key={cfg.key} className="px-4 py-3 border-t border-border-soft/60">
                <div className="flex items-center gap-2 mb-2">
                  <cfg.Icon className="w-4 h-4 text-accent-orange flex-shrink-0" />
                  <span className="text-caption font-semibold uppercase tracking-wide text-ink-secondary">
                    {cfg.label}
                  </span>
                </div>
                <div>{renderControl(cfg)}</div>
              </div>
            );
          })}
        </div>

        {/* Section: Bien-être et observations */}
        <div className="bg-accent-green/5 border-t border-border-soft">
          <div className="px-4 pt-4 pb-2">
            <h3 className="text-caption font-bold uppercase tracking-wider text-accent-green mb-3 flex items-center gap-2">
              <span>💚</span>
              Bien-être et observations
            </h3>
          </div>
          {WELLBEING_FIELDS.map((cfg) => (
            <div key={cfg.key} className="px-4 py-3 border-t border-border-soft/60">
              <div className="flex items-center gap-2 mb-2">
                <cfg.Icon className="w-4 h-4 text-accent-green flex-shrink-0" />
                <span className="text-caption font-semibold uppercase tracking-wide text-ink-secondary">
                  {cfg.label}
                </span>
              </div>
              <div>{renderControl(cfg)}</div>
            </div>
          ))}
        </div>

        {/* Section: Message et notes */}
        <div className="bg-primary-soft/20 border-t border-border-soft">
          <div className="px-4 pt-4 pb-2">
            <h3 className="text-caption font-bold uppercase tracking-wider text-primary mb-3 flex items-center gap-2">
              <span>💬</span>
              Message et notes
            </h3>
          </div>
          {MESSAGE_FIELDS.map((cfg) => (
            <div key={cfg.key} className="px-4 py-3 border-t border-border-soft/60">
              <div className="flex items-center gap-2 mb-2">
                <cfg.Icon className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="text-caption font-semibold uppercase tracking-wide text-ink-secondary">
                  {cfg.label}
                </span>
              </div>
              <div>{renderControl(cfg)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
