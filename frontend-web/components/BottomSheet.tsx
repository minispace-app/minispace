"use client";

import { X } from "lucide-react";
import { ReactNode, useEffect } from "react";

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function BottomSheet({ isOpen, onClose, title, children }: BottomSheetProps) {
  // Prevent body scroll when sheet is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
    return () => {
      document.body.style.overflow = "auto";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Overlay */}
      <div
        className="flex-1 bg-black/30 md:hidden"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="bg-surface-card rounded-t-xl shadow-hover md:hidden max-h-[90vh] overflow-y-auto">
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-12 h-1 rounded-pill bg-border-soft" />
        </div>

        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-soft">
            <h2 className="text-h3 font-semibold text-ink">{title}</h2>
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center hover:bg-surface-soft rounded-pill transition-all duration-[180ms]"
            >
              <X size={18} strokeWidth={1.5} className="text-ink-secondary" />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="p-4">
          {children}
        </div>
      </div>
    </div>
  );
}
