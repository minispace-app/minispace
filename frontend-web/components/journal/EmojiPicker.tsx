"use client";

export interface EmojiOption {
  value: string;
  emoji: string;
  label: string;
}

interface Props {
  options: EmojiOption[];
  value: string | null;
  onChange?: (v: string | null) => void;
  readOnly?: boolean;
}

export function EmojiPicker({ options, value, onChange, readOnly = false }: Props) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={readOnly}
            onClick={() => !readOnly && onChange?.(active ? null : opt.value)}
            className={`text-base rounded-lg px-1.5 py-1 transition border ${
              active
                ? "border-blue-400 bg-blue-50 ring-2 ring-blue-300"
                : "border-transparent hover:border-slate-300 hover:bg-slate-50"
            } ${readOnly ? "cursor-default" : "cursor-pointer"}`}
            title={opt.label}
          >
            {opt.emoji}
          </button>
        );
      })}
    </div>
  );
}
