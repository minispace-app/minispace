"use client";

const SEGMENTS = [0, 30, 60, 90, 120, 150, 180] as const;

const LABELS: Record<number, string> = {
  0: "0",
  30: "30m",
  60: "1h",
  90: "1h30",
  120: "2h",
  150: "2h30",
  180: "3h+",
};

interface Props {
  value: number | null;
  onChange?: (v: number | null) => void;
  readOnly?: boolean;
}

export function SleepBar({ value, onChange, readOnly = false }: Props) {
  return (
    <div className="flex gap-0.5">
      {SEGMENTS.map((seg) => {
        const filled = value !== null && value >= seg;
        const selected = value === seg;
        return (
          <button
            key={seg}
            type="button"
            disabled={readOnly}
            onClick={() => !readOnly && onChange?.(selected ? null : seg)}
            className={`flex-1 h-6 rounded text-[10px] font-medium transition border ${
              filled
                ? "bg-blue-400 border-blue-500 text-white"
                : "bg-slate-100 border-slate-200 text-slate-400"
            } ${selected ? "ring-2 ring-blue-300" : ""} ${
              readOnly ? "cursor-default" : "cursor-pointer hover:opacity-80"
            }`}
            title={`${seg} min`}
          >
            {LABELS[seg]}
          </button>
        );
      })}
    </div>
  );
}
