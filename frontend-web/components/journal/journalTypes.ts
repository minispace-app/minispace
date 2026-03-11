import React from "react";
import { EmojiOption } from "./EmojiPicker";
import {
  IconMoodTresBien,
  IconMoodBien,
  IconMoodDifficile,
  IconMoodPleurs,
  IconAppetitBeaucoup,
  IconAppetitNormal,
  IconAppetitPeu,
  IconAppetitRefuse,
} from "./JournalIcons";

export interface DailyJournal {
  id?: string;
  child_id?: string;
  date: string;
  temperature?: string | null; // DEPRECATED: Weather now comes from daily_menus.weather (day-level)
  menu?: string | null;
  appetit?: string | null;
  humeur?: string | null;
  sommeil_minutes?: number | null;
  absent?: boolean | null;
  sante?: string | null;
  medicaments?: string | null;
  message_educatrice?: string | null;
  observations?: string | null;
}

export type DayData = Omit<DailyJournal, "child_id" | "id">;

export const WEEK_DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"] as const;

export const APPETIT_OPTIONS: EmojiOption[] = [
  { value: "comme_habitude", emoji: "Normal",   label: "Normal",   icon: React.createElement(IconAppetitNormal,   { size: 20 }) },
  { value: "peu",             emoji: "Peu",      label: "Peu",      icon: React.createElement(IconAppetitPeu,     { size: 20 }) },
  { value: "beaucoup",        emoji: "Beaucoup", label: "Beaucoup", icon: React.createElement(IconAppetitBeaucoup,{ size: 20 }) },
  { value: "refuse",          emoji: "Refuse",   label: "Refuse",   icon: React.createElement(IconAppetitRefuse,  { size: 20 }) },
];

export const HUMEUR_OPTIONS: EmojiOption[] = [
  { value: "tres_bien",  emoji: "😄", label: "Très bien", icon: React.createElement(IconMoodTresBien,  { size: 20 }) },
  { value: "bien",       emoji: "🙂", label: "Bien",      icon: React.createElement(IconMoodBien,      { size: 20 }) },
  { value: "difficile",  emoji: "😕", label: "Difficile", icon: React.createElement(IconMoodDifficile, { size: 20 }) },
  { value: "pleurs",     emoji: "😢", label: "Pleurs",    icon: React.createElement(IconMoodPleurs,    { size: 20 }) },
];

export const FIELD_ROWS = [
  "menu",
  "appetit",
  "humeur",
  "sommeil",
  "sante",
  "medicaments",
  "message_educatrice",
  "observations",
] as const;

export function emptyDay(date: string): DayData {
  return {
    date,
    temperature: null, // Legacy field, kept for backwards compatibility
    menu: null,
    appetit: null,
    humeur: null,
    sommeil_minutes: null,
    absent: false,
    sante: null,
    medicaments: null,
    message_educatrice: null,
    observations: null,
  };
}

export function hasDayData(day: Partial<DailyJournal>): boolean {
  return !!(
    day.menu ||
    day.appetit ||
    day.humeur ||
    day.sommeil_minutes != null ||
    day.sante ||
    day.medicaments ||
    day.message_educatrice ||
    day.observations
  );
}
