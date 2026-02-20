"use client";

import { usePathname, useRouter } from "next/navigation";

const LOCALES = ["fr", "en"] as const;

export function LanguageSwitcher() {
  const pathname = usePathname();
  const router = useRouter();

  const currentLocale = pathname.split("/")[1] || "fr";

  const switchLocale = (locale: string) => {
    if (locale === currentLocale) return;
    const segments = pathname.split("/");
    segments[1] = locale;
    document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=${365 * 24 * 60 * 60}`;
    router.push(segments.join("/"));
  };

  return (
    <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
      {LOCALES.map((locale) => (
        <button
          key={locale}
          onClick={() => switchLocale(locale)}
          className={`px-2.5 py-1 text-xs font-semibold rounded-md transition ${
            currentLocale === locale
              ? "bg-white text-slate-800 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {locale.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
