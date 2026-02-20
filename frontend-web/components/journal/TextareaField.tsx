"use client";

interface Props {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  rows?: number;
}

export function TextareaField({
  value,
  onChange,
  readOnly = false,
  placeholder = "",
  rows = 2,
}: Props) {
  if (readOnly) {
    return value ? (
      <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{value}</div>
    ) : (
      <div className="text-sm text-slate-300 italic">—</div>
    );
  }

  return (
    <textarea
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
    />
  );
}
