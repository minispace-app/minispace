"use client";

import { IconSun, IconCloudSun, IconRain, IconSnow, IconStorm } from "./JournalIcons";

const OPTIONS = [
  { value: "ensoleille", Icon: IconSun,      label: "Ensoleillé" },
  { value: "nuageux",    Icon: IconCloudSun, label: "Nuageux" },
  { value: "pluie",      Icon: IconRain,     label: "Pluie" },
  { value: "neige",      Icon: IconSnow,     label: "Neige" },
  { value: "orageux",    Icon: IconStorm,    label: "Orageux" },
] as const;

interface Props {
  value: string | null;
  onChange?: (v: string | null) => void;
  readOnly?: boolean;
}

export function WeatherPicker({ value, onChange, readOnly = false }: Props) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={readOnly}
            onClick={() => !readOnly && onChange?.(active ? null : opt.value)}
            title={opt.label}
            className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-[180ms] ${
              active
                ? "bg-accent-blue/20 text-accent-blue ring-2 ring-accent-blue/40"
                : readOnly
                ? "text-ink-muted cursor-default"
                : "text-ink-muted hover:bg-surface-soft hover:text-ink cursor-pointer"
            }`}
          >
            <opt.Icon size={20} />
          </button>
        );
      })}
    </div>
  );
}
