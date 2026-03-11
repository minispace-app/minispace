"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { childrenApi, groupsApi, usersApi, attendanceApi, journalApi, activitiesApi, menusApi, settingsApi } from "../../../../lib/api";
import { useAuth } from "../../../../hooks/useAuth";
import { getTodayInMontreal, formatDateInMontreal } from "../../../../lib/dateUtils";
import { Plus, ChevronDown, ChevronUp, UserPlus, X, Pencil, ChevronLeft, ChevronRight, Loader2, Check, BookOpen, Clock, CheckCircle, XCircle, AlertCircle, ThermometerSun, FileText, UserX, UserCheck, Notebook, CircleCheck, CircleX } from "lucide-react";
import { ChildAvatar, childAvatarColor } from "../../../../components/ChildAvatar";
import { WeatherPicker } from "../../../../components/journal/WeatherPicker";
import { EmojiPicker } from "../../../../components/journal/EmojiPicker";
import { SleepBar } from "../../../../components/journal/SleepBar";
import { TextareaField } from "../../../../components/journal/TextareaField";
import { DayTabBar } from "../../../../components/journal/DayTabBar";
import { DayFieldList } from "../../../../components/journal/DayFieldList";
import {
  DailyJournal,
  DayData,
  WEEK_DAYS,
  FIELD_ROWS,
  APPETIT_OPTIONS,
  HUMEUR_OPTIONS,
  emptyDay,
  hasDayData,
} from "../../../../components/journal/journalTypes";
import {
  getMonday,
  formatDate,
  addDays,
  getDefaultActiveDayIndex,
} from "../../../../components/journal/journalUtils";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, parseISO, getISODay, startOfWeek } from "date-fns";
import { fr } from "date-fns/locale";

interface Child {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  group_id: string | null;
  is_active: boolean;
  start_date: string | null;
  schedule_days: number[] | null;
}

interface Group {
  id: string;
  name: string;
}

interface ParentUser {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  relationship: string;
}

interface PendingParent {
  child_id: string;
  email: string;
  relationship: string;
  created_at: string;
}

interface InvitedParent {
  email: string;
  role: string;
  expires_at: string;
  created_at: string;
}

interface UserOption {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
}

interface JournalDay {
  date: string;
  sent: boolean;
}

type AttendanceStatus = "attendu" | "present" | "absent" | "malade" | "vacances" | "present_hors_contrat";

// ── Child Status Indicators Component ──
function ChildStatusIndicators({ 
  childId, 
  today, 
  currentMonthStr, 
  attendanceStatus 
}: { 
  childId: string; 
  today: string; 
  currentMonthStr: string;
  attendanceStatus?: string;
}) {
  const { data: journalData } = useSWR(
    `journal-summary-${childId}-${currentMonthStr}`,
    () => journalApi.getMonthSummary(childId, currentMonthStr).then((r: { data: { journals?: JournalDay[] } }) => r.data.journals || [])
  );

  const hasJournalToday = journalData && Array.isArray(journalData) 
    ? journalData.some((j: JournalDay) => j.date === today)
    : false;

  return (
    <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
      {/* Journal indicator - Icône livre/journal */}
      {hasJournalToday && (
        <div 
          className="w-6 h-6 rounded-md bg-blue-500 flex items-center justify-center flex-shrink-0 shadow-sm" 
          title="Journal rempli"
        >
          <BookOpen className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
        </div>
      )}
      
      {/* Attendance indicator - Présent (vert) ou Absent (rouge) */}
      {attendanceStatus === 'present' && (
        <div 
          className="w-6 h-6 rounded-md bg-green-500 flex items-center justify-center flex-shrink-0 shadow-sm"
          title="Présent"
        >
          <Check className="w-4 h-4 text-white" strokeWidth={3} />
        </div>
      )}
      
      {(attendanceStatus === 'absent' || attendanceStatus === 'malade') && (
        <div 
          className="w-6 h-6 rounded-md bg-red-500 flex items-center justify-center flex-shrink-0 shadow-sm"
          title={attendanceStatus === 'malade' ? 'Absent (malade)' : 'Absent'}
        >
          <X className="w-4 h-4 text-white" strokeWidth={3} />
        </div>
      )}
      
      {attendanceStatus === 'present_hors_contrat' && (
        <div 
          className="w-6 h-6 rounded-md bg-green-500 flex items-center justify-center flex-shrink-0 shadow-sm"
          title="Présent hors contrat"
        >
          <Check className="w-4 h-4 text-white" strokeWidth={3} />
        </div>
      )}
    </div>
  );
}

const ATTENDANCE_COLORS: Record<AttendanceStatus, { bg: string; text: string; icon: React.ReactNode; label: string }> = {
  attendu: { bg: "bg-gray-100", text: "text-gray-600", icon: "⏰", label: "Attendu" },
  present: { bg: "bg-green-100", text: "text-green-600", icon: "✓", label: "Présent" },
  absent: { bg: "bg-red-100", text: "text-red-600", icon: "✗", label: "Absent" },
  malade: { bg: "bg-orange-100", text: "text-orange-600", icon: "🤒", label: "Malade" },
  vacances: { bg: "bg-blue-100", text: "text-blue-600", icon: "🏖", label: "Vacances" }, // legacy, kept for display only
  present_hors_contrat: { bg: "bg-purple-100", text: "text-purple-600", icon: "✓", label: "Hors contrat" },
};

// Statuses shown in the bulk/single action bar (vacances removed)
const STAFF_STATUSES = [
  { key: "present", label: "Présent", icon: "✓", cls: "bg-green-100 text-green-700 hover:bg-green-200 border-green-300" },
  { key: "absent",  label: "Absent",  icon: "✗", cls: "bg-red-100 text-red-700 hover:bg-red-200 border-red-300" },
  { key: "malade",  label: "Malade",  icon: "🤒", cls: "bg-orange-100 text-orange-700 hover:bg-orange-200 border-orange-300" },
  { key: "present_hors_contrat", label: "Hors contrat", icon: "✓", cls: "bg-purple-100 text-purple-700 hover:bg-purple-200 border-purple-300" },
  { key: "attendu", label: "Attendu", icon: "⏰", cls: "bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-300" },
];

function ChildDetails({
  child,
  groups,
  groupMap,
  onUpdated,
  canWrite,
}: {
  child: Child;
  groups: Group[];
  groupMap: Record<string, string>;
  onUpdated: () => void;
  canWrite: boolean;
}) {
  const tc = useTranslations("common");
  const t = useTranslations("children");

  const DAYS = [
    { num: 1, label: "Lun" }, { num: 2, label: "Mar" }, { num: 3, label: "Mer" },
    { num: 4, label: "Jeu" }, { num: 5, label: "Ven" },
  ];

  // Edit state
  const [firstName, setFirstName] = useState(child.first_name);
  const [lastName, setLastName] = useState(child.last_name);
  const [birthDate, setBirthDate] = useState(child.birth_date);
  const [groupId, setGroupId] = useState(child.group_id ?? "");
  const [startDate, setStartDate] = useState(child.start_date ?? "");
  const [scheduleDays, setScheduleDays] = useState<number[]>(child.schedule_days ?? [1, 2, 3, 4, 5]);
  const [savingEdit, setSavingEdit] = useState(false);

  // Update state when child changes
  useEffect(() => {
    setFirstName(child.first_name);
    setLastName(child.last_name);
    setBirthDate(child.birth_date);
    setGroupId(child.group_id ?? "");
    setStartDate(child.start_date ?? "");
    setScheduleDays(child.schedule_days ?? [1, 2, 3, 4, 5]);
  }, [child.id]);

  const toggleDay = (day: number) =>
    setScheduleDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort());

  // Parents state
  const [showAddParent, setShowAddParent] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [relationship, setRelationship] = useState("parent");
  const [savingParent, setSavingParent] = useState(false);
  const [showAddPendingParent, setShowAddPendingParent] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");
  const [pendingRelationship, setPendingRelationship] = useState("parent");
  const [savingPendingParent, setSavingPendingParent] = useState(false);
  const [showAddInvitedParent, setShowAddInvitedParent] = useState(false);
  const [selectedInvitation, setSelectedInvitation] = useState("");
  const [savingInvitedParent, setSavingInvitedParent] = useState(false);

  const { data: parentsData, mutate: mutateParents } = useSWR(
    `child-parents-${child.id}`,
    () => childrenApi.listParents(child.id)
  );

  const { data: pendingParentsData, mutate: mutatePendingParents } = useSWR(
    `child-pending-parents-${child.id}`,
    () => childrenApi.listPendingParents(child.id)
  );

  const { data: invitedParentsData, mutate: mutateInvitedParents } = useSWR(
    `child-invited-parents-${child.id}`,
    () => childrenApi.listInvitedParents(child.id)
  );

  const { data: availableInvitationsData } = useSWR(
    "available-invitations",
    () => childrenApi.listAvailableInvitations()
  );

  const { data: usersData } = useSWR(
    "users-list-for-parents",
    () => usersApi.list()
  );

  const parents: ParentUser[] = (parentsData as { data: ParentUser[] } | undefined)?.data ?? [];
  const pendingParents: PendingParent[] = (pendingParentsData as { data: PendingParent[] } | undefined)?.data ?? [];
  const invitedParents: InvitedParent[] = (invitedParentsData as { data: InvitedParent[] } | undefined)?.data ?? [];
  const allUsers: UserOption[] = (usersData as { data: UserOption[] } | undefined)?.data ?? [];
  const availableInvitations: any[] = (availableInvitationsData as { data: any[] } | undefined)?.data ?? [];
  const parentOptions = allUsers.filter((u) => u.role === "parent");
  const assignedIds = new Set(parents.map((p) => p.user_id));
  const availableOptions = parentOptions.filter((u) => !assignedIds.has(u.id));
  const pendingEmails = new Set(pendingParents.map((p) => p.email));
  const invitedEmails = new Set(invitedParents.map((p) => p.email));
  const availableInvitationsForChild = availableInvitations.filter((inv) => !invitedEmails.has(inv.email));

  const handleAddParent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) return;
    setSavingParent(true);
    try {
      await childrenApi.assignParent(child.id, selectedUserId, relationship);
      setSelectedUserId("");
      setRelationship("parent");
      setShowAddParent(false);
      mutateParents();
    } finally {
      setSavingParent(false);
    }
  };

  const handleRemoveParent = async (userId: string) => {
    if (!confirm(t("confirmRemoveParent"))) return;
    await childrenApi.removeParent(child.id, userId);
    mutateParents();
    onUpdated();
  };

  const handleAddPendingParent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingEmail) return;
    setSavingPendingParent(true);
    try {
      await childrenApi.assignPendingParent(child.id, pendingEmail, pendingRelationship);
      setPendingEmail("");
      setPendingRelationship("parent");
      setShowAddPendingParent(false);
      mutatePendingParents();
    } finally {
      setSavingPendingParent(false);
    }
  };

  const handleRemovePendingParent = async (email: string) => {
    if (!confirm(t("confirmRemoveParent"))) return;
    await childrenApi.removePendingParent(child.id, email);
    mutatePendingParents();
    onUpdated();
  };

  const handleRemoveInvitedParent = async (email: string) => {
    if (!confirm(t("confirmRemoveParent"))) return;
    await childrenApi.removeInvitedParent(child.id, email);
    mutateInvitedParents();
    onUpdated();
  };

  const handleAddInvitedParent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvitation) return;
    const [invId, email, role] = selectedInvitation.split("|");
    setSavingInvitedParent(true);
    try {
      await childrenApi.assignInvitedParent(child.id, email, role);
      setSelectedInvitation("");
      setShowAddInvitedParent(false);
      mutateInvitedParents();
    } finally {
      setSavingInvitedParent(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEdit(true);
    try {
      await childrenApi.update(child.id, {
        first_name: firstName,
        last_name: lastName,
        birth_date: birthDate,
        group_id: groupId || undefined,
        start_date: startDate || undefined,
        schedule_days: scheduleDays,
      });
      onUpdated();
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(t("confirmDeleteChild"))) return;
    try {
      await childrenApi.delete(child.id);
      onUpdated();
    } catch (err) {
      alert(t("deleteError"));
    }
  };

  return (
    <div className="space-y-6">
      {/* Edit details section */}
      {canWrite && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Pencil className="w-4 h-4 text-slate-500" />
              {tc("edit")}
            </h3>
          </div>
          <form onSubmit={handleSaveEdit} className="px-5 py-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t("firstName")}
                </label>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  {t("lastName")}
                </label>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {t("birthDate")}
              </label>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {t("group")}
              </label>
              <select
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t("noGroup")}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Date de commencement
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-2">
                Jours de présence
              </label>
              <div className="flex gap-2">
                {DAYS.map(({ num, label }) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => toggleDay(num)}
                    className={`flex-1 py-1.5 rounded-pill text-caption font-semibold transition-all duration-[180ms] ${
                      scheduleDays.includes(num)
                        ? "bg-ink text-white"
                        : "bg-surface-soft text-ink-muted hover:bg-border-soft"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={savingEdit}
                className="px-4 py-2 bg-ink text-white text-body font-medium rounded-pill hover:opacity-90 transition-all duration-[180ms] disabled:opacity-50"
              >
                {savingEdit ? tc("loading") : tc("save")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setFirstName(child.first_name);
                  setLastName(child.last_name);
                  setBirthDate(child.birth_date);
                  setGroupId(child.group_id ?? "");
                  setStartDate(child.start_date ?? "");
                  setScheduleDays(child.schedule_days ?? [1, 2, 3, 4, 5]);
                }}
                className="px-4 py-2 bg-surface-soft text-ink-secondary text-body font-medium rounded-pill hover:bg-border-soft transition-all duration-[180ms]"
              >
                {tc("reset")}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="ml-auto px-3 py-2 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700"
              >
                {tc("delete")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Parents section (active + pending) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-slate-500" />
              {t("associatedParents")}
            </h3>
            {canWrite && !showAddParent && !showAddPendingParent && !showAddInvitedParent && (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAddParent(true)}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium transition"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  {t("associate")}
                </button>
                <button
                  onClick={() => setShowAddPendingParent(true)}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium transition"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  {t("addByEmail")}
                </button>
                {availableInvitationsForChild.length > 0 && (
                  <button
                    onClick={() => setShowAddInvitedParent(true)}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium transition"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    {t("linkInvitation")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-4">
          {parents.length === 0 && pendingParents.length === 0 && invitedParents.length === 0 ? (
            <p className="text-sm text-slate-400">{t("noParents")}</p>
          ) : (
            <ul className="space-y-2 mb-4">
              {/* Active parents */}
              {parents.map((p) => (
                <li
                  key={`active-${p.user_id}`}
                  className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2"
                >
                  <div>
                    <span className="text-sm font-medium text-slate-800">
                      {p.first_name} {p.last_name}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-500">{p.email}</span>
                      <span className="text-xs bg-slate-200 text-slate-600 rounded px-2 py-0.5">
                        {p.relationship}
                      </span>
                    </div>
                  </div>
                  {canWrite && (
                    <button
                      onClick={() => handleRemoveParent(p.user_id)}
                      className="text-slate-400 hover:text-red-500 transition ml-3 flex-shrink-0"
                      title={t("remove")}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}

              {/* Pending parents (by email) */}
              {pendingParents.map((p) => (
                <li
                  key={`pending-${p.email}`}
                  className="flex items-center justify-between bg-amber-50 rounded-lg px-3 py-2"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-amber-200 text-amber-800 rounded px-2 py-1 font-medium">
                        {t("pending")}
                      </span>
                      <span className="text-sm font-medium text-slate-800">
                        {p.email}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-500">
                        {p.relationship}
                      </span>
                    </div>
                  </div>
                  {canWrite && (
                    <button
                      onClick={() => handleRemovePendingParent(p.email)}
                      className="text-slate-400 hover:text-red-500 transition ml-3 flex-shrink-0"
                      title={t("remove")}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}

              {/* Invited parents (invitation tokens) */}
              {invitedParents.map((p) => (
                <li
                  key={`invited-${p.email}`}
                  className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-blue-200 text-blue-800 rounded px-2 py-1 font-medium">
                        {t("invitation")}
                      </span>
                      <span className="text-sm font-medium text-slate-800">
                        {p.email}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-500">
                        {p.role}
                      </span>
                    </div>
                  </div>
                  {canWrite && (
                    <button
                      onClick={() => handleRemoveInvitedParent(p.email)}
                      className="text-slate-400 hover:text-red-500 transition ml-3 flex-shrink-0"
                      title={t("remove")}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Add registered parent form */}
          {canWrite && showAddParent && (
            <form onSubmit={handleAddParent} className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-2 mt-2">
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                required
              >
                <option value="">{t("chooseParent")}</option>
                {availableOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.first_name} {u.last_name} ({u.email})
                  </option>
                ))}
              </select>
              <select
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="parent">{t("relationshipParent")}</option>
                <option value="tuteur">{t("relationshipGuardian")}</option>
                <option value="gardien">{t("relationshipCaretaker")}</option>
                <option value="autre">{t("relationshipOther")}</option>
              </select>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={savingParent || !selectedUserId}
                  className="px-3 py-1.5 bg-ink text-white text-body font-medium rounded-pill hover:opacity-90 transition-all duration-[180ms] disabled:opacity-50"
                >
                  {savingParent ? tc("loading") : t("associate")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddParent(false);
                    setSelectedUserId("");
                  }}
                  className="px-3 py-1.5 border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-white"
                >
                  {tc("cancel")}
                </button>
              </div>
            </form>
          )}

          {/* Add pending parent form */}
          {canWrite && showAddPendingParent && (
            <form onSubmit={handleAddPendingParent} className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-2 mt-2">
              <input
                type="email"
                value={pendingEmail}
                onChange={(e) => setPendingEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                required
              />
              <select
                value={pendingRelationship}
                onChange={(e) => setPendingRelationship(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="parent">{t("relationshipParent")}</option>
                <option value="tuteur">{t("relationshipGuardian")}</option>
                <option value="gardien">{t("relationshipCaretaker")}</option>
                <option value="autre">{t("relationshipOther")}</option>
              </select>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={savingPendingParent || !pendingEmail}
                  className="px-3 py-1.5 bg-ink text-white text-body font-medium rounded-pill hover:opacity-90 transition-all duration-[180ms] disabled:opacity-50"
                >
                  {savingPendingParent ? tc("loading") : t("add")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddPendingParent(false);
                    setPendingEmail("");
                  }}
                  className="px-3 py-1.5 border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-white"
                >
                  {tc("cancel")}
                </button>
              </div>
            </form>
          )}

          {/* Add invited parent form */}
          {canWrite && showAddInvitedParent && (
            <form onSubmit={handleAddInvitedParent} className="bg-green-50 border border-green-100 rounded-lg p-3 space-y-2 mt-2">
              <select
                value={selectedInvitation}
                onChange={(e) => setSelectedInvitation(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                required
              >
                <option value="">{t("chooseInvitation")}</option>
                {availableInvitationsForChild.map((inv) => (
                  <option key={inv.id} value={`${inv.id}|${inv.email}|${inv.role}`}>
                    {inv.email} ({inv.role}) - {new Date(inv.expires_at).toLocaleDateString()}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={savingInvitedParent || !selectedInvitation}
                  className="px-3 py-1.5 bg-ink text-white text-body font-medium rounded-pill hover:opacity-90 transition-all duration-[180ms] disabled:opacity-50"
                >
                  {savingInvitedParent ? tc("loading") : t("link")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddInvitedParent(false);
                    setSelectedInvitation("");
                  }}
                  className="px-3 py-1.5 border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-white"
                >
                  {tc("cancel")}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
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

// ── DayDetailModalAdmin ──
// Admin view of day details: read-only, shows attendance, journal, activities
function DayDetailModalAdmin({
  date,
  child,
  monthStr,
  onClose,
}: {
  date: string;
  child: Child;
  monthStr: string;
  onClose: () => void;
}) {
  const t = useTranslations("calendar");

  const { data: attendance = {} } = useSWR(
    `attendance-${child.id}-${monthStr}`,
    () => attendanceApi.getMonth(child.id, monthStr).then((r) => r.data.attendance || {})
  );

  const dateObj = parseISO(date);
  const weekStart = format(startOfWeek(dateObj, { weekStartsOn: 1 }), "yyyy-MM-dd");

  const { data: journalData } = useSWR(`journal-${child.id}-${weekStart}`, () =>
    journalApi.getWeek(child.id, weekStart)
  );
  const journalList = (journalData as { data: any[] } | undefined)?.data ?? [];
  const journal = journalList.find((j: any) => j.date === date);

  const { data: activitiesRaw } = useSWR(
    `activities-${child.id}-${monthStr}`,
    () => activitiesApi.list(monthStr, child.id).then((r) => r.data as any)
  );
  const activities: any[] = activitiesRaw?.activities || [];

  const dayActivities = activities.filter((a: any) => {
    const end = a.end_date || a.date;
    return date >= a.date && date <= end;
  });

  const currentStatus = (attendance[date] || "present") as AttendanceStatus;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl md:rounded-xl w-full md:max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <h3 className="text-lg font-bold text-slate-800 capitalize">
            {format(dateObj, "EEEE d MMMM", { locale: fr })}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* ── ATTENDANCE ── */}
          <section>
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
              {t("dayDetail.attendance")}
            </h4>
            <div className="flex items-center gap-2">
              <span className="text-sm">{ATTENDANCE_COLORS[currentStatus]?.icon}</span>
              <span className="text-sm font-medium text-slate-700">
                {ATTENDANCE_COLORS[currentStatus]?.label}
              </span>
            </div>
          </section>

          {/* ── JOURNAL ── */}
          <section>
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
              {t("dayDetail.journal")}
            </h4>
            {journal ? (
              <div className="bg-slate-50 rounded-lg p-4 space-y-2 text-sm">
                {journal.humeur && (
                  <div className="flex gap-2">
                    <span className="font-semibold text-slate-700">Humeur:</span>
                    <span className="text-slate-600">{journal.humeur}</span>
                  </div>
                )}
                {journal.appetit && (
                  <div className="flex gap-2">
                    <span className="font-semibold text-slate-700">Appétit:</span>
                    <span className="text-slate-600">{journal.appetit}</span>
                  </div>
                )}
                {journal.sommeil_minutes && (
                  <div className="flex gap-2">
                    <span className="font-semibold text-slate-700">Sommeil:</span>
                    <span className="text-slate-600">{journal.sommeil_minutes} min</span>
                  </div>
                )}
                {journal.message_educatrice && (
                  <div className="flex gap-2">
                    <span className="font-semibold text-slate-700">Message:</span>
                    <span className="text-slate-600">{journal.message_educatrice}</span>
                  </div>
                )}
                {journal.observations && (
                  <div className="flex gap-2">
                    <span className="font-semibold text-slate-700">Observations:</span>
                    <span className="text-slate-600">{journal.observations}</span>
                  </div>
                )}
                {journal.sante && (
                  <div className="flex gap-2">
                    <span className="font-semibold text-slate-700">Santé:</span>
                    <span className="text-slate-600">{journal.sante}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic">{t("dayDetail.noJournal")}</p>
            )}
          </section>

          {/* ── ACTIVITIES ── */}
          <section>
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
              {t("dayDetail.activities")}
            </h4>
            {dayActivities.length === 0 ? (
              <p className="text-sm text-slate-400 italic">{t("dayDetail.noActivities")}</p>
            ) : (
              <div className="space-y-3">
                {dayActivities.map((activity: any) => {
                  const isTheme = activity.type === "theme";
                  return (
                    <div
                      key={activity.id}
                      className={`rounded-xl border-2 p-4 ${
                        isTheme
                          ? "border-violet-200 bg-violet-50/50"
                          : "border-orange-200 bg-orange-50/50"
                      }`}
                    >
                      {/* Type badge */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-xs font-bold uppercase tracking-wide ${
                          isTheme ? "text-violet-600" : "text-orange-600"
                        }`}>
                          {isTheme ? `📚 ${t("dayDetail.theme")}` : `🚌 ${t("dayDetail.sortie")}`}
                        </span>
                        {!isTheme && activity.capacity != null && (
                          <span className="text-xs text-slate-500 ml-auto">
                            {activity.registration_count || 0}/{activity.capacity}
                          </span>
                        )}
                      </div>

                      {/* Title */}
                      <p className="font-semibold text-slate-800">{activity.title}</p>

                      {/* Date range if multi-day */}
                      {activity.end_date && activity.end_date !== activity.date && (
                        <p className="text-xs text-slate-500 mt-1">
                          {format(parseISO(activity.date), "d MMM", { locale: fr })} – {format(parseISO(activity.end_date), "d MMM", { locale: fr })}
                        </p>
                      )}

                      {/* Description */}
                      {activity.description && (
                        <p className="text-sm text-slate-600 mt-1">{activity.description}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function CalendarSection({
  child,
  currentMonth,
  setCurrentMonth,
  statusModalDate,
  setStatusModalDate,
  dayDetailDate,
  setDayDetailDate,
}: {
  child: Child;
  currentMonth: Date;
  setCurrentMonth: (date: Date) => void;
  statusModalDate: string | null;
  setStatusModalDate: (date: string | null) => void;
  dayDetailDate: string | null;
  setDayDetailDate: (date: string | null) => void;
}) {
  const t = useTranslations("calendar");

  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  const monthStr = format(currentMonth, "yyyy-MM");
  const { data: attendanceData, mutate: mutateAttendance } = useSWR(
    `attendance-${child.id}-${monthStr}`,
    () => attendanceApi.getMonth(child.id, monthStr).then((r) => r.data as { attendance: Record<string, string> })
  );
  const attendance = attendanceData?.attendance || {};

  const toggleDate = (dateStr: string) => {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr); else next.add(dateStr);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedDates(new Set());
    setSelectMode(false);
  };

  const handleBulkStatus = async (status: string) => {
    if (selectedDates.size === 0) return;
    setBulkLoading(true);
    try {
      await attendanceApi.setBulkStatus(child.id, Array.from(selectedDates), status);
      mutateAttendance();
      clearSelection();
    } finally {
      setBulkLoading(false);
    }
  };

  const { data: journalsData } = useSWR(
    `journals-${child.id}-${monthStr}`,
    () => journalApi.getMonthSummary(child.id, monthStr).then((r) => r.data as { journals: JournalDay[] })
  );
  const journals = journalsData?.journals || [];

  const { data: activitiesData } = useSWR(
    `activities-${child.id}-${monthStr}`,
    () => activitiesApi.list(monthStr, child.id).then((r) => r.data as any)
  );
  const activities = activitiesData?.activities || [];

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  const allDays = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  // Only weekdays (Mon=1 … Fri=5, ISO)
  const days = allDays.filter((d) => getISODay(d) <= 5);
  const firstDayOffset = days.length > 0 ? getISODay(days[0]) - 1 : 0;

  // Child schedule info
  const childScheduleDays: number[] = child.schedule_days ?? [1, 2, 3, 4, 5];
  const childStartDate: Date | null = child.start_date ? parseISO(child.start_date) : null;

  const isDayDisabled = (day: Date) => {
    if (childStartDate && day < childStartDate) return true;
    if (!childScheduleDays.includes(getISODay(day))) return true;
    return false;
  };

  const today = getTodayInMontreal();
  today.setHours(0, 0, 0, 0);

  const journalMap = journals.reduce((acc: Record<string, JournalDay>, j: JournalDay) => {
    acc[j.date] = j;
    return acc;
  }, {});

  const activitiesForDay = (date: Date) => {
    const dateStr = format(date, "yyyy-MM-dd");
    return activities.filter((a: any) => {
      const end = a.end_date || a.date;
      return dateStr >= a.date && dateStr <= end;
    });
  };

  return (
    <div className="space-y-4">
      {/* Desktop: Monthly Calendar */}
      <div className="hidden md:block bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-slate-800">
            {format(currentMonth, "MMMM yyyy", { locale: fr })}
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => { setSelectMode(!selectMode); setSelectedDates(new Set()); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                selectMode
                  ? "bg-ink text-white"
                  : "bg-surface-soft text-ink-secondary hover:bg-border-soft"
              }`}
            >
              {selectMode ? `✓ ${selectedDates.size} sélectionné(s)` : "Sélection multiple"}
            </button>
            <button onClick={handlePrevMonth} className="p-2 hover:bg-slate-100 rounded-lg transition">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button onClick={handleNextMonth} className="p-2 hover:bg-slate-100 rounded-lg transition">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Calendar grid — Mon to Fri only */}
        <div className="grid grid-cols-5 gap-2 mb-6">
          {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => (
            <div key={day} className="text-center font-semibold text-slate-600 py-2 text-sm">
              {t(`day_${day.toLowerCase()}`)}
            </div>
          ))}

          {Array.from({ length: firstDayOffset }).map((_, i) => (
            <div key={`empty-${i}`} className="h-24 bg-slate-50 rounded-lg" />
          ))}

          {days.map((day) => {
            const dateStr = format(day, "yyyy-MM-dd");
            const disabled = isDayDisabled(day);
            const dayAttendance = disabled ? "present" : (attendance[dateStr] || "present") as AttendanceStatus;
            const dayJournal = !disabled && journalMap[dateStr];
            const dayActivities = disabled ? [] : activitiesForDay(day);
            const colors = disabled ? { bg: "bg-slate-50", text: "text-slate-300", icon: null } : ATTENDANCE_COLORS[dayAttendance];
            const isToday = isSameDay(day, today);
            const isSelected = selectedDates.has(dateStr);

            const hasTheme = dayActivities.some((a: any) => a.type === "theme");
            const hasSortie = dayActivities.some((a: any) => a.type !== "theme");

            const handleClick = () => {
              if (disabled) return;
              if (selectMode) { toggleDate(dateStr); }
              else { setDayDetailDate(dateStr); }
            };

            return (
              <div
                key={dateStr}
                onClick={handleClick}
                className={`h-24 rounded-lg border-2 p-2 transition overflow-hidden flex flex-col ${
                  disabled
                    ? "bg-slate-50 border-slate-100 cursor-not-allowed opacity-40"
                    : isSelected
                    ? "bg-blue-100 border-blue-500 cursor-pointer ring-2 ring-blue-400/40"
                    : isToday
                    ? `${colors.bg} border-accent-yellow cursor-pointer hover:shadow-md ring-2 ring-accent-yellow/50`
                    : `${colors.bg} border-slate-200 cursor-pointer hover:shadow-md`
                }`}
              >
                <div className={`text-sm font-semibold ${disabled ? "text-slate-300" : "text-slate-800"} flex items-center justify-between`}>
                  {format(day, "d")}
                  <div className="flex gap-0.5 items-center">
                    {isSelected && <span className="w-4 h-4 rounded-pill bg-ink text-white flex items-center justify-center text-[10px] font-bold">✓</span>}
                    {!disabled && !isSelected && (hasTheme || hasSortie) && (
                      <>
                        {hasTheme && <span className="w-2 h-2 rounded-full bg-violet-500" />}
                        {hasSortie && <span className="w-2 h-2 rounded-full bg-orange-500" />}
                      </>
                    )}
                  </div>
                </div>
                {!disabled && (
                  <>
                    <div className="flex items-center justify-between gap-1 mt-1">
                      <span className="text-sm">{colors.icon}</span>
                      {dayJournal && <button className="text-xs text-blue-600 hover:text-blue-800">📋</button>}
                    </div>
                    {dayActivities.length > 0 && !isSelected && (
                      <div className="text-xs mt-1 space-y-0.5 flex-1 overflow-y-auto">
                        {dayActivities.slice(0, 1).map((a: any) => (
                          <div key={a.id} className="bg-white/60 px-1 py-0.5 rounded text-slate-700 truncate">
                            {a.title}
                          </div>
                        ))}
                        {dayActivities.length > 1 && <div className="text-slate-500">+{dayActivities.length - 1}</div>}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="text-xs text-slate-600 space-y-1">
          <div className="font-semibold mb-2">{t("legend")}</div>
          <div className="grid grid-cols-4 gap-4">
            {["present", "absent"].map((status) => {
              const { icon, label } = ATTENDANCE_COLORS[status as AttendanceStatus];
              return (
                <div key={status} className="flex items-center gap-2">
                  <span>{icon}</span>
                  <span>{label}</span>
                </div>
              );
            })}
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-violet-500" />
              <span>{t("dayDetail.theme")}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-orange-500" />
              <span>{t("dayDetail.sortie")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile: Small calendar grid */}
      <div className="md:hidden bg-white rounded-lg shadow p-4 flex flex-col overflow-hidden">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <button onClick={handlePrevMonth} className="p-2 hover:bg-slate-100 rounded-lg transition">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-800">
              {format(currentMonth, "MMM yyyy", { locale: fr })}
            </h2>
            <button
              onClick={() => { setSelectMode(!selectMode); setSelectedDates(new Set()); }}
              className={`px-2 py-1 rounded text-xs font-medium border transition ${
                selectMode ? "bg-ink text-white" : "bg-surface-soft text-ink-secondary"
              }`}
            >
              {selectMode ? `✓ ${selectedDates.size}` : "Multi"}
            </button>
          </div>
          <button onClick={handleNextMonth} className="p-2 hover:bg-slate-100 rounded-lg transition">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Small calendar grid */}
        <div className="overflow-y-auto">
          <div className="grid grid-cols-5 gap-1">
            {["Lun", "Mar", "Mer", "Jeu", "Ven"].map((day) => (
              <div key={day} className="text-center font-semibold text-slate-500 py-1 text-xs">{day}</div>
            ))}
            {Array.from({ length: firstDayOffset }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {days.map((day) => {
              const dateStr = format(day, "yyyy-MM-dd");
              const disabled = isDayDisabled(day);
              const dayAttendance = disabled ? "present" : (attendance[dateStr] || "present") as AttendanceStatus;
              const dayActivities = disabled ? [] : activitiesForDay(day);
              const colors = disabled ? { bg: "bg-slate-50", text: "text-slate-300", icon: null } : ATTENDANCE_COLORS[dayAttendance];
              const isToday = isSameDay(day, today);
              const isSelected = selectedDates.has(dateStr);
              const hasTheme = dayActivities.some((a: any) => a.type === "theme");
              const hasSortie = dayActivities.some((a: any) => a.type !== "theme");

              return (
                <button
                  key={dateStr}
                  onClick={() => {
                    if (disabled) return;
                    if (selectMode) toggleDate(dateStr);
                    else setDayDetailDate(dateStr);
                  }}
                  disabled={disabled}
                  className={`aspect-square rounded p-1 transition flex flex-col items-center justify-center text-xs ${
                    disabled ? "bg-slate-50 opacity-40 cursor-not-allowed"
                    : isSelected ? "bg-blue-100 border-2 border-blue-500"
                    : isToday ? `${colors.bg} border border-accent-yellow ring-1 ring-accent-yellow/50`
                    : `${colors.bg} hover:shadow-sm`
                  }`}
                >
                  <div className="font-semibold text-slate-800">{format(day, "d")}</div>
                  {isSelected
                    ? <span className="text-blue-600 text-[10px] font-bold">✓</span>
                    : <div className="text-xs">{colors.icon}</div>
                  }
                  {!isSelected && (hasTheme || hasSortie) && (
                    <div className="flex gap-0.5 mt-0.5">
                      {hasTheme && <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />}
                      {hasSortie && <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bulk action bar (shared desktop + mobile) */}
      {selectMode && selectedDates.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-white rounded-xl shadow-2xl border border-slate-200 px-4 py-3 flex items-center gap-3 flex-wrap max-w-lg w-full mx-4">
          <span className="text-sm font-semibold text-slate-700 whitespace-nowrap">
            {selectedDates.size} jour{selectedDates.size > 1 ? "s" : ""}
          </span>
          <div className="flex gap-2 flex-wrap flex-1">
            {STAFF_STATUSES.map((s) => (
              <button
                key={s.key}
                onClick={() => handleBulkStatus(s.key)}
                disabled={bulkLoading}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${s.cls} disabled:opacity-50`}
              >
                {bulkLoading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : `${s.icon} ${s.label}`}
              </button>
            ))}
          </div>
          <button onClick={clearSelection} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Status modal */}
      {statusModalDate && (
        <StaffStatusModal
          date={statusModalDate}
          childId={child.id}
          onClose={() => setStatusModalDate(null)}
          onStatusChange={() => {
            setStatusModalDate(null);
            mutateAttendance();
          }}
        />
      )}

      {/* Day detail modal */}
      {dayDetailDate && (
        <DayDetailModalAdmin
          date={dayDetailDate}
          child={child}
          monthStr={monthStr}
          onClose={() => setDayDetailDate(null)}
        />
      )}
    </div>
  );
}

function StaffStatusModal({
  date,
  childId,
  onClose,
  onStatusChange,
}: {
  date: string;
  childId: string;
  onClose: () => void;
  onStatusChange: () => void;
}) {
  const t = useTranslations("calendar");
  const [loading, setLoading] = useState(false);

  const handleSetStatus = async (status: string) => {
    setLoading(true);
    try {
      await attendanceApi.setStatus(childId, date, status);
      onStatusChange();
      onClose();
    } catch (error) {
      console.error("Error setting status:", error);
    } finally {
      setLoading(false);
    }
  };

  const statuses: Array<{ key: string; label: string; color: string }> = [
    { key: "present", label: "✓ Présent", color: "bg-green-100 text-green-700 border-green-300 hover:bg-green-200" },
    { key: "absent", label: "✗ Absent", color: "bg-red-100 text-red-700 border-red-300 hover:bg-red-200" },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-sm w-full p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-4">Marquer la présence</h3>
        <div className="space-y-3">
          {statuses.map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => handleSetStatus(key)}
              disabled={loading}
              className={`w-full px-4 py-2 rounded-lg font-medium border transition disabled:opacity-50 ${color}`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={onClose}
            disabled={loading}
            className="w-full px-4 py-2 bg-slate-100 text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-200 transition font-medium disabled:opacity-50"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

function JournalsSection({
  child,
  weekStart,
  setWeekStart,
  localData,
  setLocalData,
  activeDayIndex,
  setActiveDayIndex,
  saveStatus,
  setSaveStatus,
  saveTimerRef,
}: {
  child: Child;
  weekStart: Date;
  setWeekStart: (date: Date) => void;
  localData: Record<string, DayData>;
  setLocalData: (data: Record<string, DayData>) => void;
  activeDayIndex: number;
  setActiveDayIndex: (index: number) => void;
  saveStatus: "idle" | "saving" | "saved";
  setSaveStatus: (status: "idle" | "saving" | "saved") => void;
  saveTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}) {
  const t = useTranslations("journal");

  const [localMenuWeather, setLocalMenuWeather] = useState<Record<string, string | null>>({});
  const weatherSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const weekStartStr = formatDate(weekStart);
  const weekDates = WEEK_DAYS.map((_, i) => addDays(weekStart, i));
  const today = formatDateInMontreal(getTodayInMontreal());

  const { data: settingsData } = useSWR("settings-journal", () =>
    settingsApi.get().then((r) => r.data as { journal_auto_send_time: string })
  );
  const autoSendTime = settingsData?.journal_auto_send_time ?? "16:30";

  const swrKey = child?.id ? ["journal-week-dash", child.id, weekStartStr] : null;
  const { data: journalData, mutate } = useSWR(swrKey, () =>
    journalApi.getWeek(child.id, weekStartStr)
  );

  const serverEntries: DailyJournal[] =
    (journalData as { data: DailyJournal[] } | undefined)?.data ?? [];

  const { data: menusData } = useSWR(["menus-week-journal-dash", weekStartStr], () =>
    menusApi.getWeek(weekStartStr)
  );
  interface MenuEntry {
    date: string;
    weather?: string;
    menu?: string;
    collation_matin?: string;
    diner?: string;
    collation_apres_midi?: string;
  }
  const serverMenus: MenuEntry[] =
    (menusData as { data: MenuEntry[] } | undefined)?.data ?? [];
  const getMenuForDate = (dateStr: string) => {
    const menuEntry = serverMenus.find((m) => m.date === dateStr);
    if (!menuEntry) return null;
    return {
      weather: menuEntry.weather,
      collation_matin: menuEntry.collation_matin,
      diner: menuEntry.diner,
      collation_apres_midi: menuEntry.collation_apres_midi,
    };
  };

  const getWeatherForDate = (dateStr: string): string | null => {
    if (localMenuWeather[dateStr] !== undefined) return localMenuWeather[dateStr];
    const menu = getMenuForDate(dateStr);
    return menu?.weather ?? null;
  };

  const updateWeather = (dateStr: string, weather: string | null) => {
    setLocalMenuWeather((prev) => ({ ...prev, [dateStr]: weather }));
  };

  // Load activities (weekly themes)
  const monthStr = format(weekStart, "yyyy-MM");
  const { data: activitiesData } = useSWR(
    child?.id ? ["activities-journal-dash", child?.id, monthStr] : null,
    async () => {
      if (!child?.id) return { data: { activities: [] } };
      return activitiesApi.list(monthStr, child.id);
    }
  );
  const activities = (activitiesData as { data: { activities: any[] } } | undefined)?.data?.activities ?? [];

  const getWeeklyThemeForDate = (dateStr: string) => {
    // Find theme activity that covers this date
    try {
      const theme = activities.find((a: any) => {
        if (!a || a.type !== "theme") return false;
        if (!a.date) return false;
        const end = a.end_date || a.date;
        return dateStr >= a.date && dateStr <= end;
      });
      return theme || null;
    } catch (error) {
      console.error("Error getting weekly theme:", error);
      return null;
    }
  };

  const getDayData = useCallback(
    (dateStr: string): DayData => {
      if (localData[dateStr]) return localData[dateStr];
      const server = serverEntries.find((e) => e.date === dateStr);
      return server ?? emptyDay(dateStr);
    },
    [localData, serverEntries]
  );

  const updateField = (dateStr: string, field: keyof DayData, value: DayData[keyof DayData]) => {
    setLocalData({
      ...localData,
      [dateStr]: { ...(localData[dateStr] ?? getDayData(dateStr)), [field]: value },
    });
  };

  // Auto-save debounce
  useEffect(() => {
    if (Object.keys(localData).length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (!child?.id || Object.keys(localData).length === 0) return;
      setSaveStatus("saving");
      try {
        await Promise.all(
          Object.entries(localData).map(([dateStr, day]) => {
            const { date: _date, ...fields } = day;
            return journalApi.upsert({ child_id: child.id, date: dateStr, ...fields });
          })
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

  // Auto-save weather debounce (updates menu table, not journals)
  useEffect(() => {
    if (Object.keys(localMenuWeather).length === 0) return;
    if (weatherSaveTimerRef.current) clearTimeout(weatherSaveTimerRef.current);
    weatherSaveTimerRef.current = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        await Promise.all(
          Object.entries(localMenuWeather).map(([dateStr, weather]) => {
            return menusApi.upsert({ date: dateStr, weather });
          })
        );
        setLocalMenuWeather({});
        // Refetch menus to get updated data
        if (swrKey) mutate();
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("idle");
      }
    }, 1500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localMenuWeather]);

  const prevWeek = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (weatherSaveTimerRef.current) clearTimeout(weatherSaveTimerRef.current);
    setLocalData({});
    setLocalMenuWeather({});
    setSaveStatus("idle");
    const newStart = addDays(weekStart, -7);
    setWeekStart(newStart);
    setActiveDayIndex(getDefaultActiveDayIndex(newStart));
  };

  const nextWeek = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (weatherSaveTimerRef.current) clearTimeout(weatherSaveTimerRef.current);
    setLocalData({});
    setLocalMenuWeather({});
    setSaveStatus("idle");
    const newStart = addDays(weekStart, 7);
    setWeekStart(newStart);
    setActiveDayIndex(getDefaultActiveDayIndex(newStart));
  };

  const saveIndicator =
    saveStatus === "saving" ? (
      <span className="text-xs text-slate-400 flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" /> Enregistrement...
      </span>
    ) : saveStatus === "saved" ? (
      <span className="text-xs text-green-600 flex items-center gap-1">
        <Check className="w-3 h-3" /> Enregistré
      </span>
    ) : null;

  const tabs = weekDates.map((date, i) => {
    const dateStr = formatDate(date);
    const serverEntry = serverEntries.find((e) => e.date === dateStr);
    const localEntry = localData[dateStr];
    const isAbsent = !!(localEntry ? localEntry.absent : serverEntry?.absent);
    return {
      dateStr,
      label: t(`days.${WEEK_DAYS[i]}`).slice(0, 3),
      hasData: !!serverEntry,
      hasUnsaved: !!(localEntry && hasDayData(localEntry)),
      isToday: dateStr === today,
      isAbsent,
    };
  });

  function renderField(field: FieldKey, day: DayData, dateStr: string) {
    const set = (val: DayData[keyof DayData]) => updateField(dateStr, field as keyof DayData, val);
    switch (field) {
      case "appetit":     return <EmojiPicker options={APPETIT_OPTIONS} value={day.appetit ?? null} onChange={(v) => set(v)} />;
      case "humeur":      return <EmojiPicker options={HUMEUR_OPTIONS} value={day.humeur ?? null} onChange={(v) => set(v)} />;
      case "sommeil":     return <SleepBar value={day.sommeil_minutes ?? null} onChange={(v) => updateField(dateStr, "sommeil_minutes", v)} />;
      case "menu":        return <TextareaField value={day.menu ?? ""} onChange={(v) => set(v)} placeholder={t("menuNotePlaceholder")} rows={2} />;
      case "sante":       return <TextareaField value={day.sante ?? ""} onChange={(v) => set(v)} placeholder={t("healthPlaceholder")} rows={2} />;
      case "medicaments": return <TextareaField value={day.medicaments ?? ""} onChange={(v) => set(v)} placeholder={t("medicationsPlaceholder")} rows={2} />;
      case "message_educatrice": return <TextareaField value={day.message_educatrice ?? ""} onChange={(v) => set(v)} placeholder={t("messagePlaceholder")} rows={2} />;
      case "observations": return <TextareaField value={day.observations ?? ""} onChange={(v) => set(v)} placeholder={t("observationsPlaceholder")} rows={3} />;
    }
  }

  // Week nav bar
  const weekNav = (
    <div className="flex items-center gap-2">
      <button onClick={prevWeek} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition" title={t("prevWeek")}>
        <ChevronLeft className="w-4 h-4 text-slate-600" />
      </button>
      <span className="text-sm text-slate-600 font-medium whitespace-nowrap">
        {weekStart.toLocaleDateString("fr-CA", { day: "numeric", month: "short", year: "numeric" })}
      </span>
      <button onClick={nextWeek} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition" title={t("nextWeek")}>
        <ChevronRight className="w-4 h-4 text-slate-600" />
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">
        {weekNav}
        <div className="flex items-center gap-1.5 text-xs text-slate-400 ml-2">
          <Clock className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Envoi automatique à <strong className="text-slate-600">{autoSendTime}</strong> en semaine</span>
        </div>
        <div className="ml-auto">
          {saveIndicator}
        </div>
      </div>

      {/* Desktop: Grid */}
      <div className="hidden md:block overflow-x-auto">
        <div className="rounded-xl overflow-hidden shadow-soft">
          <div className="grid min-w-[800px] bg-border-soft/60 gap-px" style={{ gridTemplateColumns: "160px repeat(5, 1fr)" }}>
            {/* Header row */}
            <div className="bg-surface-soft p-3 text-caption font-semibold text-ink-muted uppercase tracking-wide" />
            {weekDates.map((date, i) => {
              const dateStr = formatDate(date);
              const isToday = dateStr === today;
              const day = getDayData(dateStr);
              const isAbsent = !!day.absent;
              const hasUnsaved = !!(localData[dateStr] && hasDayData(localData[dateStr]));
              const menuDuJour = getMenuForDate(dateStr);
              return (
                <div key={i} className={`p-3 text-center ${isAbsent ? "bg-status-danger/8" : isToday ? "bg-accent-yellow/30" : "bg-surface-soft"}`}>
                  <div className={`text-caption font-semibold uppercase tracking-wide ${isAbsent ? "text-status-danger" : isToday ? "text-ink" : "text-ink-muted"}`}>
                    {t(`days.${WEEK_DAYS[i]}`)}
                  </div>
                  <div className={`text-body font-medium mt-0.5 ${isAbsent ? "text-status-danger" : "text-ink"}`}>
                    {date.getDate()}{" "}
                    <span className={`font-normal ${isToday ? "text-primary/70" : "text-ink-muted"}`}>
                      {date.toLocaleDateString("fr-CA", { month: "short" })}
                    </span>
                  </div>
                  {isAbsent ? (
                    <div className="w-1.5 h-1.5 rounded-pill bg-status-danger mx-auto mt-1" />
                  ) : hasUnsaved ? (
                    <div className="w-1.5 h-1.5 rounded-pill bg-accent-orange mx-auto mt-1" />
                  ) : isToday ? (
                    <div className="w-1.5 h-1.5 rounded-pill bg-primary mx-auto mt-1" />
                  ) : null}
                  {menuDuJour && ((() => {
                    const hasMenu = menuDuJour.collation_matin || menuDuJour.diner || menuDuJour.collation_apres_midi;
                    if (!hasMenu) return null;
                    return (
                      <div className="mt-1.5 space-y-0.5">
                        {menuDuJour.collation_matin && (
                          <div className="text-caption text-accent-blue bg-accent-blue/15 rounded-xs px-1 py-0.5 truncate" title={menuDuJour.collation_matin}>
                            🌅 {menuDuJour.collation_matin}
                          </div>
                        )}
                        {menuDuJour.diner && (
                          <div className="text-caption text-accent-orange bg-accent-orange/15 rounded-xs px-1 py-0.5 truncate" title={menuDuJour.diner}>
                            🍽️ {menuDuJour.diner}
                          </div>
                        )}
                        {menuDuJour.collation_apres_midi && (
                          <div className="text-caption text-accent-purple bg-accent-purple/15 rounded-xs px-1 py-0.5 truncate" title={menuDuJour.collation_apres_midi}>
                            🌙 {menuDuJour.collation_apres_midi}
                          </div>
                        )}
                      </div>
                    );
                  })())}
                </div>
              );
            })}

            {/* Weather row (garderie-wide, stored in daily_menus) */}
            <div className="bg-surface-soft p-3 text-caption font-medium text-ink-secondary flex items-center gap-1.5">
              🌤️ Météo
            </div>
            {weekDates.map((date, di) => {
              const dateStr = formatDate(date);
              const weather = getWeatherForDate(dateStr);
              const day = getDayData(dateStr);
              const isAbsent = !!day.absent;
              const isToday = dateStr === today;
              return (
                <div key={`weather-${di}`} className={`p-2 ${isAbsent ? "bg-status-danger/5" : isToday ? "bg-accent-yellow/10" : "bg-surface-card"}`}>
                  <WeatherPicker
                    value={weather}
                    onChange={(v) => updateWeather(dateStr, v)}
                  />
                </div>
              );
            })}

            {/* Absent toggle row */}
            <div className="bg-surface-soft p-3 text-caption font-medium text-ink-secondary flex items-center gap-1.5">
              Absent
            </div>
            {weekDates.map((date, di) => {
              const dateStr = formatDate(date);
              const day = getDayData(dateStr);
              const isAbsent = !!day.absent;
              const isToday = dateStr === today;
              return (
                <div key={`absent-${di}`} className={`p-2 flex items-center justify-center ${isAbsent ? "bg-status-danger/8" : isToday ? "bg-accent-yellow/15" : "bg-surface-card"}`}>
                  <button
                    type="button"
                    onClick={() => updateField(dateStr, "absent" as keyof DayData, !isAbsent)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-pill transition-all duration-[180ms] focus:outline-none ${isAbsent ? "bg-status-danger" : "bg-border-soft"}`}
                  >
                    <span className={`inline-block h-3 w-3 transform rounded-pill bg-white shadow transition-transform duration-[180ms] ${isAbsent ? "translate-x-5" : "translate-x-1"}`} />
                  </button>
                </div>
              );
            })}

            {/* Field rows */}
            {FIELD_ROWS.map((field) => (
              <div key={`field-${field}`} className="contents">
                <div className="bg-surface-soft p-3 text-caption font-medium text-ink-secondary flex items-start pt-4">
                  {t(`fields.${field === "sommeil" ? "sommeil" : field}`)}
                </div>
                {weekDates.map((date, di) => {
                  const dateStr = formatDate(date);
                  const day = getDayData(dateStr);
                  const isAbsent = !!day.absent;
                  const isToday = dateStr === today;
                  return (
                    <div key={`${field}-${di}`} className={`p-2 ${isAbsent ? "bg-status-danger/5 opacity-30 pointer-events-none select-none" : isToday ? "bg-accent-yellow/10" : "bg-surface-card"}`}>
                      {renderField(field, day, dateStr)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile: Day tabs */}
      <div className="md:hidden space-y-2">
        <DayTabBar tabs={tabs} activeIndex={activeDayIndex} onSelect={setActiveDayIndex} />
        <div className="space-y-4">
          {/* Weather picker (garderie-wide, applies to all children) */}
          <div className="px-4 py-3 border border-border-soft rounded-xl bg-sky-50/30">
            <div className="flex items-center justify-between mb-2">
              <label className="text-caption font-semibold uppercase tracking-wide text-sky-700 flex items-center gap-1.5">
                <span className="text-base">🌤️</span>
                Météo du jour
              </label>
              <span className="text-caption text-ink-muted">
                (Partagée pour tous)
              </span>
            </div>
            <WeatherPicker
              value={getWeatherForDate(formatDate(weekDates[activeDayIndex]))}
              onChange={(v) => updateWeather(formatDate(weekDates[activeDayIndex]), v)}
            />
          </div>

          <DayFieldList
            day={getDayData(formatDate(weekDates[activeDayIndex]))}
            menuDuJour={getMenuForDate(formatDate(weekDates[activeDayIndex]))}
            weeklyTheme={getWeeklyThemeForDate(formatDate(weekDates[activeDayIndex]))}
            readOnly={false}
            onFieldChange={(field, value) =>
              updateField(formatDate(weekDates[activeDayIndex]), field as keyof DayData, value as DayData[keyof DayData])
            }
            appetitOptions={APPETIT_OPTIONS}
            humeurOptions={HUMEUR_OPTIONS}
            placeholders={{
              menu: t("menuNotePlaceholder"),
              sante: t("healthPlaceholder"),
              medicaments: t("medicationsPlaceholder"),
              message_educatrice: t("messagePlaceholder"),
              observations: t("observationsPlaceholder"),
            }}
          />
        </div>
        {/* Save indicator */}
        <div className="pt-4 flex justify-center">
          {saveIndicator}
        </div>
      </div>
    </div>
  );
}

type FieldKey = typeof FIELD_ROWS[number];

function ChildCard({
  child,
  groupMap,
}: {
  child: Child;
  groupMap: Record<string, string>;
}) {
  const t = useTranslations("children");

  const ageDisplay = (birthDate: string) => {
    const diff = Date.now() - new Date(birthDate).getTime();
    const months = Math.floor(diff / (1000 * 60 * 60 * 24 * 30));
    if (months < 24) return `${months} ${t("months")}`;
    return `${Math.floor(months / 12)} ${t("years")}`;
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden p-5">
      <div className="flex items-center gap-4">
        <ChildAvatar id={child.id} firstName={child.first_name} lastName={child.last_name} size="lg" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 text-lg">
            {child.first_name} {child.last_name}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            {ageDisplay(child.birth_date)}
            {child.group_id && groupMap[child.group_id] && (
              <span className="ml-2 text-blue-600">· {groupMap[child.group_id]}</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ChildrenPage() {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const { user } = useAuth();
  const canWrite = user?.role === "admin_garderie" || user?.role === "super_admin";
  const [selectedChildId, setSelectedChildId] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [filterGroupId, setFilterGroupId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"calendar" | "journals" | "profile">("calendar");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [statusModalDate, setStatusModalDate] = useState<string | null>(null);
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);
  // Journal tab state
  const [journalWeekStart, setJournalWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [journalLocalData, setJournalLocalData] = useState<Record<string, DayData>>({});
  const [journalActiveDayIndex, setJournalActiveDayIndex] = useState(() => getDefaultActiveDayIndex(getMonday(new Date())));
  const [journalSaveStatus, setJournalSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const journalSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const CREATE_DAYS = [
    { num: 1, label: "Lun" }, { num: 2, label: "Mar" }, { num: 3, label: "Mer" },
    { num: 4, label: "Jeu" }, { num: 5, label: "Ven" },
  ];
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    birth_date: "",
    group_id: "",
    notes: "",
    start_date: "",
    schedule_days: [1, 2, 3, 4, 5] as number[],
  });
  const [saving, setSaving] = useState(false);

  const toggleCreateDay = (day: number) =>
    setForm((p) => ({
      ...p,
      schedule_days: p.schedule_days.includes(day)
        ? p.schedule_days.filter((d) => d !== day)
        : [...p.schedule_days, day].sort(),
    }));

  // Reset journal state when child changes (but keep activeTab)
  useEffect(() => {
    setJournalWeekStart(getMonday(new Date()));
    setJournalLocalData({});
    setJournalActiveDayIndex(getDefaultActiveDayIndex(getMonday(new Date())));
    setJournalSaveStatus("idle");
    if (journalSaveTimerRef.current) clearTimeout(journalSaveTimerRef.current);
  }, [selectedChildId]);

  const { data, mutate } = useSWR("children-list", () => childrenApi.list());

  // Auto-select first child when list loads
  useEffect(() => {
    const childrenList: Child[] = (data as { data: Child[] } | undefined)?.data ?? [];
    if (childrenList.length > 0 && !selectedChildId) {
      setSelectedChildId(childrenList[0].id);
    }
  }, [data, selectedChildId]);
  const { data: groupsData } = useSWR("groups-list-ch", () => groupsApi.list());

  const children: Child[] = (data as { data: Child[] } | undefined)?.data ?? [];
  const groups: Group[] = (groupsData as { data: Group[] } | undefined)?.data ?? [];
  const groupMap = Object.fromEntries(groups.map((g) => [g.id, g.name]));

  // Fetch attendance for all children for current month
  const todayDate = getTodayInMontreal();
  const today = format(todayDate, "yyyy-MM-dd");
  const currentMonthStr = format(new Date(), "yyyy-MM");
  
  const { data: attendanceAllData } = useSWR(
    `attendance-all-${currentMonthStr}`,
    () => attendanceApi.getMonthAllChildren(currentMonthStr).then((r) => r.data.attendance || [])
  );

  // Map attendance by child_id and date for quick lookup
  const attendanceByChild = new Map<string, Record<string, string>>();
  if (attendanceAllData && Array.isArray(attendanceAllData)) {
    attendanceAllData.forEach((record: { child_id: string; date: string; status: string }) => {
      if (!attendanceByChild.has(record.child_id)) {
        attendanceByChild.set(record.child_id, {});
      }
      attendanceByChild.get(record.child_id)![record.date] = record.status;
    });
  }

  // Filter children by selected group
  const filteredChildren = filterGroupId
    ? children.filter((c) => c.group_id === filterGroupId)
    : children;

  // Auto-select first filtered child if current selection is not in filtered list
  useEffect(() => {
    if (filteredChildren.length > 0) {
      const isCurrentChildInFiltered = filteredChildren.some((c) => c.id === selectedChildId);
      if (!isCurrentChildInFiltered) {
        setSelectedChildId(filteredChildren[0].id);
      }
    } else if (selectedChildId) {
      setSelectedChildId("");
    }
  }, [filterGroupId, filteredChildren.length, filteredChildren, selectedChildId]);

  const selectedChild = filteredChildren.find((c) => c.id === selectedChildId);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await childrenApi.create({
        first_name: form.first_name,
        last_name: form.last_name,
        birth_date: form.birth_date,
        group_id: form.group_id || undefined,
        notes: form.notes || undefined,
        start_date: form.start_date || undefined,
        schedule_days: form.schedule_days,
      });
      setForm({ first_name: "", last_name: "", birth_date: "", group_id: "", notes: "", start_date: "", schedule_days: [1, 2, 3, 4, 5] });
      setShowForm(false);
      mutate();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Desktop sidebar: child list ── */}
      <aside className="hidden md:flex flex-col w-64 bg-white/80 backdrop-blur-sm shadow-soft flex-shrink-0 my-3 ml-3 rounded-xl overflow-hidden">
        <div className="px-4 py-4 border-b border-border-soft/50">
          <h1 className="text-body font-semibold text-ink">{t("title")}</h1>
        </div>
        
        {/* Group filter */}
        {groups.length > 0 && (
          <div className="px-3 py-2 border-b border-border-soft/50">
            <select
              value={filterGroupId}
              onChange={(e) => setFilterGroupId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t("allGroups")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        )}
        
        <div className="flex-1 overflow-y-auto py-2 px-2">
          {filteredChildren.length === 0 && (
            <p className="px-4 py-3 text-body text-ink-muted">{t("noChildren")}</p>
          )}
          {filteredChildren.map((child) => {
            const isActive = selectedChildId === child.id;
            const childAttendance = attendanceByChild.get(child.id);
            const todayStatus = childAttendance ? childAttendance[today] : undefined;
            
            return (
              <button
                key={child.id}
                onClick={() => setSelectedChildId(child.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-pill text-left transition-all duration-[180ms] ${
                  isActive
                    ? "bg-ink text-white"
                    : "text-ink-secondary hover:bg-surface-soft hover:text-ink"
                }`}
              >
                <ChildAvatar id={child.id} firstName={child.first_name} lastName={child.last_name} size="sm" />
                <span className={`text-body truncate ${isActive ? "font-semibold" : ""}`}>
                  {child.first_name} {child.last_name}
                </span>
                <ChildStatusIndicators 
                  childId={child.id}
                  today={today}
                  currentMonthStr={currentMonthStr}
                  attendanceStatus={todayStatus}
                />
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── Desktop main content ── */}
      <div className="hidden md:flex flex-col flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-soft/50 flex-shrink-0">
          <h1 className="text-body font-semibold text-ink">{t("title")}</h1>
          {canWrite && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-pill text-body font-medium hover:opacity-90 transition-all duration-[180ms]"
            >
              <Plus className="w-4 h-4" />
              {t("add")}
            </button>
          )}
        </div>

        {!selectedChildId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Plus className="w-12 h-12 opacity-30" />
            <p className="text-sm">{t("selectChild")}</p>
          </div>
        ) : selectedChild ? (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Tab bar */}
            <div className="px-6 py-3 flex-shrink-0">
              <div className="flex items-center gap-1 bg-white/60 backdrop-blur-sm rounded-pill px-2 py-1.5 shadow-soft w-fit">
                <TabButton active={activeTab === "calendar"} onClick={() => setActiveTab("calendar")}>
                  Calendrier
                </TabButton>
                <TabButton active={activeTab === "journals"} onClick={() => setActiveTab("journals")}>
                  Journal de bord
                </TabButton>
                <TabButton active={activeTab === "profile"} onClick={() => setActiveTab("profile")}>
                  Profil
                </TabButton>
              </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {activeTab === "calendar" && selectedChild && (
                <CalendarSection
                  child={selectedChild}
                  currentMonth={currentMonth}
                  setCurrentMonth={setCurrentMonth}
                  statusModalDate={statusModalDate}
                  setStatusModalDate={setStatusModalDate}
                  dayDetailDate={dayDetailDate}
                  setDayDetailDate={setDayDetailDate}
                />
              )}
              {activeTab === "journals" && selectedChild && (
                <JournalsSection
                  child={selectedChild}
                  weekStart={journalWeekStart}
                  setWeekStart={setJournalWeekStart}
                  localData={journalLocalData}
                  setLocalData={setJournalLocalData}
                  activeDayIndex={journalActiveDayIndex}
                  setActiveDayIndex={setJournalActiveDayIndex}
                  saveStatus={journalSaveStatus}
                  setSaveStatus={setJournalSaveStatus}
                  saveTimerRef={journalSaveTimerRef}
                />
              )}
              {activeTab === "profile" && (
                <div className="space-y-4">
                  <ChildCard child={selectedChild} groupMap={groupMap} />
                  <ChildDetails
                    child={selectedChild}
                    groups={groups}
                    groupMap={groupMap}
                    onUpdated={() => mutate()}
                    canWrite={canWrite}
                  />
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Mobile ── */}
      <div className="md:hidden flex flex-col h-full w-full overflow-hidden">
        {/* Mobile header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-soft/50 flex-shrink-0">
          <h1 className="text-body font-semibold text-ink">{t("title")}</h1>
          {canWrite && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1 px-3 py-1.5 bg-ink text-white rounded-pill text-body font-medium hover:opacity-90 transition-all duration-[180ms]"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("add")}
            </button>
          )}
        </div>

        {/* Group filter (mobile) */}
        {groups.length > 0 && (
          <div className="px-4 py-2 border-b border-border-soft/50 flex-shrink-0">
            <select
              value={filterGroupId}
              onChange={(e) => setFilterGroupId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t("allGroups")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Child chips */}
        {filteredChildren.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-4 py-2.5 border-b border-border-soft/50 flex-shrink-0 scrollbar-none">
            {filteredChildren.map((child) => {
              const isActive = selectedChildId === child.id;
              const childAttendance = attendanceByChild.get(child.id);
              const todayStatus = childAttendance ? childAttendance[today] : undefined;
              
              return (
                <button
                  key={child.id}
                  onClick={() => setSelectedChildId(child.id)}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-body font-medium transition-all duration-[180ms] ${
                    isActive
                      ? "bg-ink text-white"
                      : "bg-surface-soft text-ink-secondary"
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
                    isActive ? "bg-white/25 text-white" : `${childAvatarColor(child.id)} text-white`
                  }`}>
                    {child.first_name[0]}
                  </span>
                  {child.first_name}
                  <ChildStatusIndicators 
                    childId={child.id}
                    today={today}
                    currentMonthStr={currentMonthStr}
                    attendanceStatus={todayStatus}
                  />
                </button>
              );
            })}
          </div>
        )}

        {!selectedChildId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Plus className="w-10 h-10 opacity-30" />
            <p className="text-sm">{t("selectChild")}</p>
          </div>
        ) : selectedChild ? (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Tab bar */}
            <div className="px-4 py-3 flex-shrink-0 overflow-x-auto scrollbar-none">
              <div className="flex items-center gap-1 bg-white/60 backdrop-blur-sm rounded-pill px-2 py-1.5 shadow-soft w-fit">
                <TabButton active={activeTab === "calendar"} onClick={() => setActiveTab("calendar")}>
                  Calendrier
                </TabButton>
                <TabButton active={activeTab === "journals"} onClick={() => setActiveTab("journals")}>
                  Journal
                </TabButton>
                <TabButton active={activeTab === "profile"} onClick={() => setActiveTab("profile")}>
                  Profil
                </TabButton>
              </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto pb-4">
              <div className="px-4 py-4 space-y-4">
                {activeTab === "calendar" && selectedChild && (
                  <CalendarSection
                    child={selectedChild}
                    currentMonth={currentMonth}
                    setCurrentMonth={setCurrentMonth}
                    statusModalDate={statusModalDate}
                    setStatusModalDate={setStatusModalDate}
                    dayDetailDate={dayDetailDate}
                    setDayDetailDate={setDayDetailDate}
                  />
                )}
                {activeTab === "journals" && selectedChild && (
                  <JournalsSection
                    child={selectedChild}
                    weekStart={journalWeekStart}
                    setWeekStart={setJournalWeekStart}
                    localData={journalLocalData}
                    setLocalData={setJournalLocalData}
                    activeDayIndex={journalActiveDayIndex}
                    setActiveDayIndex={setJournalActiveDayIndex}
                    saveStatus={journalSaveStatus}
                    setSaveStatus={setJournalSaveStatus}
                    saveTimerRef={journalSaveTimerRef}
                  />
                )}
                {activeTab === "profile" && (
                  <>
                    <ChildCard child={selectedChild} groupMap={groupMap} />
                    <ChildDetails
                      child={selectedChild}
                      groups={groups}
                      groupMap={groupMap}
                      onUpdated={() => mutate()}
                      canWrite={canWrite}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Add form modal overlay (shown on both desktop and mobile) ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-800">{t("add")}</h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input
                  placeholder={t("firstName")}
                  value={form.first_name}
                  onChange={(e) => setForm((p) => ({ ...p, first_name: e.target.value }))}
                  className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
                <input
                  placeholder={t("lastName")}
                  value={form.last_name}
                  onChange={(e) => setForm((p) => ({ ...p, last_name: e.target.value }))}
                  className="px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <input
                type="date"
                value={form.birth_date}
                onChange={(e) => setForm((p) => ({ ...p, birth_date: e.target.value }))}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              <select
                value={form.group_id}
                onChange={(e) => setForm((p) => ({ ...p, group_id: e.target.value }))}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t("group")} ({tc("optional")})</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Date de commencement <span className="font-normal text-slate-400">({tc("optional")})</span>
                </label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-2">
                  Jours de présence
                </label>
                <div className="flex gap-2">
                  {CREATE_DAYS.map(({ num, label }) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => toggleCreateDay(num)}
                      className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition ${
                        form.schedule_days.includes(num)
                          ? "bg-ink text-white"
                          : "bg-surface-soft text-ink-muted hover:bg-border-soft"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-ink text-white text-body rounded-pill hover:opacity-90 transition-all duration-[180ms] disabled:opacity-50"
                >
                  {saving ? tc("loading") : tc("create")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-5 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50"
                >
                  {tc("cancel")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
