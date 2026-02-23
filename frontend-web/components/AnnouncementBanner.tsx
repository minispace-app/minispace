"use client";

import { useEffect, useState } from "react";
import { X, AlertTriangle, Info } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost/api";

interface Announcement {
  message: string;
  color: "yellow" | "red";
}

export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/announcement`)
      .then((r) => r.json())
      .then((data) => {
        if (data && data.message) setAnnouncement(data);
      })
      .catch(() => {});
  }, []);

  if (!announcement || dismissed) return null;

  const isRed = announcement.color === "red";
  const colors = isRed
    ? "bg-red-50 border-red-200 text-red-800"
    : "bg-yellow-50 border-yellow-200 text-yellow-800";
  const iconColor = isRed ? "text-red-500" : "text-yellow-500";
  const btnColor = isRed
    ? "hover:bg-red-100 text-red-500"
    : "hover:bg-yellow-100 text-yellow-600";

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 border-b text-sm ${colors}`}>
      {isRed ? (
        <AlertTriangle className={`w-4 h-4 flex-shrink-0 ${iconColor}`} />
      ) : (
        <Info className={`w-4 h-4 flex-shrink-0 ${iconColor}`} />
      )}
      <p className="flex-1">{announcement.message}</p>
      <button
        onClick={() => setDismissed(true)}
        className={`p-1 rounded transition flex-shrink-0 ${btnColor}`}
        aria-label="Fermer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
