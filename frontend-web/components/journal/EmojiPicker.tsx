"use client";

import React from "react";

export interface EmojiOption {
  value: string;
  emoji: string;
  label: string;
  icon?: React.ReactNode;
}

interface Props {
  options: EmojiOption[];
  value: string | null;
  onChange?: (v: string | null) => void;
  readOnly?: boolean;
}

export function EmojiPicker({ options, value, onChange, readOnly = false }: Props) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((opt) => {
        const active = value === opt.value;
        const hasIcon = !!opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={readOnly}
            onClick={() => !readOnly && onChange?.(active ? null : opt.value)}
            title={opt.label}
            className={`transition-all duration-[180ms] ${
              hasIcon
                ? `w-9 h-9 flex items-center justify-center rounded-xl ${
                    active
                      ? "bg-accent-yellow/30 text-ink ring-2 ring-accent-yellow/50"
                      : readOnly
                      ? "text-ink-muted cursor-default"
                      : "text-ink-muted hover:bg-surface-soft hover:text-ink cursor-pointer"
                  }`
                : `rounded-pill px-3 py-1.5 text-caption font-medium ${
                    active
                      ? "bg-ink text-white"
                      : readOnly
                      ? "bg-surface-soft text-ink-muted cursor-default"
                      : "bg-surface-soft text-ink-secondary hover:bg-border-soft cursor-pointer"
                  }`
            }`}
          >
            {hasIcon ? opt.icon : opt.label}
          </button>
        );
      })}
    </div>
  );
}
