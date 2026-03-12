"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { activitiesApi, menusApi, groupsApi } from "../../../../lib/api";
import { useAuth } from "../../../../hooks/useAuth";
import { ChevronLeft, ChevronRight, Edit2, Trash2, Plus, X, Loader2, Check, UtensilsCrossed, PartyPopper, Download } from "lucide-react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { format, parse, startOfMonth, endOfMonth, addMonths, subMonths, getISODay, startOfWeek, eachDayOfInterval, isToday as isDateToday, isSameMonth, isSameDay } from "date-fns";
import { fr } from "date-fns/locale";
import { TextareaField } from "../../../../components/journal/TextareaField";
import { WEEK_DAYS } from "../../../../components/journal/journalTypes";
import { getMonday, formatDate, addDays } from "../../../../components/journal/journalUtils";
import { getTodayInMontreal, formatDateInMontreal } from "../../../../lib/dateUtils";
import { useTenantInfo } from "../../../../hooks/useTenantInfo";

interface DailyMenuData {
  id?: string;
  date: string;
  menu?: string;
  collation_matin?: string;
  diner?: string;
  collation_apres_midi?: string;
}

interface Activity {
  id: string;
  title: string;
  description?: string;
  date: string;
  end_date?: string;
  capacity?: number;
  group_id?: string;
  type?: "theme" | "sortie";
  registration_count?: number;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-pill text-body font-medium transition-all duration-[180ms] ease-out ${
        active
          ? "bg-ink text-white shadow-soft"
          : "text-ink-secondary hover:text-ink hover:bg-surface-soft"
      }`}
    >
      {children}
    </button>
  );
}

function MenusSection() {
  const t = useTranslations("menus");
  const tj = useTranslations("journal");
  const tc = useTranslations("calendar");
  const { name: garderieName, logo_url: garderieLogoUrl } = useTenantInfo();

  const todayInMontreal = getTodayInMontreal();
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(todayInMontreal));
  const [currentMonth, setCurrentMonth] = useState<Date>(todayInMontreal);
  const [selectedDate, setSelectedDate] = useState<Date>(todayInMontreal);
  const [localData, setLocalData] = useState<Record<string, Partial<DailyMenuData>>>({});
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [activeDayIndex, setActiveDayIndex] = useState<number>(() => {
    const dayOfWeek = getISODay(todayInMontreal); // 1=Monday, 7=Sunday
    return Math.min(Math.max(dayOfWeek - 1, 0), 4); // Clamp to 0-4
  });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Menu sections configuration
  const menuSections = [
    { key: "collation_matin" as const, tKey: "sectionMatin" },
    { key: "diner" as const, tKey: "sectionDiner" },
    { key: "collation_apres_midi" as const, tKey: "sectionSoir" },
  ];

  const weekDates = WEEK_DAYS.map((_, i) => addDays(weekStart, i));
  const weekStartStr = formatDate(weekStart);
  const today = formatDateInMontreal(getTodayInMontreal());

  const { data: menusData, mutate } = useSWR(["menus-week-planning", weekStartStr], () =>
    menusApi.getWeek(weekStartStr)
  );

  const serverMenus: DailyMenuData[] =
    (menusData as { data: DailyMenuData[] } | undefined)?.data ?? [];

  const getMenuForDate = (dateStr: string, section: "collation_matin" | "diner" | "collation_apres_midi"): string => {
    if (localData[dateStr]?.[section] !== undefined) return localData[dateStr][section] ?? "";
    return serverMenus.find((m) => m.date === dateStr)?.[section] ?? "";
  };

  const updateMenu = (dateStr: string, section: "collation_matin" | "diner" | "collation_apres_midi", value: string) => {
    setLocalData((prev) => ({
      ...prev,
      [dateStr]: { ...prev[dateStr], [section]: value },
    }));
  };

  // Auto-save debounce
  useEffect(() => {
    if (Object.keys(localData).length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (Object.keys(localData).length === 0) return;
      setSaveStatus("saving");
      try {
        await Promise.all(
          Object.entries(localData).map(([dateStr, sections]) =>
            menusApi.upsert({
              date: dateStr,
              collation_matin: sections.collation_matin,
              diner: sections.diner,
              collation_apres_midi: sections.collation_apres_midi,
            })
          )
        );
        setLocalData({});
        mutate();
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("idle");
      }
    }, 1500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localData]);

  const prevWeek = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setLocalData({});
    setSaveStatus("idle");
    const newWeekStart = addDays(weekStart, -7);
    setWeekStart(newWeekStart);
    setSelectedDate(newWeekStart); // Update calendar too
  };

  const nextWeek = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setLocalData({});
    setSaveStatus("idle");
    const newWeekStart = addDays(weekStart, 7);
    setWeekStart(newWeekStart);
    setSelectedDate(newWeekStart); // Update calendar too
  };

  const handleSelectWeek = (date: Date) => {
    // Select Monday of that week
    const monday = getMonday(date);
    setSelectedDate(monday);
    if (!isSameDay(monday, weekStart)) {
      setWeekStart(monday);
    }
  };

  // Check if a date is in the selected week (Monday-Friday only)
  const isInSelectedWeek = (date: Date) => {
    const dateMonday = getMonday(date);
    const selectedMonday = getMonday(selectedDate);
    const dayOfWeek = getISODay(date); // 1=Mon, 7=Sun
    // Only Mon-Fri (1-5)
    return isSameDay(dateMonday, selectedMonday) && dayOfWeek >= 1 && dayOfWeek <= 5;
  };

  const prevMonth = () => {
    setCurrentMonth(subMonths(currentMonth, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  // Get calendar days (including overflow from prev/next month)
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = startOfWeek(monthEnd);
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: monthEnd });

  // Export month to PDF
  const [pdfExporting, setPdfExporting] = useState(false);

  const exportMonthToPDF = async () => {
    setPdfExporting(true);

    try {
      // 1. Fetch all week data for the month
      const mondayDates: string[] = [];
      let monday = getMonday(monthStart);
      while (monday <= monthEnd) {
        mondayDates.push(formatDate(monday));
        monday = addDays(monday, 7);
      }
      const allResponses = await Promise.all(mondayDates.map((d) => menusApi.getWeek(d)));
      const allMenus: DailyMenuData[] = allResponses.flatMap((r) => (r as any).data ?? []);

      const getMonthMenu = (dateStr: string, section: "collation_matin" | "diner" | "collation_apres_midi") =>
        allMenus.find((m) => m.date === dateStr)?.[section] ?? "";

      // 2. Convert logo to base64 (tenant logo or fallback to /logo.png)
      const fetchToBase64 = async (url: string): Promise<string> => {
        const res = await fetch(url);
        const blob = await res.blob();
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      };
      let logoBase64 = "";
      try {
        logoBase64 = await fetchToBase64(garderieLogoUrl || "/logo.png");
      } catch { /* skip logo if fetch fails */ }

      // 3. Build HTML for PDF
      const monthLabel = format(currentMonth, "MMMM yyyy", { locale: fr });
      const exportDate = format(new Date(), "d MMMM yyyy", { locale: fr });
      const dayColors = ["#6366f1","#0ea5e9","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899"];

      const dayCells = calendarDays.map((date) => {
        const dateStr = formatDate(date);
        const inMonth = isSameMonth(date, currentMonth);
        const isWeekend = getISODay(date) >= 6;
        const matin = inMonth ? getMonthMenu(dateStr, "collation_matin") : "";
        const diner = inMonth ? getMonthMenu(dateStr, "diner") : "";
        const soir  = inMonth ? getMonthMenu(dateStr, "collation_apres_midi") : "";
        const bg = !inMonth ? "#f8fafc" : isWeekend ? "#f1f5f9" : "#ffffff";
        const numColor = !inMonth ? "#cbd5e1" : isWeekend ? "#94a3b8" : "#1e293b";

        return `
          <div style="background:${bg};padding:5px;min-height:72px;border:1px solid #e2e8f0;overflow:hidden;">
            <div style="font-size:11px;font-weight:700;color:${numColor};margin-bottom:4px;">${date.getDate()}</div>
            ${matin ? `<div style="font-size:8px;color:#0369a1;white-space:pre-wrap;margin-bottom:2px;line-height:1.3;"><span style="font-weight:600;">M·</span>${matin}</div>` : ""}
            ${diner ? `<div style="font-size:8px;color:#15803d;white-space:pre-wrap;margin-bottom:2px;line-height:1.3;"><span style="font-weight:600;">D·</span>${diner}</div>` : ""}
            ${soir  ? `<div style="font-size:8px;color:#7e22ce;white-space:pre-wrap;line-height:1.3;"><span style="font-weight:600;">S·</span>${soir}</div>` : ""}
          </div>`;
      }).join("");

      const html = `
        <div style="width:277mm;padding:8mm 8mm 6mm;font-family:Arial,sans-serif;background:#fff;box-sizing:border-box;">
          <!-- Header -->
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:8mm;border-bottom:2px solid #e2e8f0;padding-bottom:5mm;">
            ${logoBase64 ? `<img src="${logoBase64}" style="height:52px;width:auto;object-fit:contain;" />` : ""}
            <div>
              <div style="font-size:18px;font-weight:700;color:#1e293b;">${garderieName || "minispace.app"}</div>
              <div style="font-size:13px;color:#475569;margin-top:2px;">Menus — ${monthLabel}</div>
            </div>
            <div style="margin-left:auto;text-align:right;font-size:10px;color:#94a3b8;">
              <div>Exporté le</div>
              <div style="font-weight:600;color:#64748b;">${exportDate}</div>
            </div>
          </div>

          <!-- Legend -->
          <div style="display:flex;gap:16px;margin-bottom:4mm;font-size:9px;color:#64748b;">
            <span><span style="color:#0369a1;font-weight:600;">M·</span> Collation matin</span>
            <span><span style="color:#15803d;font-weight:600;">D·</span> Dîner</span>
            <span><span style="color:#7e22ce;font-weight:600;">S·</span> Collation après-midi</span>
          </div>

          <!-- Calendar grid -->
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;">
            ${["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"].map((d, i) => `
              <div style="background:#1e293b;color:#fff;text-align:center;padding:5px;font-size:10px;font-weight:700;">${d}</div>
            `).join("")}
            ${dayCells}
          </div>
        </div>`;

      // 4. Render and export
      const wrapper = document.createElement("div");
      wrapper.innerHTML = html;
      wrapper.style.position = "fixed";
      wrapper.style.top = "-9999px";
      wrapper.style.left = "-9999px";
      document.body.appendChild(wrapper);

      const canvas = await html2canvas(wrapper.firstElementChild as HTMLElement, { scale: 2, useCORS: true, logging: false });
      document.body.removeChild(wrapper);

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("l", "mm", "a4");
      const imgWidth = 297; // A4 landscape width
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
      pdf.save(`Menus_${format(currentMonth, "MMMM_yyyy", { locale: fr })}.pdf`);
    } catch (error) {
      console.error("PDF export error:", error);
    } finally {
      setPdfExporting(false);
    }
  };

  function SaveIndicator() {
    if (saveStatus === "saving")
      return (
        <span className="text-caption text-ink-muted flex items-center gap-1">
          <Loader2 size={12} strokeWidth={1.5} className="animate-spin" /> Enregistrement...
        </span>
      );
    if (saveStatus === "saved")
      return (
        <span className="text-caption text-status-success flex items-center gap-1">
          <Check size={12} strokeWidth={1.5} /> Enregistré
        </span>
      );
    return null;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Mobile: Week nav + Day chips + single day view */}
      <div className="md:hidden flex-1 overflow-auto flex flex-col">
        {/* Week navigation */}
        <div className="flex-shrink-0 px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          <button
            onClick={() => { setWeekStart(addDays(weekStart, -7)); setActiveDayIndex(0); }}
            className="p-1.5 rounded-lg bg-white/70 backdrop-blur-sm border border-border-soft shadow-soft hover:bg-white/90 transition-all duration-[180ms]"
          >
            <ChevronLeft className="w-4 h-4 text-ink-secondary" />
          </button>
          <span className="text-body font-medium text-ink whitespace-nowrap">
            {weekDates[0].toLocaleDateString("fr-CA", { day: "numeric", month: "short" })}
            {" – "}
            {weekDates[4].toLocaleDateString("fr-CA", { day: "numeric", month: "short", year: "numeric" })}
          </span>
          <button
            onClick={() => { setWeekStart(addDays(weekStart, 7)); setActiveDayIndex(0); }}
            className="p-1.5 rounded-lg bg-white/70 backdrop-blur-sm border border-border-soft shadow-soft hover:bg-white/90 transition-all duration-[180ms]"
          >
            <ChevronRight className="w-4 h-4 text-ink-secondary" />
          </button>
        </div>

        {/* Day chips */}
        <div className="flex-shrink-0 px-4 pb-3">
          <div className="flex gap-2 overflow-x-auto scrollbar-none">
            {weekDates.map((date, i) => {
              const dateStr = formatDate(date);
              const isToday = dateStr === today;
              const isActive = i === activeDayIndex;
              return (
                <button
                  key={dateStr}
                  onClick={() => setActiveDayIndex(i)}
                  className={`flex-shrink-0 px-4 py-1.5 rounded-pill font-medium text-body transition-all duration-[180ms] whitespace-nowrap ${
                    isActive
                      ? "bg-ink text-white shadow-soft"
                      : isToday
                      ? "bg-accent-yellow/40 text-ink"
                      : "bg-surface-soft text-ink-secondary hover:bg-border-soft"
                  }`}
                >
                  {tj(`days.${WEEK_DAYS[i]}`).substring(0, 3)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active day content */}
        <div className="flex-1 overflow-auto px-4 py-4">
          {(() => {
            const date = weekDates[activeDayIndex];
            const dateStr = formatDate(date);
            const isToday = dateStr === today;
            const hasLocal = localData[dateStr] !== undefined;
            return (
              <div className={`bg-surface-card rounded-xl shadow-card p-4 ${isToday ? "ring-2 ring-accent-yellow/60" : ""}`}>
                <div className={`text-caption font-semibold uppercase tracking-wide mb-0.5 ${isToday ? "text-ink" : "text-ink-muted"}`}>
                  {tj(`days.${WEEK_DAYS[activeDayIndex]}`)}
                </div>
                <div className="text-body font-medium mb-4 flex items-center gap-1.5 text-ink">
                  {date.toLocaleDateString("fr-CA", { day: "numeric", month: "short" })}
                  {hasLocal && <span className="w-1.5 h-1.5 rounded-pill bg-accent-orange flex-shrink-0" />}
                </div>
                <div className="space-y-4">
                  {menuSections.map((section) => (
                    <div key={section.key} className="flex flex-col">
                      <label className="text-caption font-semibold text-ink-secondary mb-2">{t(section.tKey)}</label>
                      <TextareaField
                        value={getMenuForDate(dateStr, section.key)}
                        onChange={(v) => updateMenu(dateStr, section.key, v)}
                        placeholder={t("placeholder")}
                        rows={3}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Desktop: Mini Calendar + Week Grid */}
      <div className="hidden md:flex flex-1 overflow-hidden gap-4 px-6 py-4">
        {/* Sidebar: Mini Calendar */}
        <div className="flex flex-col flex-shrink-0 w-48 bg-surface-card shadow-soft rounded-xl p-3">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-3">
            <button onClick={prevMonth} className="w-6 h-6 flex items-center justify-center hover:bg-surface-soft rounded-pill transition-all duration-[180ms]">
              <ChevronLeft size={12} strokeWidth={2} className="text-ink-secondary" />
            </button>
            <h3 className="text-caption font-semibold text-ink">
              {format(currentMonth, "MMMM yyyy", { locale: fr })}
            </h3>
            <button onClick={nextMonth} className="w-6 h-6 flex items-center justify-center hover:bg-surface-soft rounded-pill transition-all duration-[180ms]">
              <ChevronRight size={12} strokeWidth={2} className="text-ink-secondary" />
            </button>
          </div>

          {/* Day labels */}
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {[tc("day_sun"), tc("day_mon"), tc("day_tue"), tc("day_wed"), tc("day_thu"), tc("day_fri"), tc("day_sat")].map((day, i) => (
              <div key={i} className="text-[10px] font-semibold text-center text-ink-muted py-0.5">
                {day.substring(0, 1)}
              </div>
            ))}
          </div>

          {/* Calendar days */}
          <div className="grid grid-cols-7 gap-0.5">
            {calendarDays.map((date, i) => {
              const isCurrentMonth = isSameMonth(date, currentMonth);
              const isInWeek = isInSelectedWeek(date);
              const isTodayDate = isDateToday(date);
              const dayOfWeek = getISODay(date);
              const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

              let roundedClass = "rounded-xs";
              if (isInWeek) {
                if (dayOfWeek === 1) roundedClass = "rounded-l-xs";
                else if (dayOfWeek === 5) roundedClass = "rounded-r-xs";
                else roundedClass = "";
              }

              return (
                <button
                  key={i}
                  onClick={() => isWeekday && handleSelectWeek(date)}
                  disabled={!isWeekday && isCurrentMonth}
                  className={`w-6 h-6 text-[10px] font-medium transition-all duration-[180ms] ${roundedClass} ${
                    !isCurrentMonth
                      ? "text-ink-muted/40"
                      : !isWeekday
                      ? "text-ink-muted/40 cursor-not-allowed"
                      : isInWeek
                      ? "bg-ink text-white"
                      : isTodayDate
                      ? "bg-accent-yellow/50 text-ink font-semibold"
                      : "text-ink hover:bg-surface-soft"
                  }`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          {/* Export PDF button */}
          <button
            onClick={exportMonthToPDF}
            disabled={pdfExporting}
            className="mt-4 w-full flex items-center justify-center gap-2 px-3 py-2 bg-ink text-white rounded-pill hover:opacity-90 transition-all duration-[180ms] text-caption font-medium disabled:opacity-50"
          >
            {pdfExporting ? <Loader2 size={13} strokeWidth={1.5} className="animate-spin" /> : <Download size={13} strokeWidth={1.5} />}
            {pdfExporting ? "Export..." : "Export PDF"}
          </button>
        </div>

        {/* Main: Week Grid — column cards */}
        <div className="flex-1 overflow-auto pb-2">
          <div className="grid gap-x-3 gap-y-0" style={{ gridTemplateColumns: "auto repeat(5, 1fr)" }}>
            {/* Empty corner */}
            <div className="pb-1" />
            {/* Day headers */}
            {weekDates.map((date, dayIndex) => {
              const dateStr = formatDate(date);
              const isToday = dateStr === today;
              const dayLabel = tj(`days.${WEEK_DAYS[dayIndex]}`);
              const dateLabel = date.toLocaleDateString("fr-CA", { day: "numeric", month: "short" });
              const colBg = isToday
                ? "bg-accent-yellow/30 backdrop-blur-sm border-accent-yellow/40"
                : "bg-white/60 backdrop-blur-sm border-border-soft/40";
              return (
                <div
                  key={`day-header-${dateStr}`}
                  className={`rounded-t-xl border-t border-x px-3 py-2 text-center shadow-soft ${colBg}`}
                >
                  <div className={`text-caption font-semibold uppercase tracking-wide ${isToday ? "text-ink" : "text-ink-muted"}`}>{dayLabel}</div>
                  <div className="text-caption font-medium mt-0.5 text-ink">{dateLabel}</div>
                </div>
              );
            })}

            {/* Section rows */}
            {menuSections.flatMap((section, sectionIndex) => {
              const isLast = sectionIndex === menuSections.length - 1;
              return [
                <div key={`section-header-${section.key}`} className="flex items-center justify-end pr-3 border-r border-white/40">
                  <span className="text-caption font-semibold text-ink-muted uppercase tracking-wide text-right leading-none">
                    {t(section.tKey)}
                  </span>
                </div>,
                ...weekDates.map((date, dayIndex) => {
                  const dateStr = formatDate(date);
                  const isToday = dateStr === today;
                  const hasLocal = localData[dateStr] !== undefined;
                  const colBg = isToday
                    ? "bg-accent-yellow/15 border-accent-yellow/40"
                    : "bg-white/60 border-border-soft/40";
                  return (
                    <div
                      key={`cell-${dateStr}-${section.key}`}
                      className={`border-x border-t border-white/30 p-2 ${isLast ? "rounded-b-xl border-b pb-3" : ""} ${colBg}`}
                    >
                      <TextareaField
                        value={getMenuForDate(dateStr, section.key)}
                        onChange={(v) => updateMenu(dateStr, section.key, v)}
                        placeholder={t("placeholder")}
                        rows={2}
                      />
                      {hasLocal && (
                        <div className="text-caption text-accent-orange mt-0.5 font-medium">● Modifié</div>
                      )}
                    </div>
                  );
                }),
              ];
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivitiesSection() {
  const t = useTranslations("activities");
  const { user } = useAuth();
  const [currentMonth, setCurrentMonth] = useState(getTodayInMontreal());
  const [showForm, setShowForm] = useState(false);
  const [showRegistrations, setShowRegistrations] = useState(false);
  const [selectedActivityForRegistrations, setSelectedActivityForRegistrations] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Activity> & { action?: string }>({});
  const [loading, setLoading] = useState(false);

  const monthStr = format(currentMonth, "yyyy-MM");

  const { data: activities = [], mutate } = useSWR(
    `activities-planning-${monthStr}`,
    () => activitiesApi.list(monthStr).then((r) => r.data.activities || [])
  );

  const { data: groupsResponse } = useSWR(
    "groups-planning",
    () => groupsApi.list()
  );
  const groupsData = groupsResponse?.data || [];

  // Redirect if not admin
  if (user && user.role !== "admin_garderie") {
    return (
      <div className="p-6 text-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700 inline-block">
          <p>{t("error.unauthorized")}</p>
        </div>
      </div>
    );
  }

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  const handleOpenForm = (activity?: Activity) => {
    if (activity) {
      setFormData({ ...activity, action: "edit" });
    } else {
      setFormData({ action: "create", date: formatDateInMontreal(getTodayInMontreal()), type: "sortie" });
    }
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const isTheme = formData.type === "theme";
      const normalizedGroupId = formData.group_id && formData.group_id !== "" ? formData.group_id : undefined;
      if (formData.action === "create") {
        await activitiesApi.create({
          title: formData.title!,
          description: formData.description,
          date: formData.date!,
          end_date: formData.end_date,
          capacity: isTheme ? undefined : formData.capacity,
          group_id: normalizedGroupId,
          type: formData.type || "sortie",
        });
      } else if (formData.action === "edit") {
        await activitiesApi.update(formData.id!, {
          title: formData.title,
          description: formData.description,
          date: formData.date,
          end_date: formData.end_date,
          capacity: isTheme ? undefined : formData.capacity,
          group_id: normalizedGroupId,
          type: formData.type,
        });
      }

      mutate();
      setShowForm(false);
      setFormData({});
    } catch (error) {
      console.error("Error saving activity:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (activityId: string) => {
    if (!confirm(t("confirm.delete"))) return;

    try {
      await activitiesApi.delete(activityId);
      mutate();
    } catch (error) {
      console.error("Error deleting activity:", error);
    }
  };

  return (
    <div className="space-y-6 px-6 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-h3 font-semibold text-ink">{t("title")}</h2>
        <button
          onClick={() => handleOpenForm()}
          className="flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-pill hover:opacity-90 transition-all duration-[180ms] text-body font-medium"
        >
          <Plus size={16} strokeWidth={1.5} />
          {t("create")}
        </button>
      </div>

      {/* Month navigation */}
      <div className="bg-surface-card rounded-xl shadow-soft p-4 flex items-center justify-between">
        <button onClick={handlePrevMonth} className="w-9 h-9 flex items-center justify-center hover:bg-surface-soft rounded-pill transition-all duration-[180ms]">
          <ChevronLeft size={18} strokeWidth={1.5} className="text-ink-secondary" />
        </button>
        <h3 className="text-h3 font-semibold text-ink">
          {format(currentMonth, "MMMM yyyy", { locale: fr })}
        </h3>
        <button onClick={handleNextMonth} className="w-9 h-9 flex items-center justify-center hover:bg-surface-soft rounded-pill transition-all duration-[180ms]">
          <ChevronRight size={18} strokeWidth={1.5} className="text-ink-secondary" />
        </button>
      </div>

      {/* Activities list */}
      {activities.length === 0 ? (
        <div className="bg-surface-card rounded-xl shadow-soft p-8 text-center text-body text-ink-muted">
          {t("empty")}
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map((activity: Activity) => (
            <div
              key={activity.id}
              className="bg-surface-card rounded-xl shadow-card p-4 flex items-start justify-between hover:shadow-hover hover:-translate-y-0.5 transition-all duration-[180ms]"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-semibold text-ink text-body">{activity.title}</h4>
                  <span className={`text-caption font-semibold rounded-pill px-2 py-1 ${
                    activity.type === "theme"
                      ? "bg-[#EAE8FF] text-accent-purple"
                      : "bg-accent-orange/20 text-accent-orange"
                  }`}>
                    {activity.type === "theme" ? `📚 ${t("form.typeTheme")}` : `🚌 ${t("form.typeSortie")}`}
                  </span>
                  {activity.group_id && groupsData.find((g: any) => g.id === activity.group_id) && (
                    <span className="text-caption font-semibold rounded-pill px-2 py-1 bg-primary-soft text-primary">
                      {groupsData.find((g: any) => g.id === activity.group_id)?.name}
                    </span>
                  )}
                </div>
                {activity.description && (
                  <p className="text-body text-ink-secondary mt-1">{activity.description}</p>
                )}
                <div className="flex gap-4 mt-2 text-body text-ink-muted flex-wrap">
                  <span>📅 {format(parse(activity.date, "yyyy-MM-dd", new Date()), "d MMMM yyyy", { locale: fr })}
                    {activity.end_date && activity.end_date !== activity.date &&
                      ` – ${format(parse(activity.end_date, "yyyy-MM-dd", new Date()), "d MMMM yyyy", { locale: fr })}`}
                  </span>
                  {activity.capacity && (
                    <span>👥 {activity.registration_count || 0}/{activity.capacity} {t("registered")}</span>
                  )}
                </div>
              </div>

              <div className="flex gap-1 ml-4">
                {activity.type !== "theme" && (
                  <button
                    onClick={() => { setSelectedActivityForRegistrations(activity.id); setShowRegistrations(true); }}
                    className="w-9 h-9 flex items-center justify-center text-status-success hover:bg-status-success/10 rounded-pill transition-all duration-[180ms]"
                    title={t("registrations")}
                  >
                    👥
                  </button>
                )}
                <button
                  onClick={() => handleOpenForm(activity)}
                  className="w-9 h-9 flex items-center justify-center text-ink-secondary hover:bg-surface-soft rounded-pill transition-all duration-[180ms]"
                >
                  <Edit2 size={16} strokeWidth={1.5} />
                </button>
                <button
                  onClick={() => handleDelete(activity.id)}
                  className="w-9 h-9 flex items-center justify-center text-status-danger hover:bg-status-danger/10 rounded-pill transition-all duration-[180ms]"
                >
                  <Trash2 size={16} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Activity form modal */}
      {showForm && (
        <ActivityFormModal
          formData={formData}
          loading={loading}
          groups={groupsData}
          onSubmit={handleSubmit}
          onChange={(field, value) => setFormData({ ...formData, [field]: value })}
          onClose={() => {
            setShowForm(false);
            setFormData({});
          }}
        />
      )}

      {/* Registrations modal */}
      {showRegistrations && selectedActivityForRegistrations && (
        <RegistrationsModal
          activityId={selectedActivityForRegistrations}
          activity={activities.find((a: Activity) => a.id === selectedActivityForRegistrations)}
          onClose={() => {
            setShowRegistrations(false);
            setSelectedActivityForRegistrations(null);
          }}
        />
      )}
    </div>
  );
}

function RegistrationsModal({
  activityId,
  activity,
  onClose,
}: {
  activityId: string;
  activity?: Activity;
  onClose: () => void;
}) {
  const t = useTranslations("activities");
  const tc = useTranslations("common");

  const { data: registrationsData = [] } = useSWR(
    activityId ? ["registrations", activityId] : null,
    () => activitiesApi.getRegistrations(activityId).then((r) => r.data?.registrations || [])
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card rounded-xl shadow-hover max-w-2xl w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-h3 font-semibold text-ink">
            {t("registrations")} — {activity?.title}
          </h3>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-ink-secondary hover:bg-surface-soft rounded-pill transition-all duration-[180ms]">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="space-y-2 max-h-96 overflow-y-auto">
          {registrationsData.length === 0 ? (
            <p className="text-body text-ink-muted text-center py-4">{t("noRegistrations")}</p>
          ) : (
            <div>
              <p className="text-body text-ink-secondary mb-3">
                {registrationsData.length} {t("inscribed")} {activity?.capacity ? `/ ${activity.capacity}` : ""}
              </p>
              {registrationsData.map((reg: any) => (
                <div key={reg.id} className="flex items-center gap-3 p-3 bg-surface-soft rounded-lg hover:bg-border-soft transition-all duration-[180ms]">
                  <p className="text-body font-semibold text-ink">{reg.first_name} {reg.last_name}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-4 mt-4 border-t border-border-soft">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-surface-soft text-ink rounded-pill hover:bg-border-soft transition-all duration-[180ms] text-body font-medium">
            {tc("close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActivityFormModal({
  formData,
  loading,
  groups,
  onSubmit,
  onChange,
  onClose,
}: {
  formData: Partial<Activity> & { action?: string };
  loading: boolean;
  groups: any[];
  onSubmit: (e: React.FormEvent) => Promise<void>;
  onChange: (field: string, value: any) => void;
  onClose: () => void;
}) {
  const t = useTranslations("activities");
  const tc = useTranslations("common");

  const inputCls = "w-full px-4 py-2.5 border-0 bg-surface-soft rounded-xl text-body focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all duration-[180ms] placeholder:text-ink-muted";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card rounded-xl shadow-hover max-w-2xl w-full p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-h3 font-semibold text-ink">
            {formData.action === "create" ? t("form.create") : t("form.edit")}
          </h3>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-ink-secondary hover:bg-surface-soft rounded-pill transition-all duration-[180ms]">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-caption font-semibold text-ink-secondary mb-2">{t("form.type")}</label>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => onChange("type", "theme")}
                className={`flex items-center gap-2 px-4 py-3 rounded-xl text-body font-medium transition-all duration-[180ms] ${
                  formData.type === "theme" ? "bg-[#EAE8FF] text-accent-purple" : "bg-surface-soft text-ink-secondary hover:bg-border-soft"
                }`}>
                📚 {t("form.typeTheme")}
              </button>
              <button type="button" onClick={() => onChange("type", "sortie")}
                className={`flex items-center gap-2 px-4 py-3 rounded-xl text-body font-medium transition-all duration-[180ms] ${
                  (formData.type || "sortie") === "sortie" ? "bg-accent-orange/20 text-accent-orange" : "bg-surface-soft text-ink-secondary hover:bg-border-soft"
                }`}>
                🚌 {t("form.typeSortie")}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-caption font-semibold text-ink-secondary mb-1">{t("form.title")} *</label>
            <input type="text" value={formData.title || ""} onChange={(e) => onChange("title", e.target.value)} required className={inputCls} />
          </div>

          <div>
            <label className="block text-caption font-semibold text-ink-secondary mb-1">{t("form.description")}</label>
            <textarea value={formData.description || ""} onChange={(e) => onChange("description", e.target.value)} rows={3} className={inputCls} />
          </div>

          <div>
            <label className="block text-caption font-semibold text-ink-secondary mb-1">{t("form.date")} *</label>
            <input type="date" value={formData.date || ""} onChange={(e) => onChange("date", e.target.value)} required className={inputCls} />
          </div>

          <div>
            <label className="block text-caption font-semibold text-ink-secondary mb-1">{t("form.endDate")}</label>
            <input type="date" value={formData.end_date || ""} onChange={(e) => onChange("end_date", e.target.value)} className={inputCls} />
          </div>

          <div className={`grid gap-4 ${(formData.type || "sortie") === "sortie" ? "grid-cols-2" : "grid-cols-1"}`}>
            {(formData.type || "sortie") === "sortie" && (
              <div>
                <label className="block text-caption font-semibold text-ink-secondary mb-1">{t("form.capacity")}</label>
                <input type="number" min="1" value={formData.capacity || ""} onChange={(e) => onChange("capacity", e.target.value ? parseInt(e.target.value) : null)} placeholder={t("form.capacityPlaceholder")} className={inputCls} />
              </div>
            )}
            <div>
              <label className="block text-caption font-semibold text-ink-secondary mb-1">{t("form.group")}</label>
              <select value={formData.group_id || ""} onChange={(e) => onChange("group_id", e.target.value || null)} className={inputCls}>
                <option value="">{t("form.noGroup")}</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button type="submit" disabled={loading} className="flex-1 px-4 py-2.5 bg-ink text-white rounded-pill hover:opacity-90 transition-all duration-[180ms] text-body font-medium disabled:opacity-50">
              {loading ? t("form.saving") : t("form.save")}
            </button>
            <button type="button" onClick={onClose} disabled={loading} className="flex-1 px-4 py-2.5 bg-surface-soft text-ink rounded-pill hover:bg-border-soft transition-all duration-[180ms] text-body font-medium disabled:opacity-50">
              {tc("cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PlanningPage() {
  const t = useTranslations("planning");
  const [activeTab, setActiveTab] = useState<"menus" | "activities">("menus");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 flex-shrink-0">
        <h1 className="text-h3 font-semibold text-ink">{t("title")}</h1>
      </div>

      {/* Tab bar */}
      <div className="px-6 py-3 flex-shrink-0">
        <div className="flex items-center gap-1 bg-white/60 backdrop-blur-sm rounded-pill px-2 py-1.5 shadow-soft w-fit">
          <TabButton active={activeTab === "menus"} onClick={() => setActiveTab("menus")}>
            {t("tabMenu")}
          </TabButton>
          <TabButton active={activeTab === "activities"} onClick={() => setActiveTab("activities")}>
            {t("tabActivities")}
          </TabButton>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "menus" && <MenusSection />}
        {activeTab === "activities" && <ActivitiesSection />}
      </div>
    </div>
  );
}
