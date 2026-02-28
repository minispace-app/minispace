"use client";

import { useState, useEffect, useCallback } from "react";
import { superAdminApi } from "../../../lib/api";
import { Plus, Users, ChevronRight, Eye, EyeOff, Building2, UserPlus, Mail, Pencil, X, Trash2, AlertTriangle, Save, RotateCcw, Megaphone, BarChart2 } from "lucide-react";

interface Garderie {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  plan: string;
  is_active: boolean;
  created_at: string;
}

interface TenantUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  preferred_locale: string;
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super-admin",
  admin_garderie: "Admin garderie",
  educateur: "Éducateur·trice",
  parent: "Parent",
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-purple-100 text-purple-700",
  admin_garderie: "bg-blue-100 text-blue-700",
  educateur: "bg-green-100 text-green-700",
  parent: "bg-slate-100 text-slate-600",
};

export default function SuperAdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [authError, setAuthError] = useState("");

  const [garderies, setGarderies] = useState<Garderie[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [garderieUsers, setGarderieUsers] = useState<TenantUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Forms
  const [showCreateGarderie, setShowCreateGarderie] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [editGarderie, setEditGarderie] = useState<Garderie | null>(null);

  const [garderieForm, setGarderieForm] = useState({ slug: "", name: "", address: "", phone: "", email: "", plan: "free" });
  const [userForm, setUserForm] = useState({ email: "", first_name: "", last_name: "", password: "", role: "admin_garderie", preferred_locale: "fr" });
   const [saving, setSaving] = useState(false);
   const [formError, setFormError] = useState("");
   const [backupLoading, setBackupLoading] = useState(false);

  // Restore
  interface BackupEntry { timestamp: string; date: string; db_file: string; media_file: string | null; }
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [backupsList, setBackupsList] = useState<BackupEntry[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupEntry | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);

  // Invite user modal (super-admin)
  const [showInviteUser, setShowInviteUser] = useState(false);
  const [inviteUserForm, setInviteUserForm] = useState({ email: "", role: "admin_garderie" });
  const [inviteUserError, setInviteUserError] = useState("");
  const [inviteUserSuccess, setInviteUserSuccess] = useState("");
  const [inviteSaving, setInviteSaving] = useState(false);

  // Delete garderie modal
  const [deleteTarget, setDeleteTarget] = useState<Garderie | null>(null);
  const [deleteKeyInput, setDeleteKeyInput] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Announcement
  interface AnnouncementData { message: string; color: string; }
  const [currentAnnouncement, setCurrentAnnouncement] = useState<AnnouncementData | null>(null);
  const [announcementMsg, setAnnouncementMsg] = useState("");
  const [announcementColor, setAnnouncementColor] = useState<"yellow" | "red">("yellow");
  const [announcementSaving, setAnnouncementSaving] = useState(false);

  // Check stored key on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("super_admin_key");
      if (stored) {
        setAuthenticated(true);
        loadGarderies();
        loadAnnouncement();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAnnouncement = async () => {
    try {
      const res = await superAdminApi.getAnnouncement();
      setCurrentAnnouncement(res.data || null);
      if (res.data) {
        setAnnouncementMsg(res.data.message);
        setAnnouncementColor(res.data.color as "yellow" | "red");
      }
    } catch {
      setCurrentAnnouncement(null);
    }
  };

  const handleSetAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!announcementMsg.trim()) return;
    setAnnouncementSaving(true);
    try {
      await superAdminApi.setAnnouncement(announcementMsg.trim(), announcementColor);
      await loadAnnouncement();
    } finally {
      setAnnouncementSaving(false);
    }
  };

  const handleDeleteAnnouncement = async () => {
    if (!confirm("Retirer l'annonce en cours ?")) return;
    await superAdminApi.deleteAnnouncement();
    setCurrentAnnouncement(null);
    setAnnouncementMsg("");
    setAnnouncementColor("yellow");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      localStorage.setItem("super_admin_key", keyInput);
      await superAdminApi.listGarderies();
      setAuthenticated(true);
      loadGarderies();
    } catch {
      localStorage.removeItem("super_admin_key");
      setAuthError("Clé invalide");
    }
  };

  const loadGarderies = useCallback(async () => {
    try {
      const res = await superAdminApi.listGarderies();
      setGarderies(res.data);
    } catch {
      setAuthenticated(false);
      localStorage.removeItem("super_admin_key");
    }
  }, []);

  const loadGarderieUsers = useCallback(async (slug: string) => {
    setLoadingUsers(true);
    try {
      const res = await superAdminApi.listGarderieUsers(slug);
      setGarderieUsers(res.data);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const selectGarderie = (slug: string) => {
    if (selectedSlug === slug) {
      setSelectedSlug(null);
      setGarderieUsers([]);
    } else {
      setSelectedSlug(slug);
      loadGarderieUsers(slug);
    }
    setShowCreateUser(false);
  };

  const handleCreateGarderie = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      await superAdminApi.createGarderie({
        slug: garderieForm.slug,
        name: garderieForm.name,
        address: garderieForm.address || undefined,
        phone: garderieForm.phone || undefined,
        email: garderieForm.email || undefined,
        plan: garderieForm.plan,
      });
      setShowCreateGarderie(false);
      setGarderieForm({ slug: "", name: "", address: "", phone: "", email: "", plan: "free" });
      loadGarderies();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setFormError(e?.response?.data?.error || "Erreur lors de la création");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateGarderie = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editGarderie) return;
    setSaving(true);
    setFormError("");
    try {
      await superAdminApi.updateGarderie(editGarderie.slug, {
        name: garderieForm.name || undefined,
        address: garderieForm.address || undefined,
        phone: garderieForm.phone || undefined,
        email: garderieForm.email || undefined,
      });
      setEditGarderie(null);
      loadGarderies();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setFormError(e?.response?.data?.error || "Erreur lors de la mise à jour");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlug) return;
    setSaving(true);
    setFormError("");
    try {
      await superAdminApi.createGarderieUser(selectedSlug, userForm);
      setShowCreateUser(false);
      setUserForm({ email: "", first_name: "", last_name: "", password: "", role: "admin_garderie", preferred_locale: "fr" });
      loadGarderieUsers(selectedSlug);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setFormError(e?.response?.data?.error || "Erreur lors de la création");
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivateUser = async (userId: string) => {
    if (!selectedSlug) return;
    if (!confirm("Désactiver cet utilisateur ?")) return;
    await superAdminApi.deactivateGarderieUser(selectedSlug, userId);
    loadGarderieUsers(selectedSlug);
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlug) return;
    setInviteSaving(true);
    setInviteUserError("");
    setInviteUserSuccess("");
    try {
      await superAdminApi.inviteGarderieUser(selectedSlug, inviteUserForm.email, inviteUserForm.role);
      setInviteUserSuccess(`Invitation envoyée à ${inviteUserForm.email}`);
      setInviteUserForm({ email: "", role: "admin_garderie" });
      setTimeout(() => { setShowInviteUser(false); setInviteUserSuccess(""); }, 2000);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setInviteUserError(e?.response?.data?.error || "Erreur lors de l'envoi");
    } finally {
      setInviteSaving(false);
    }
  };

  const handleBackup = async () => {
    if (!confirm("Sauvegarder l'ensemble de la base de données et des médias? Cela peut prendre quelques minutes.")) return;
    setBackupLoading(true);
    try {
      const res = await superAdminApi.triggerBackupAll();
      alert(`Sauvegarde terminée!\n\nDB: ${res.data.files.db}\nMédia: ${res.data.files.media || 'N/A'}`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      alert(`Erreur: ${e?.response?.data?.error || 'Erreur inconnue'}`);
    } finally {
      setBackupLoading(false);
    }
  };

  const openRestoreModal = async () => {
    setShowRestoreModal(true);
    setSelectedBackup(null);
    setLoadingBackups(true);
    try {
      const res = await superAdminApi.listBackups();
      setBackupsList(res.data);
    } catch {
      setBackupsList([]);
    } finally {
      setLoadingBackups(false);
    }
  };

  const handleRestore = async () => {
    if (!selectedBackup) return;
    if (!confirm(`Restaurer la sauvegarde du ${selectedBackup.date}?\n\nCette action va écraser toutes les données actuelles. Cette opération est irréversible.`)) return;
    setRestoreLoading(true);
    try {
      await superAdminApi.triggerRestore(selectedBackup.db_file, selectedBackup.media_file ?? undefined);
      alert(`Restauration terminée! La base de données a été restaurée au ${selectedBackup.date}.`);
      setShowRestoreModal(false);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      alert(`Erreur: ${e?.response?.data?.error || 'Erreur inconnue'}`);
    } finally {
      setRestoreLoading(false);
    }
  };

  const openDeleteModal = (g: Garderie) => {
    setDeleteTarget(g);
    setDeleteKeyInput("");
    setDeleteError("");
  };

  const closeDeleteModal = () => {
    setDeleteTarget(null);
    setDeleteKeyInput("");
    setDeleteError("");
  };

  const handleDeleteGarderie = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteTarget) return;
    const storedKey = typeof window !== "undefined" ? localStorage.getItem("super_admin_key") || "" : "";
    if (deleteKeyInput !== storedKey) {
      setDeleteError("Clé incorrecte");
      return;
    }
    setDeleting(true);
    setDeleteError("");
    try {
      await superAdminApi.deleteGarderie(deleteTarget.slug);
      closeDeleteModal();
      if (selectedSlug === deleteTarget.slug) {
        setSelectedSlug(null);
        setGarderieUsers([]);
      }
      loadGarderies();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setDeleteError(e?.response?.data?.error || "Erreur lors de la suppression");
    } finally {
      setDeleting(false);
    }
  };

  // ── Login screen ────────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-purple-600 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-slate-800">Super-Admin</h1>
              <p className="text-sm text-slate-500">minispace.app</p>
            </div>
          </div>

          {authError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{authError}</div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Clé d&apos;accès</label>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  className="w-full px-4 py-2.5 pr-10 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
                <button type="button" onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button type="submit"
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition">
              Connexion
            </button>
          </form>
        </div>
      </div>
    );
  }

  const selectedGarderie = garderies.find((g) => g.slug === selectedSlug);

  // ── Main interface ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <h1 className="font-bold text-slate-800">minispace.app — Super-Admin</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              const key = typeof window !== "undefined" ? localStorage.getItem("super_admin_key") || "" : "";
              try {
                await fetch("/api/super-admin/grafana-access", {
                  method: "POST",
                  credentials: "include",
                  headers: { "X-Super-Admin-Key": key },
                });
              } catch { /* ignore */ }
              window.open("/grafana/", "_blank");
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-medium rounded-lg hover:bg-violet-700 transition"
          >
            <BarChart2 className="w-3.5 h-3.5" />
            Monitoring
          </button>
          <button
            onClick={handleBackup}
            disabled={backupLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
          >
            <Save className="w-3.5 h-3.5" />
            {backupLoading ? "Sauvegarde..." : "Sauvegarder tout"}
          </button>
          <button
            onClick={openRestoreModal}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restaurer
          </button>
          <button
            onClick={() => { localStorage.removeItem("super_admin_key"); setAuthenticated(false); }}
            className="text-sm text-slate-500 hover:text-red-500 transition"
          >
            Déconnexion
          </button>
        </div>
      </header>

      {/* ── Announcement banner ── */}
      <div className="max-w-7xl mx-auto px-6 pt-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Megaphone className="w-4 h-4 text-purple-600" />
            <h2 className="font-semibold text-slate-800">Annonce globale</h2>
            {currentAnnouncement && (
              <span className={`ml-2 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                currentAnnouncement.color === "red"
                  ? "bg-red-100 text-red-700"
                  : "bg-yellow-100 text-yellow-700"
              }`}>
                Active
              </span>
            )}
          </div>

          {currentAnnouncement && (
            <div className={`mb-4 px-4 py-3 rounded-lg border text-sm flex items-start gap-2 ${
              currentAnnouncement.color === "red"
                ? "bg-red-50 border-red-200 text-red-800"
                : "bg-yellow-50 border-yellow-200 text-yellow-800"
            }`}>
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p className="flex-1">{currentAnnouncement.message}</p>
              <button
                onClick={handleDeleteAnnouncement}
                className="flex-shrink-0 text-slate-400 hover:text-red-500 transition"
                title="Retirer l'annonce"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <form onSubmit={handleSetAnnouncement} className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-xs font-medium text-slate-500 mb-1 block">
                {currentAnnouncement ? "Remplacer l'annonce" : "Nouvelle annonce"}
              </label>
              <input
                value={announcementMsg}
                onChange={(e) => setAnnouncementMsg(e.target.value)}
                placeholder="Ex : Maintenance planifiée ce dimanche de 8h à 12h."
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Couleur</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAnnouncementColor("yellow")}
                  className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition ${
                    announcementColor === "yellow"
                      ? "bg-yellow-400 border-yellow-400 text-white"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Jaune
                </button>
                <button
                  type="button"
                  onClick={() => setAnnouncementColor("red")}
                  className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition ${
                    announcementColor === "red"
                      ? "bg-red-500 border-red-500 text-white"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Rouge
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={announcementSaving || !announcementMsg.trim()}
              className="px-4 py-2.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition"
            >
              {announcementSaving ? "Envoi..." : "Publier"}
            </button>
          </form>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 flex gap-6">

        {/* Left: Garderies list */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-800">
              Garderies ({garderies.length})
            </h2>
            <button
              onClick={() => { setShowCreateGarderie(!showCreateGarderie); setEditGarderie(null); setFormError(""); }}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition"
            >
              <Plus className="w-4 h-4" />
              Nouvelle garderie
            </button>
          </div>

          {/* Create garderie form */}
          {showCreateGarderie && (
            <div className="mb-4 bg-white rounded-xl border border-purple-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-800">Créer une garderie</h3>
                <button onClick={() => setShowCreateGarderie(false)}><X className="w-4 h-4 text-slate-400" /></button>
              </div>
              {formError && <p className="mb-3 text-sm text-red-500">{formError}</p>}
              <form onSubmit={handleCreateGarderie} className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600">Identifiant (slug) *</label>
                  <input value={garderieForm.slug} onChange={e => setGarderieForm(f => ({...f, slug: e.target.value}))}
                    placeholder="garderie-abc" required
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Nom *</label>
                  <input value={garderieForm.name} onChange={e => setGarderieForm(f => ({...f, name: e.target.value}))}
                    placeholder="Garderie ABC" required
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Courriel</label>
                  <input type="email" value={garderieForm.email} onChange={e => setGarderieForm(f => ({...f, email: e.target.value}))}
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Téléphone</label>
                  <input value={garderieForm.phone} onChange={e => setGarderieForm(f => ({...f, phone: e.target.value}))}
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-slate-600">Adresse</label>
                  <input value={garderieForm.address} onChange={e => setGarderieForm(f => ({...f, address: e.target.value}))}
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Plan</label>
                  <select value={garderieForm.plan} onChange={e => setGarderieForm(f => ({...f, plan: e.target.value}))}
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                    <option value="free">Gratuit</option>
                    <option value="standard">Standard</option>
                    <option value="premium">Premium</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button type="submit" disabled={saving}
                    className="w-full py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition">
                    {saving ? "Création..." : "Créer"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Edit garderie form */}
          {editGarderie && (
            <div className="mb-4 bg-white rounded-xl border border-blue-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-800">Modifier : {editGarderie.name}</h3>
                <button onClick={() => setEditGarderie(null)}><X className="w-4 h-4 text-slate-400" /></button>
              </div>
              {formError && <p className="mb-3 text-sm text-red-500">{formError}</p>}
              <form onSubmit={handleUpdateGarderie} className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600">Nom</label>
                  <input value={garderieForm.name} onChange={e => setGarderieForm(f => ({...f, name: e.target.value}))}
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Courriel</label>
                  <input type="email" value={garderieForm.email} onChange={e => setGarderieForm(f => ({...f, email: e.target.value}))}
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Téléphone</label>
                  <input value={garderieForm.phone} onChange={e => setGarderieForm(f => ({...f, phone: e.target.value}))}
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Adresse</label>
                  <input value={garderieForm.address} onChange={e => setGarderieForm(f => ({...f, address: e.target.value}))}
                    className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div className="col-span-2 flex justify-end">
                  <button type="submit" disabled={saving}
                    className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition">
                    {saving ? "Enregistrement..." : "Enregistrer"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Garderies table */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {garderies.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>Aucune garderie. Créez la première.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Nom</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Slug</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Plan</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Statut</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {garderies.map((g) => (
                    <tr
                      key={g.id}
                      className={`border-b border-slate-50 hover:bg-slate-50 cursor-pointer transition ${selectedSlug === g.slug ? "bg-purple-50" : ""}`}
                      onClick={() => selectGarderie(g.slug)}
                    >
                      <td className="px-4 py-3 font-medium text-slate-800">{g.name}</td>
                      <td className="px-4 py-3 text-slate-500 font-mono text-xs">{g.slug}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600 capitalize">{g.plan}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${g.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-500"}`}>
                          {g.is_active ? "Actif" : "Inactif"}
                        </span>
                      </td>
                      <td className="px-4 py-3 flex items-center gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            setEditGarderie(g);
                            setGarderieForm({ slug: g.slug, name: g.name, address: g.address || "", phone: g.phone || "", email: g.email || "", plan: g.plan });
                            setShowCreateGarderie(false);
                            setFormError("");
                          }}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="Modifier"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openDeleteModal(g)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="Supprimer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => selectGarderie(g.slug)}
                          className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition"
                          title="Gérer les utilisateurs"
                        >
                          <ChevronRight className={`w-4 h-4 transition ${selectedSlug === g.slug ? "rotate-90 text-purple-600" : ""}`} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Invite user modal */}
        {showInviteUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-blue-600" />
                  <h3 className="font-bold text-slate-800">Inviter un utilisateur</h3>
                  {selectedGarderie && (
                    <span className="text-sm text-slate-500">— {selectedGarderie.name}</span>
                  )}
                </div>
                <button onClick={() => { setShowInviteUser(false); setInviteUserError(""); setInviteUserSuccess(""); }}>
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>
              {inviteUserSuccess ? (
                <div className="py-4 text-center">
                  <p className="text-green-600 font-medium">{inviteUserSuccess}</p>
                </div>
              ) : (
                <form onSubmit={handleInviteUser} className="space-y-4">
                  {inviteUserError && <p className="text-sm text-red-600">{inviteUserError}</p>}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Courriel</label>
                    <input
                      type="email"
                      value={inviteUserForm.email}
                      onChange={e => setInviteUserForm(f => ({ ...f, email: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                      required
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Rôle</label>
                    <select
                      value={inviteUserForm.role}
                      onChange={e => setInviteUserForm(f => ({ ...f, role: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      <option value="admin_garderie">Admin garderie</option>
                      <option value="educateur">Éducateur·trice</option>
                      <option value="parent">Parent</option>
                    </select>
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button type="submit" disabled={inviteSaving}
                      className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm disabled:opacity-50 transition">
                      {inviteSaving ? "Envoi..." : "Envoyer l'invitation"}
                    </button>
                    <button type="button" onClick={() => { setShowInviteUser(false); setInviteUserError(""); }}
                      className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-lg text-sm hover:bg-slate-50 transition">
                      Annuler
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {/* Delete garderie modal */}
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6">
              <div className="flex items-start gap-4 mb-5">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-lg">Supprimer la garderie</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Vous êtes sur le point de supprimer{" "}
                    <span className="font-semibold text-slate-700">{deleteTarget.name}</span>.
                  </p>
                  <p className="text-sm text-red-600 mt-2 font-medium">
                    Cette action est irréversible. Toutes les données (utilisateurs, enfants, messages, médias, documents) seront définitivement supprimées.
                  </p>
                </div>
              </div>

              <form onSubmit={handleDeleteGarderie} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Entrez votre clé super-admin pour confirmer
                  </label>
                  <input
                    type="password"
                    value={deleteKeyInput}
                    onChange={(e) => { setDeleteKeyInput(e.target.value); setDeleteError(""); }}
                    placeholder="Clé super-admin"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                    autoFocus
                    required
                  />
                  {deleteError && (
                    <p className="mt-1.5 text-xs text-red-500">{deleteError}</p>
                  )}
                </div>
                <div className="flex gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={deleting || !deleteKeyInput}
                    className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg text-sm disabled:opacity-50 transition"
                  >
                    {deleting ? "Suppression..." : "Supprimer définitivement"}
                  </button>
                  <button
                    type="button"
                    onClick={closeDeleteModal}
                    className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-lg text-sm hover:bg-slate-50 transition"
                  >
                    Annuler
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Restore modal */}
        {showRestoreModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl p-6">
              <div className="flex items-start gap-4 mb-5">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <RotateCcw className="w-5 h-5 text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-slate-800 text-lg">Restaurer une sauvegarde</h3>
                  <p className="text-sm text-red-600 mt-1 font-medium">
                    Cette action écrase toutes les données actuelles de façon irréversible.
                  </p>
                </div>
                <button onClick={() => setShowRestoreModal(false)}>
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>

              {loadingBackups ? (
                <div className="py-8 text-center text-slate-400 text-sm">Chargement des sauvegardes...</div>
              ) : backupsList.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-sm">Aucune sauvegarde disponible.</div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto mb-5">
                  {backupsList.map((b) => (
                    <button
                      key={b.timestamp}
                      onClick={() => setSelectedBackup(b)}
                      className={`w-full text-left px-4 py-3 rounded-xl border transition ${
                        selectedBackup?.timestamp === b.timestamp
                          ? "border-amber-400 bg-amber-50"
                          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <p className="text-sm font-semibold text-slate-800">{b.date}</p>
                      <div className="flex gap-3 mt-1">
                        <span className="text-xs text-slate-500">
                          <span className="text-green-600 font-medium">DB</span> {b.db_file}
                        </span>
                        {b.media_file && (
                          <span className="text-xs text-slate-500">
                            <span className="text-blue-600 font-medium">Médias</span> ✓
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleRestore}
                  disabled={!selectedBackup || restoreLoading}
                  className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg text-sm disabled:opacity-50 transition"
                >
                  {restoreLoading ? "Restauration..." : "Restaurer"}
                </button>
                <button
                  onClick={() => setShowRestoreModal(false)}
                  className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-medium rounded-lg text-sm hover:bg-slate-50 transition"
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Right: Users panel */}
        {selectedSlug && (
          <div className="w-96 flex-shrink-0">
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                    <Users className="w-4 h-4 text-purple-500" />
                    {selectedGarderie?.name}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">{garderieUsers.length} utilisateur{garderieUsers.length !== 1 ? "s" : ""}</p>
                </div>
                 <div className="flex gap-2">
                   <button
                     onClick={() => { setShowInviteUser(true); setInviteUserError(""); setInviteUserSuccess(""); }}
                     className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition"
                   >
                     <Mail className="w-3.5 h-3.5" />
                     Inviter
                   </button>
                   <button
                     onClick={() => { setShowCreateUser(!showCreateUser); setFormError(""); }}
                     className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 transition"
                   >
                     <UserPlus className="w-3.5 h-3.5" />
                     Ajouter
                   </button>
                 </div>
              </div>

              {/* Create user form */}
              {showCreateUser && (
                <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
                  {formError && <p className="mb-2 text-xs text-red-500">{formError}</p>}
                  <form onSubmit={handleCreateUser} className="space-y-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-500">Prénom *</label>
                        <input value={userForm.first_name} onChange={e => setUserForm(f => ({...f, first_name: e.target.value}))}
                          required className="mt-0.5 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-purple-400" />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Nom *</label>
                        <input value={userForm.last_name} onChange={e => setUserForm(f => ({...f, last_name: e.target.value}))}
                          required className="mt-0.5 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-purple-400" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Courriel *</label>
                      <input type="email" value={userForm.email} onChange={e => setUserForm(f => ({...f, email: e.target.value}))}
                        required className="mt-0.5 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-purple-400" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">Mot de passe *</label>
                      <input type="password" value={userForm.password} onChange={e => setUserForm(f => ({...f, password: e.target.value}))}
                        required className="mt-0.5 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-purple-400" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-slate-500">Rôle</label>
                        <select value={userForm.role} onChange={e => setUserForm(f => ({...f, role: e.target.value}))}
                          className="mt-0.5 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-purple-400">
                          <option value="admin_garderie">Admin garderie</option>
                          <option value="educateur">Éducateur·trice</option>
                          <option value="parent">Parent</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Langue</label>
                        <select value={userForm.preferred_locale} onChange={e => setUserForm(f => ({...f, preferred_locale: e.target.value}))}
                          className="mt-0.5 w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-purple-400">
                          <option value="fr">Français</option>
                          <option value="en">English</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button type="submit" disabled={saving}
                        className="flex-1 py-1.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50 transition">
                        {saving ? "Création..." : "Créer"}
                      </button>
                      <button type="button" onClick={() => setShowCreateUser(false)}
                        className="px-3 py-1.5 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50 transition">
                        Annuler
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* User list */}
              {loadingUsers ? (
                <div className="p-8 text-center text-slate-400 text-sm">Chargement...</div>
              ) : garderieUsers.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-sm">
                  Aucun utilisateur. Ajoutez un admin.
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {garderieUsers.map((u) => (
                    <div key={u.id} className="px-5 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {u.first_name} {u.last_name}
                          {!u.is_active && <span className="ml-2 text-xs text-red-400">(inactif)</span>}
                        </p>
                        <p className="text-xs text-slate-400 truncate">{u.email}</p>
                        <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[u.role] || "bg-slate-100 text-slate-600"}`}>
                          {ROLE_LABELS[u.role] || u.role}
                        </span>
                      </div>
                      {u.is_active && (
                        <button
                          onClick={() => handleDeactivateUser(u.id)}
                          className="flex-shrink-0 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                          title="Désactiver"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
