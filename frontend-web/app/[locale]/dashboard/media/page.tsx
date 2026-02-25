"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { mediaApi, childrenApi, groupsApi } from "../../../../lib/api";
import {
  Upload, X, Globe, Users, Baby, Pencil, Trash2,
  Lock, ChevronLeft, ChevronRight, Download, CheckSquare, Square
} from "lucide-react";

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

type Visibility = "private" | "public" | "group" | "child";
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

function periodLabel(period: Period, date: Date, locale: string) {
  if (period === "day") return date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  if (period === "week") {
    // Monday of the week
    const day = date.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    const mon = addDays(date, diff);
    const sun = addDays(mon, 6);
    return `${mon.toLocaleDateString(locale, { day: "numeric", month: "short" })} – ${sun.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`;
  }
  return date.toLocaleDateString(locale, { month: "long", year: "numeric" });
}

export default function MediaPage() {
  const t = useTranslations("media");
  const tc = useTranslations("common");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);
  const [showUpload, setShowUpload] = useState(false);

  // Filters
  const [filterPeriod, setFilterPeriod] = useState<Period | "">("");
  const [filterDate, setFilterDate] = useState(new Date());
  const [filterGroupId, setFilterGroupId] = useState("");
  const [filterChildIds, setFilterChildIds] = useState<string[]>([]);

  // Edit state
  const [editItem, setEditItem] = useState<MediaItem | null>(null);
  const [editCaption, setEditCaption] = useState("");
  const [editVisibility, setEditVisibility] = useState<Visibility>("private");
  const [editGroupId, setEditGroupId] = useState("");
  const [editChildIds, setEditChildIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Lightbox state
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxEditOpen, setLightboxEditOpen] = useState(false);

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkVisibility, setBulkVisibility] = useState<Visibility>("private");
  const [bulkGroupId, setBulkGroupId] = useState("");
  const [bulkChildIds, setBulkChildIds] = useState<string[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Build SWR key based on filters
  const swrKey = JSON.stringify({
    group_id: filterGroupId || undefined,
    child_ids: filterChildIds.length ? filterChildIds.join(",") : undefined,
    period: filterPeriod || undefined,
    date: filterPeriod ? formatDateParam(filterDate) : undefined,
  });

  const { data, mutate } = useSWR(`media-list-${swrKey}`, () =>
    mediaApi.list({
      group_id: filterGroupId || undefined,
      child_ids: filterChildIds.length ? filterChildIds.join(",") : undefined,
      period: filterPeriod || undefined,
      date: filterPeriod ? formatDateParam(filterDate) : undefined,
    })
  );
  const { data: childrenData } = useSWR("children-media", () => childrenApi.list());
  const { data: groupsData } = useSWR("groups-media", () => groupsApi.list());

  const mediaItems: MediaItem[] = (data as { data: MediaItem[] } | undefined)?.data ?? [];
  const children: Child[] = (childrenData as { data: Child[] } | undefined)?.data ?? [];
  const groups: Group[] = (groupsData as { data: Group[] } | undefined)?.data ?? [];

  const childMap = Object.fromEntries(children.map((c) => [c.id, `${c.first_name} ${c.last_name}`]));
  const groupMap = Object.fromEntries(groups.map((g) => [g.id, g.name]));

  // Keyboard navigation for lightbox
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (lightboxIndex === null) return;
    if (e.key === "Escape") { setLightboxIndex(null); setLightboxEditOpen(false); }
    if (e.key === "ArrowRight") setLightboxIndex((i) => i !== null ? Math.min(i + 1, mediaItems.length - 1) : null);
    if (e.key === "ArrowLeft") setLightboxIndex((i) => i !== null ? Math.max(i - 1, 0) : null);
  }, [lightboxIndex, mediaItems.length]);

  // Swipe navigation for lightbox (mobile)
  const touchStartX = useRef<number>(0);
  const handleLightboxTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleLightboxTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) < 50) return;
    e.preventDefault();
    if (diff > 0) {
      setLightboxIndex((i) => i !== null ? Math.min(i + 1, mediaItems.length - 1) : null);
    } else {
      setLightboxIndex((i) => i !== null ? Math.max(i - 1, 0) : null);
    }
  };

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Reset selection when media list changes
  useEffect(() => { setSelected(new Set()); }, [swrKey]);

  const toggleSelectItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        if (caption) fd.append("caption", caption);
        fd.append("visibility", visibility);
        if (visibility === "group" && selectedGroupId) fd.append("group_id", selectedGroupId);
        if (visibility === "child") {
          selectedChildIds.forEach((id) => fd.append("child_ids[]", id));
        }
        await mediaApi.upload(fd);
      }
      setCaption("");
      setVisibility("private");
      setSelectedGroupId("");
      setSelectedChildIds([]);
      setShowUpload(false);
      mutate();
    } finally {
      setUploading(false);
    }
  };

  const openEdit = (item: MediaItem) => {
    setEditItem(item);
    setEditCaption(item.caption ?? "");
    setEditVisibility(item.visibility);
    setEditGroupId(item.group_id ?? "");
    setEditChildIds(item.child_ids ?? []);
    setLightboxEditOpen(false);
  };

  const openEditFromLightbox = () => {
    if (lightboxIndex === null) return;
    const item = mediaItems[lightboxIndex];
    openEdit(item);
    setLightboxEditOpen(true);
  };

  const handleSave = async () => {
    if (!editItem) return;
    setSaving(true);
    try {
      await mediaApi.update(editItem.id, {
        caption: editCaption || undefined,
        visibility: editVisibility,
        group_id: editVisibility === "group" ? editGroupId || undefined : undefined,
        child_ids: editVisibility === "child" ? editChildIds : [],
      });
      setEditItem(null);
      mutate();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await mediaApi.delete(deleteId);
      setDeleteId(null);
      setLightboxIndex(null);
      mutate();
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    setBulkLoading(true);
    try {
      await mediaApi.bulk({ action: "delete", media_ids: Array.from(selected) });
      setSelected(new Set());
      setBulkDeleteConfirm(false);
      mutate();
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkAssign = async () => {
    setBulkLoading(true);
    try {
      await mediaApi.bulk({
        action: "assign",
        media_ids: Array.from(selected),
        visibility: bulkVisibility,
        group_id: bulkVisibility === "group" ? bulkGroupId || undefined : undefined,
        child_ids: bulkVisibility === "child" ? bulkChildIds : [],
      });
      setSelected(new Set());
      setBulkAssignOpen(false);
      mutate();
    } finally {
      setBulkLoading(false);
    }
  };

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
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-slate-800">{t("title")}</h1>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
        >
          <Upload className="w-4 h-4" />
          {t("upload")}
        </button>
      </div>

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
              {periodLabel(filterPeriod, filterDate, "fr-CA")}
            </span>
            <button
              onClick={() => navigatePeriod(1)}
              className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Group filter */}
        <select
          value={filterGroupId}
          onChange={(e) => setFilterGroupId(e.target.value)}
          className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{t("allGroups")}</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>

        {/* Children multi-select */}
        <ChildMultiSelect
          children={children}
          selected={filterChildIds}
          onChange={setFilterChildIds}
          placeholder={t("allChildren")}
        />

        {(filterPeriod || filterGroupId || filterChildIds.length > 0) && (
          <button
            onClick={() => { setFilterPeriod(""); setFilterGroupId(""); setFilterChildIds([]); setFilterDate(new Date()); }}
            className="text-xs text-slate-400 hover:text-slate-600 underline"
          >
            {tc("reset")}
          </button>
        )}
      </div>

      {/* Upload panel */}
      {showUpload && (
        <div className="mb-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-slate-800">{t("upload")}</h2>
            <button onClick={() => setShowUpload(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <input
            type="text"
            placeholder={t("caption")}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <VisibilitySelector value={visibility} onChange={setVisibility} />

          {visibility === "group" && (
            <select
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t("chooseGroup")}</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}

          {visibility === "child" && (
            <ChildMultiSelect
              children={children}
              selected={selectedChildIds}
              onChange={setSelectedChildIds}
              placeholder={t("chooseChild")}
            />
          )}

          <div
            className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 transition"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm text-slate-500">{t("dropzone")}</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,.mp4,.mov,.avi"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
          {uploading && <p className="text-sm text-blue-600">{tc("loading")}</p>}
        </div>
      )}

      {/* Gallery */}
      {mediaItems.length === 0 ? (
        <div className="text-center py-16 text-slate-400"><p>{t("noMedia")}</p></div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {mediaItems.map((item, idx) => (
            <MediaCard
              key={item.id}
              item={item}
              childMap={childMap}
              groupMap={groupMap}
              selected={selected.has(item.id)}
              onToggleSelect={(e) => toggleSelectItem(item.id, e)}
              onEdit={() => openEdit(item)}
              onDelete={() => setDeleteId(item.id)}
              onClick={() => setLightboxIndex(idx)}
            />
          ))}
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900 text-white py-3 px-6 flex items-center gap-3 shadow-xl">
          <span className="text-sm font-medium mr-2">{t("nSelected", { n: selected.size })}</span>
          <button
            onClick={() => setBulkDeleteConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-lg text-xs font-medium transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {tc("delete")}
          </button>
          {(["private", "public", "group", "child"] as Visibility[]).map((v) => (
            <button
              key={v}
              onClick={() => {
                if (v === "group" || v === "child") {
                  setBulkVisibility(v);
                  setBulkGroupId("");
                  setBulkChildIds([]);
                  setBulkAssignOpen(true);
                } else {
                  setBulkVisibility(v);
                  mediaApi.bulk({ action: "assign", media_ids: Array.from(selected), visibility: v }).then(() => { setSelected(new Set()); mutate(); });
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium transition"
            >
              <VisibilityIcon visibility={v} />
              {visibilityLabel(v, tc, t)}
            </button>
          ))}
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto px-3 py-1.5 text-xs text-slate-400 hover:text-white transition"
          >
            {tc("cancel")}
          </button>
        </div>
      )}

      {/* Lightbox */}
      {lightboxItem && lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => { setLightboxIndex(null); setLightboxEditOpen(false); }}
          onTouchStart={handleLightboxTouchStart}
          onTouchEnd={handleLightboxTouchEnd}
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
          <div className="relative max-w-4xl max-h-screen w-full flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
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

            {/* Caption & meta */}
            {(lightboxItem.caption || lightboxItem.visibility) && (
              <div className="mt-3 text-center">
                {lightboxItem.caption && <p className="text-white text-sm">{lightboxItem.caption}</p>}
                <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-xs bg-white/10 text-white/70">
                  <VisibilityIcon visibility={lightboxItem.visibility} />
                  {visibilityLabelFull(lightboxItem, childMap, groupMap, tc, t)}
                </span>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 mt-4">
              <a
                href={`${API_URL}/media/files/${lightboxItem.storage_path}?download=1`}
                download
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-xs font-medium transition"
              >
                <Download className="w-4 h-4" />
                {t("download")}
              </a>
              <button
                onClick={openEditFromLightbox}
                className="flex items-center gap-1.5 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-xs font-medium transition"
              >
                <Pencil className="w-4 h-4" />
                {tc("edit")}
              </button>
              <button
                onClick={() => { setDeleteId(lightboxItem.id); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-600/80 hover:bg-red-600 rounded-lg text-white text-xs font-medium transition"
              >
                <Trash2 className="w-4 h-4" />
                {tc("delete")}
              </button>
            </div>
          </div>

          {/* Close */}
          <button
            onClick={() => { setLightboxIndex(null); setLightboxEditOpen(false); }}
            className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Edit Modal */}
      {editItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">{t("editMedia")}</h2>
              <button onClick={() => setEditItem(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <input
              type="text"
              value={editCaption}
              onChange={(e) => setEditCaption(e.target.value)}
              placeholder={t("captionOptional")}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <VisibilitySelector value={editVisibility} onChange={setEditVisibility} />

            {editVisibility === "group" && (
              <select
                value={editGroupId}
                onChange={(e) => setEditGroupId(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t("chooseGroup")}</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}

            {editVisibility === "child" && (
              <ChildMultiSelect
                children={children}
                selected={editChildIds}
                onChange={setEditChildIds}
                placeholder={t("chooseChild")}
              />
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setEditItem(null)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition"
              >
                {tc("cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {saving ? tc("saving") : tc("save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-slate-800">{t("deleteConfirm")}</h2>
            <p className="text-sm text-slate-500">{t("deleteWarning")}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition"
              >
                {tc("cancel")}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition"
              >
                {deleting ? tc("deleting") : tc("delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete confirmation */}
      {bulkDeleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="font-semibold text-slate-800">{t("bulkDeleteConfirm", { n: selected.size })}</h2>
            <p className="text-sm text-slate-500">{t("deleteWarning")}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setBulkDeleteConfirm(false)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition"
              >
                {tc("cancel")}
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkLoading}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition"
              >
                {bulkLoading ? tc("deleting") : tc("delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk assign modal */}
      {bulkAssignOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">{t("assign")}</h2>
              <button onClick={() => setBulkAssignOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            {bulkVisibility === "group" && (
              <select
                value={bulkGroupId}
                onChange={(e) => setBulkGroupId(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t("chooseGroup")}</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
            {bulkVisibility === "child" && (
              <ChildMultiSelect
                children={children}
                selected={bulkChildIds}
                onChange={setBulkChildIds}
                placeholder={t("chooseChild")}
              />
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setBulkAssignOpen(false)}
                className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition"
              >
                {tc("cancel")}
              </button>
              <button
                onClick={handleBulkAssign}
                disabled={bulkLoading}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {bulkLoading ? tc("saving") : tc("confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Helpers ----

function visibilityLabel(v: Visibility, tc: (k: string) => string, t: (k: string) => string) {
  if (v === "private") return t("private");
  if (v === "public") return tc("visPublic");
  if (v === "group") return tc("visGroup");
  return tc("visChild");
}

function visibilityLabelFull(
  item: MediaItem,
  childMap: Record<string, string>,
  groupMap: Record<string, string>,
  tc: (k: string) => string,
  t: (k: string) => string
) {
  if (item.visibility === "private") return t("private");
  if (item.visibility === "public") return tc("visPublic");
  if (item.visibility === "group") return groupMap[item.group_id ?? ""] ?? tc("visGroup");
  if (item.visibility === "child") {
    const names = (item.child_ids ?? []).map((id) => childMap[id]).filter(Boolean);
    return names.length ? names.join(", ") : tc("visChild");
  }
  return "";
}

function VisibilityIcon({ visibility }: { visibility: Visibility }) {
  if (visibility === "private") return <Lock className="w-3.5 h-3.5" />;
  if (visibility === "public") return <Globe className="w-3.5 h-3.5" />;
  if (visibility === "group") return <Users className="w-3.5 h-3.5" />;
  return <Baby className="w-3.5 h-3.5" />;
}

function VisibilitySelector({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  const tc = useTranslations("common");
  const t = useTranslations("media");
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1.5">{tc("visibility")}</label>
      <div className="flex gap-2 flex-wrap">
        {(["private", "public", "group", "child"] as Visibility[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition ${
              value === v
                ? "bg-blue-600 text-white border-blue-600"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <VisibilityIcon visibility={v} />
            {visibilityLabel(v, tc, t)}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChildMultiSelect({
  children,
  selected,
  onChange,
  placeholder,
}: {
  children: Child[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const label = selected.length === 0
    ? placeholder
    : children.filter((c) => selected.includes(c.id)).map((c) => c.first_name).join(", ");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 hover:bg-slate-50 transition min-w-32 max-w-48"
      >
        <Baby className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="truncate">{label}</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 min-w-48 max-h-64 overflow-y-auto">
          {children.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-400">—</div>
          )}
          {children.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer"
            >
              <div className="shrink-0">
                {selected.includes(c.id)
                  ? <CheckSquare className="w-4 h-4 text-blue-600" />
                  : <Square className="w-4 h-4 text-slate-300" />}
              </div>
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={() => toggle(c.id)}
                className="hidden"
              />
              <span className="text-xs text-slate-700">{c.first_name} {c.last_name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function MediaCard({
  item,
  childMap,
  groupMap,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
  onClick,
}: {
  item: MediaItem;
  childMap: Record<string, string>;
  groupMap: Record<string, string>;
  selected: boolean;
  onToggleSelect: (e: React.MouseEvent) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
}) {
  const t = useTranslations("media");
  const tc = useTranslations("common");
  const thumb = item.thumbnail_path ? `${API_URL}/media/files/${item.thumbnail_path}` : null;

  const badge = (() => {
    if (item.visibility === "private") return { color: "bg-slate-100 text-slate-600", icon: <Lock className="w-3 h-3" />, label: t("private") };
    if (item.visibility === "public") return { color: "bg-green-100 text-green-700", icon: <Globe className="w-3 h-3" />, label: tc("visPublic") };
    if (item.visibility === "group") return { color: "bg-blue-100 text-blue-700", icon: <Users className="w-3 h-3" />, label: groupMap[item.group_id ?? ""] ?? tc("visGroup") };
    const names = (item.child_ids ?? []).map((id) => childMap[id]).filter(Boolean);
    return { color: "bg-orange-100 text-orange-700", icon: <Baby className="w-3 h-3" />, label: names.length ? names.join(", ") : tc("visChild") };
  })();

  return (
    <div
      className={`bg-white rounded-xl border overflow-hidden group cursor-pointer transition ${
        selected ? "border-blue-500 ring-2 ring-blue-300" : "border-slate-200 hover:shadow-md"
      }`}
      onClick={onClick}
    >
      <div className="aspect-square bg-slate-100 relative">
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

        {/* Checkbox */}
        <button
          onClick={onToggleSelect}
          className={`absolute top-2 left-2 z-10 transition ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        >
          {selected
            ? <CheckSquare className="w-5 h-5 text-blue-600 drop-shadow" />
            : <Square className="w-5 h-5 text-white drop-shadow" />}
        </button>

        {/* Visibility badge */}
        <div className="absolute bottom-2 left-2">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium ${badge.color}`}>
            {badge.icon}
            <span className="hidden group-hover:inline max-w-24 truncate">{badge.label}</span>
          </span>
        </div>

        {/* Action buttons */}
        <div className="absolute top-2 right-2 hidden group-hover:flex gap-1 z-10">
          <a
            href={`${API_URL}/media/files/${item.storage_path}?download=1`}
            download={item.original_filename}
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 bg-white/90 rounded-lg text-slate-600 hover:text-blue-600 shadow-sm transition"
            title={t("download")}
          >
            <Download className="w-3.5 h-3.5" />
          </a>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="p-1.5 bg-white/90 rounded-lg text-slate-600 hover:text-blue-600 shadow-sm transition"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1.5 bg-white/90 rounded-lg text-slate-600 hover:text-red-600 shadow-sm transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {item.caption && (
        <div className="px-3 py-2">
          <p className="text-xs text-slate-600 line-clamp-2">{item.caption}</p>
        </div>
      )}
    </div>
  );
}
