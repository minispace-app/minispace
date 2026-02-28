import { EmojiOption } from "./EmojiPicker";

export interface DailyJournal {
  id?: string;
  child_id?: string;
  date: string;
  temperature?: string | null;
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
  { value: "comme_habitude", emoji: "😊", label: "Comme d'habitude" },
  { value: "peu",             emoji: "😐", label: "Peu" },
  { value: "beaucoup",        emoji: "😄", label: "Beaucoup" },
  { value: "refuse",          emoji: "😤", label: "Refuse" },
];

export const HUMEUR_OPTIONS: EmojiOption[] = [
  { value: "tres_bien",  emoji: "😄", label: "Très bien" },
  { value: "bien",       emoji: "🙂", label: "Bien" },
  { value: "difficile",  emoji: "😕", label: "Difficile" },
  { value: "pleurs",     emoji: "😢", label: "Pleurs" },
];

export const FIELD_ROWS = [
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

export function emptyDay(date: string): DayData {
  return {
    date,
    temperature: null,
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
    day.temperature ||
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
