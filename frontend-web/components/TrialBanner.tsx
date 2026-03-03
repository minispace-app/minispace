"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../lib/api";

export function TrialBanner() {
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    apiClient
      .get("/tenant/info")
      .then((res) => {
        const expiresAt: string | null = res.data.trial_expires_at ?? null;
        if (!expiresAt) return; // permanent account
        const expires = new Date(expiresAt);
        const now = new Date();
        const diff = Math.ceil((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diff <= 7) {
          setDaysLeft(Math.max(diff, 0));
        }
      })
      .catch(() => {/* ignore */});
  }, []);

  if (daysLeft === null) return null;

  return (
    <div className={`text-sm py-2 px-4 text-center flex items-center justify-center gap-2 flex-shrink-0 ${
      daysLeft === 0
        ? "bg-red-600 text-white"
        : "bg-yellow-400 text-yellow-900"
    }`}>
      <span aria-hidden="true">⏳</span>
      <span>
        {daysLeft === 0
          ? "Votre période d'essai est terminée. Contactez le support pour continuer."
          : daysLeft === 1
            ? "Il reste 1 jour à votre période d'essai gratuit."
            : `Il reste ${daysLeft} jours à votre période d'essai gratuit.`
        }
      </span>
    </div>
  );
}
