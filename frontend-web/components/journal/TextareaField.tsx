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
      <div className="text-body text-ink whitespace-pre-wrap leading-relaxed">{value}</div>
    ) : (
      <div className="text-body text-ink-muted italic">—</div>
    );
  }

  return (
    <textarea
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-3 py-2 text-body border-0 bg-surface-soft rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all duration-[180ms] placeholder:text-ink-muted"
    />
  );
}
