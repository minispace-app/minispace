"use client";

import { useEffect, useState } from "react";
import { getTenantSlug } from "../lib/api";

export function DemoBanner() {
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    setIsDemo(getTenantSlug() === "demo");
  }, []);

  if (!isDemo) return null;

  return (
    <div className="bg-orange-500 text-white text-sm py-2 px-4 text-center flex items-center justify-center gap-2 flex-shrink-0">
      <span aria-hidden="true">🎭</span>
      <span>
        <strong>Mode Démo</strong> — Les données sont réinitialisées toutes les 30 minutes
      </span>
    </div>
  );
}
