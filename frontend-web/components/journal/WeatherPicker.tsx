"use client";

const OPTIONS = [
  { value: "ensoleille", emoji: "☀️" },
  { value: "nuageux",    emoji: "🌥️" },
  { value: "pluie",      emoji: "🌧️" },
  { value: "neige",      emoji: "❄️" },
  { value: "orageux",    emoji: "⛈️" },
] as const;

interface Props {
  value: string | null;
  onChange?: (v: string | null) => void;
  readOnly?: boolean;
}

export function WeatherPicker({ value, onChange, readOnly = false }: Props) {
  return (
    <div className="flex gap-1 flex-wrap">
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={readOnly}
            onClick={() => !readOnly && onChange?.(active ? null : opt.value)}
            className={`text-lg rounded-lg p-1 transition border ${
              active
                ? "border-blue-400 bg-blue-50 ring-2 ring-blue-300"
                : "border-transparent hover:border-slate-300 hover:bg-slate-50"
            } ${readOnly ? "cursor-default" : "cursor-pointer"}`}
            title={opt.value}
          >
            {opt.emoji}
          </button>
        );
      })}
    </div>
  );
}
