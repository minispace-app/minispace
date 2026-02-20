"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { mediaApi, childrenApi, groupsApi } from "../../../../lib/api";
import { ChevronLeft, ChevronRight, Download, X, Globe, Users, Baby, Lock } from "lucide-react";

interface MediaItem {
  id: string;
  original_filename: string;
  storage_path: string;
  thumbnail_path: string | null;
  media_type: "photo" | "video";
  caption: string | null;
  group_id: string | null;
  child_id: string | null;
  child_ids: string[];
  visibility: "private" | "public" | "group" | "child";
  created_at: string;
}

interface Child { id: string; first_name: string; last_name: string; }
interface Group { id: string; name: string; }

type Period = "day" | "week" | "month";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost/api";

function formatDateParam(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function addMonths(d: Date, n: number) {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

function periodLabel(period: Period, date: Date) {
  if (period === "day") return date.toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long" });
  if (period === "week") {
    const day = date.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    const mon = addDays(date, diff);
    const sun = addDays(mon, 6);
    return `${mon.toLocaleDateString("fr-CA", { day: "numeric", month: "short" })} – ${sun.toLocaleDateString("fr-CA", { day: "numeric", month: "short", year: "numeric" })}`;
  }
  return date.toLocaleDateString("fr-CA", { month: "long", year: "numeric" });
}

export default function ParentMediaPage() {
  const t = useTranslations("media");
  const tc = useTranslations("common");

  const [filterPeriod, setFilterPeriod] = useState<Period | "">("");
  const [filterDate, setFilterDate] = useState(new Date());
  const [filterGroupId, setFilterGroupId] = useState("");
  const [filterChildId, setFilterChildId] = useState("");

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const swrKey = JSON.stringify({
    group_id: filterGroupId || undefined,
    child_ids: filterChildId || undefined,
    period: filterPeriod || undefined,
    date: filterPeriod ? formatDateParam(filterDate) : undefined,
  });

  const { data } = useSWR(`media-list-parent-${swrKey}`, () =>
    mediaApi.list({
      group_id: filterGroupId || undefined,
      child_ids: filterChildId || undefined,
      period: filterPeriod || undefined,
      date: filterPeriod ? formatDateParam(filterDate) : undefined,
    })
  );
  const { data: childrenData } = useSWR("children-parent-media", () => childrenApi.list());
  const { data: groupsData } = useSWR("groups-parent-media", () => groupsApi.list());

  const mediaItems: MediaItem[] = (data as { data: MediaItem[] } | undefined)?.data ?? [];
  const children: Child[] = (childrenData as { data: Child[] } | undefined)?.data ?? [];
  const groups: Group[] = (groupsData as { data: Group[] } | undefined)?.data ?? [];

  const childMap = Object.fromEntries(children.map((c) => [c.id, `${c.first_name} ${c.last_name}`]));
  const groupMap = Object.fromEntries(groups.map((g) => [g.id, g.name]));

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (lightboxIndex === null) return;
    if (e.key === "Escape") setLightboxIndex(null);
    if (e.key === "ArrowRight") setLightboxIndex((i) => i !== null ? Math.min(i + 1, mediaItems.length - 1) : null);
    if (e.key === "ArrowLeft") setLightboxIndex((i) => i !== null ? Math.max(i - 1, 0) : null);
  }, [lightboxIndex, mediaItems.length]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const navigatePeriod = (dir: 1 | -1) => {
    setFilterDate((d) => {
      if (filterPeriod === "day") return addDays(d, dir);
      if (filterPeriod === "week") return addDays(d, dir * 7);
      if (filterPeriod === "month") return addMonths(d, dir);
      return d;
    });
  };

  const lightboxItem = lightboxIndex !== null ? mediaItems[lightboxIndex] : null;

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-slate-800 mb-5">{t("title")}</h1>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-5 p-3 bg-white border border-slate-200 rounded-xl">
        {/* Period buttons */}
        <div className="flex gap-1">
          {(["day", "week", "month"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => { setFilterPeriod(filterPeriod === p ? "" : p); setFilterDate(new Date()); }}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium border transition ${
                filterPeriod === p
                  ? "bg-blue-600 text-white border-blue-600"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {t(p)}
            </button>
          ))}
        </div>

        {/* Date navigation */}
        {filterPeriod && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigatePeriod(-1)}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-medium text-slate-700 px-2 min-w-40 text-center">
              {periodLabel(filterPeriod, filterDate)}
            </span>
            <button
              onClick={() => navigatePeriod(1)}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* My children filter */}
        {children.length > 0 && (
          <select
            value={filterChildId}
            onChange={(e) => setFilterChildId(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t("allChildren")}</option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
            ))}
          </select>
        )}

        {/* Group filter */}
        {groups.length > 0 && (
          <select
            value={filterGroupId}
            onChange={(e) => setFilterGroupId(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{t("allGroups")}</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}

        {(filterPeriod || filterGroupId || filterChildId) && (
          <button
            onClick={() => { setFilterPeriod(""); setFilterGroupId(""); setFilterChildId(""); setFilterDate(new Date()); }}
            className="text-xs text-slate-400 hover:text-slate-600 underline"
          >
            {tc("reset")}
          </button>
        )}
      </div>

      {/* Gallery */}
      {mediaItems.length === 0 ? (
        <div className="text-center py-16 text-slate-400"><p>{t("noMedia")}</p></div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {mediaItems.map((item, idx) => (
            <ParentMediaCard
              key={item.id}
              item={item}
              childMap={childMap}
              groupMap={groupMap}
              onClick={() => setLightboxIndex(idx)}
            />
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightboxItem && lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxIndex(null)}
        >
          {/* Prev */}
          {lightboxIndex > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex - 1); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white transition"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}
          {/* Next */}
          {lightboxIndex < mediaItems.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex + 1); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white transition"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}

          {/* Content */}
          <div
            className="relative max-w-4xl max-h-screen w-full flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {lightboxItem.media_type === "video" ? (
              <video
                src={`${API_URL}/media/files/${lightboxItem.storage_path}`}
                controls
                className="max-h-[80vh] max-w-full rounded-lg"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${API_URL}/media/files/${lightboxItem.storage_path}`}
                alt={lightboxItem.caption || lightboxItem.original_filename}
                className="max-h-[80vh] max-w-full object-contain rounded-lg"
              />
            )}

            {lightboxItem.caption && (
              <p className="mt-3 text-white text-sm text-center">{lightboxItem.caption}</p>
            )}

            {/* Download button */}
            <a
              href={`${API_URL}/media/files/${lightboxItem.storage_path}?download=1`}
              download
              onClick={(e) => e.stopPropagation()}
              className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm font-medium transition"
            >
              <Download className="w-4 h-4" />
              {t("download")}
            </a>
          </div>

          {/* Close */}
          <button
            onClick={() => setLightboxIndex(null)}
            className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}

function ParentMediaCard({
  item,
  childMap,
  groupMap,
  onClick,
}: {
  item: MediaItem;
  childMap: Record<string, string>;
  groupMap: Record<string, string>;
  onClick: () => void;
}) {
  const tc = useTranslations("common");
  const t = useTranslations("media");
  const thumb = item.thumbnail_path ? `${API_URL}/media/files/${item.thumbnail_path}` : null;
  const src = `${API_URL}/media/files/${item.storage_path}`;

  const badge = (() => {
    if (item.visibility === "private") return { color: "bg-slate-100 text-slate-600", icon: <Lock className="w-3 h-3" />, label: t("private") };
    if (item.visibility === "public") return { color: "bg-green-100 text-green-700", icon: <Globe className="w-3 h-3" />, label: tc("visPublic") };
    if (item.visibility === "group") return { color: "bg-blue-100 text-blue-700", icon: <Users className="w-3 h-3" />, label: groupMap[item.group_id ?? ""] ?? tc("visGroup") };
    const names = (item.child_ids ?? []).map((id) => childMap[id]).filter(Boolean);
    return { color: "bg-orange-100 text-orange-700", icon: <Baby className="w-3 h-3" />, label: names.length ? names.join(", ") : tc("visChild") };
  })();

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden group hover:shadow-md transition">
      {/* Clickable image area → opens lightbox */}
      <div
        className="aspect-square bg-slate-100 relative cursor-pointer"
        onClick={onClick}
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt={item.caption || item.original_filename} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400 text-3xl">
            {item.media_type === "video" ? "🎬" : "🖼"}
          </div>
        )}
        {item.media_type === "video" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
              <span className="text-white text-lg">▶</span>
            </div>
          </div>
        )}
        {/* Visibility badge */}
        <div className="absolute bottom-2 left-2">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium ${badge.color}`}>
            {badge.icon}
            <span className="hidden group-hover:inline max-w-24 truncate">{badge.label}</span>
          </span>
        </div>
        {/* Download button — hover, top-right */}
        <a
          href={`${src}?download=1`}
          download={item.original_filename}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 right-2 hidden group-hover:flex items-center gap-1 p-1.5 bg-white/90 rounded-lg text-slate-600 hover:text-blue-600 shadow-sm transition text-xs font-medium"
          title={t("download")}
        >
          <Download className="w-3.5 h-3.5" />
        </a>
      </div>
      {item.caption && (
        <div className="px-3 py-2">
          <p className="text-xs text-slate-600 line-clamp-2">{item.caption}</p>
        </div>
      )}
    </div>
  );
}
