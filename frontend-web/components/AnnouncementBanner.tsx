"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost/api";

interface Announcement {
  message: string;
  color: "yellow" | "red";
}

export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/announcement`)
      .then((r) => r.json())
      .then((data) => {
        if (data && data.message) setAnnouncement(data);
      })
      .catch(() => {});
  }, []);

  if (!announcement) return null;

  const isRed = announcement.color === "red";

  return (
    <div className="px-4 pt-3 flex-shrink-0">
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-soft text-sm font-medium ${
          isRed
            ? "bg-red-50/80 backdrop-blur-sm border border-red-200/60 text-red-800"
            : "bg-amber-50/80 backdrop-blur-sm border border-amber-200/60 text-amber-800"
        }`}
      >
        <span
          className={`w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-md ${
            isRed ? "bg-red-100 text-red-500" : "bg-amber-100 text-amber-500"
          }`}
        >
          {isRed ? (
            <AlertTriangle className="w-4 h-4" />
          ) : (
            <Info className="w-4 h-4" />
          )}
        </span>
        <p className="flex-1 leading-snug">{announcement.message}</p>
      </div>
    </div>
  );
}
