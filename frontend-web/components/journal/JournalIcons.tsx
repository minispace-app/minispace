"use client";

interface IconProps {
  className?: string;
  size?: number;
}

const base = (d: React.ReactNode, size = 22) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {d}
  </svg>
);

/* ── MÉTÉO ─────────────────────────────────────────────── */

export function IconSun({ size }: IconProps) {
  return base(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>,
    size
  );
}

export function IconCloudSun({ size }: IconProps) {
  return base(
    <>
      <circle cx="8.5" cy="9.5" r="2.5" />
      <path d="M8.5 7V5M4.46 7.46l1.06 1.06M3 11.5h2M8.5 12v2" />
      <path d="M14 14.5a4 4 0 0 0-7.68-1.5H5.5a3.5 3.5 0 0 0 0 7H14a3 3 0 0 0 0-6z" />
    </>,
    size
  );
}

export function IconCloud({ size }: IconProps) {
  return base(
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z" />,
    size
  );
}

export function IconRain({ size }: IconProps) {
  return base(
    <>
      <path d="M20 13.5a7 7 0 1 0-13 2H4.5a3.5 3.5 0 0 0 0 7H16a4 4 0 0 0 4-4v-.5" />
      <path d="M8 19v3M12 20v3M16 19v3" />
    </>,
    size
  );
}

export function IconSnow({ size }: IconProps) {
  return base(
    <>
      <path d="M20 12.5a7 7 0 1 0-13 1.5H5.5a3.5 3.5 0 0 0 0 6H16a4 4 0 0 0 4-4" />
      <path d="M8 21l1-1-1-1M12 22v-3M16 21l-1-1 1-1M12 19l-1-1 1-1" />
    </>,
    size
  );
}

export function IconStorm({ size }: IconProps) {
  return base(
    <>
      <path d="M17.5 12H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z" />
      <path d="M13 14l-2 4h4l-2 4" />
    </>,
    size
  );
}

/* ── APPÉTIT ───────────────────────────────────────────── */

// Assiette pleine + couverts
export function IconAppetitNormal({ size }: IconProps) {
  return base(
    <>
      <ellipse cx="12" cy="16" rx="7" ry="2" />
      <path d="M5 16a7 7 0 0 1 14 0" />
      <path d="M9 6v5M11 6v5M9 8h2" />
      <path d="M15 6v3a2 2 0 0 1-2 2" />
    </>,
    size
  );
}

// Assiette avec peu
export function IconAppetitPeu({ size }: IconProps) {
  return base(
    <>
      <ellipse cx="12" cy="16" rx="7" ry="2" />
      <path d="M5 16a7 7 0 0 1 14 0" />
      <path d="M9 6v5M11 6v5M9 8h2" />
      <path d="M15 6v3a2 2 0 0 1-2 2" />
      <path d="M12 11v2" strokeDasharray="1 2" />
    </>,
    size
  );
}

// Assiette vide avec X (refuse)
export function IconAppetitRefuse({ size }: IconProps) {
  return base(
    <>
      <ellipse cx="12" cy="17" rx="7" ry="2" />
      <path d="M5 17a7 7 0 0 1 14 0" />
      <path d="M9 10l6 6M15 10l-6 6" />
    </>,
    size
  );
}

// Bol avec vapeur (beaucoup)
export function IconAppetitBeaucoup({ size }: IconProps) {
  return base(
    <>
      <path d="M5 13h14" />
      <path d="M6 13a6 6 0 0 0 12 0" />
      <path d="M9 4c0 1.5-1.5 2-1.5 3.5S9 9 9 10.5M12 3c0 1.5-1.5 2-1.5 3.5S12 8 12 9.5M15 4c0 1.5-1.5 2-1.5 3.5S15 9 15 10.5" />
    </>,
    size
  );
}

/* ── HUMEUR ────────────────────────────────────────────── */

export function IconMoodTresBien({ size }: IconProps) {
  return base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 13s1.5 3 4 3 4-3 4-3" />
      <path d="M9 9h.01M15 9h.01" />
      <path d="M8.5 8.5c.5-1 2-1.5 3.5-.5M15.5 8.5c-.5-1-2-1.5-3.5-.5" />
    </>,
    size
  );
}

export function IconMoodBien({ size }: IconProps) {
  return base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14s1 2 3.5 2 3.5-2 3.5-2" />
      <path d="M9 9.5h.01M15 9.5h.01" />
    </>,
    size
  );
}

export function IconMoodDifficile({ size }: IconProps) {
  return base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 15.5h6" />
      <path d="M9.5 10h.01M14.5 10h.01" />
      <path d="M9 9.5c.5-.5 1.5-.5 2 0M13 9.5c.5-.5 1.5-.5 2 0" />
    </>,
    size
  );
}

export function IconMoodPleurs({ size }: IconProps) {
  return base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 15.5c.5-1.5 2-2.5 3.5-2.5s3 1 3.5 2.5" />
      <path d="M9.5 10h.01M14.5 10h.01" />
      <path d="M9 8.5c.5-.8 1.5-1 2.5-.5M13 8.5c.5-.8 1.5-1 2.5-.5" />
      <path d="M10 12.5c-.5 1-1 1.5-1 2.5M14 12.5c.5 1 1 1.5 1 2.5" />
    </>,
    size
  );
}
