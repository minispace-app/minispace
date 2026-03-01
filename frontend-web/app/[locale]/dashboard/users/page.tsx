"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { usersApi, authApi } from "../../../../lib/api";
import { Mail, UserCheck, UserX, Pencil, X, Check, KeyRound, Lock, Camera, AlertCircle } from "lucide-react";
import PendingInvitationsTable from "../../../../components/PendingInvitationsTable";

interface TenantUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  preferred_locale: string;
  privacy_accepted?: boolean;
  photos_accepted?: boolean;
  deletion_requested?: boolean;
}

const ROLE_COLORS: Record<string, string> = {
  admin_garderie: "bg-blue-100 text-blue-700",
  educateur: "bg-green-100 text-green-700",
  parent: "bg-slate-100 text-slate-600",
};

const fetcher = () => usersApi.list().then((r) => r.data);

export default function UsersPage() {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const { data: users = [], mutate } = useSWR<TenantUser[]>("/users", fetcher);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "parent" });
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetMethod, setResetMethod] = useState<"email" | "temp_password">("email");
  const [resetPassword, setResetPassword] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const roleLabels: Record<string, string> = {
    admin_garderie: t("roleAdminShort"),
    educateur: t("roleEducator"),
    parent: t("roleParent"),
  };

  const [editForm, setEditForm] = useState<{
    first_name: string; last_name: string;
    role: string; is_active: boolean; preferred_locale: string;
  }>({ first_name: "", last_name: "", role: "educateur", is_active: true, preferred_locale: "fr" });

  const startEdit = (u: TenantUser) => {
    setEditId(u.id);
    setEditForm({ first_name: u.first_name, last_name: u.last_name, role: u.role, is_active: u.is_active, preferred_locale: u.preferred_locale });
  };

  const handleInvite = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setInviteSuccess("");
    try {
      await authApi.invite(inviteForm.email, inviteForm.role);
      setInviteSuccess(t("inviteSuccess"));
      setInviteForm({ email: "", role: "parent" });
      setTimeout(() => { setShowInvite(false); setInviteSuccess(""); }, 2000);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error || t("inviteError"));
    } finally {
      setSaving(false);
    }
  }, [inviteForm, t]);

  const handleUpdate = useCallback(async (id: string) => {
    setSaving(true);
    setError("");
    try {
      await usersApi.update(id, editForm);
      setEditId(null);
      mutate();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error || t("updateError"));
    } finally {
      setSaving(false);
    }
  }, [editForm, mutate, t]);

  const handleDeactivate = useCallback(async (id: string) => {
    setDeleteTargetId(id);
    setAdminPassword("");
    setDeleteError("");
    setDeleteModalOpen(true);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTargetId) return;
    setSaving(true);
    setDeleteError("");
    try {
      await usersApi.deactivate(deleteTargetId, adminPassword, true);
      setDeleteModalOpen(false);
      setDeleteTargetId(null);
      setAdminPassword("");
      mutate();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setDeleteError(e?.response?.data?.error || t("deleteError"));
    } finally {
      setSaving(false);
    }
  }, [deleteTargetId, adminPassword, mutate, t]);

  const handleResetPassword = useCallback(async () => {
    if (!resetUserId) return;
    setSaving(true);
    setError("");
    try {
      const res = await usersApi.resetPassword(resetUserId, resetMethod);
      setResetPassword(res.data.temp_password || null);
      setResetUserId(null);
      mutate();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e?.response?.data?.error || t("resetError"));
    } finally {
      setSaving(false);
    }
  }, [resetUserId, resetMethod, mutate, t]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t("title")}</h1>
          <p className="text-slate-500 text-sm mt-1">{users.length} {t("title").toLowerCase()}</p>
        </div>
        <button
          onClick={() => { setShowInvite(true); setError(""); setInviteSuccess(""); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
        >
          <Mail className="w-4 h-4" />
          {t("inviteUser")}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
      )}


      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-bold text-slate-800">{t("inviteTitle")}</h2>
              </div>
              <button onClick={() => { setShowInvite(false); setError(""); setInviteSuccess(""); }}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            {inviteSuccess ? (
              <div className="py-4 text-center">
                <p className="text-green-600 font-medium">{inviteSuccess}</p>
              </div>
            ) : (
              <form onSubmit={handleInvite} className="space-y-4">
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{t("inviteEmailLabel")}</label>
                  <input
                    type="email"
                    value={inviteForm.email}
                    onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{t("role")}</label>
                  <select
                    value={inviteForm.role}
                    onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="admin_garderie">{t("roleAdmin")}</option>
                    <option value="educateur">{t("roleEducator")}</option>
                    <option value="parent">{t("roleParent")}</option>
                  </select>
                </div>
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => { setShowInvite(false); setError(""); }}
                    className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50 transition">
                    {tc("cancel")}
                  </button>
                  <button type="submit" disabled={saving}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition">
                    {saving ? t("inviteSending") : t("inviteSend")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {users.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <UserCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>{t("noUsers")}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t("nameCol")}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t("emailCol")}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t("role")}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t("language")}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t("status")}</th>
                <th className="text-center px-4 py-3 font-medium text-slate-600" title="Privacy Policy Consent">
                  <Lock className="w-4 h-4 mx-auto text-slate-400" />
                </th>
                <th className="text-center px-4 py-3 font-medium text-slate-600" title="Photo Consent">
                  <Camera className="w-4 h-4 mx-auto text-slate-400" />
                </th>
                <th className="text-center px-4 py-3 font-medium text-slate-600" title="Deletion Requested">
                  <AlertCircle className="w-4 h-4 mx-auto text-slate-400" />
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                editId === u.id ? (
                  <tr key={u.id} className="border-b border-slate-50 bg-blue-50">
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <input value={editForm.first_name} onChange={e => setEditForm(f => ({...f, first_name: e.target.value}))}
                          className="w-24 px-2 py-1 border border-blue-200 rounded text-sm" />
                        <input value={editForm.last_name} onChange={e => setEditForm(f => ({...f, last_name: e.target.value}))}
                          className="w-24 px-2 py-1 border border-blue-200 rounded text-sm" />
                      </div>
                    </td>
                    <td className="px-4 py-2 text-slate-400">{u.email}</td>
                    <td className="px-4 py-2">
                      <select value={editForm.role} onChange={e => setEditForm(f => ({...f, role: e.target.value}))}
                        className="px-2 py-1 border border-blue-200 rounded text-sm">
                        <option value="admin_garderie">{t("roleAdminShort")}</option>
                        <option value="educateur">{t("roleEducator")}</option>
                        <option value="parent">{t("roleParent")}</option>
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <select value={editForm.preferred_locale} onChange={e => setEditForm(f => ({...f, preferred_locale: e.target.value}))}
                        className="px-2 py-1 border border-blue-200 rounded text-sm">
                        <option value="fr">FR</option>
                        <option value="en">EN</option>
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={editForm.is_active}
                          onChange={e => setEditForm(f => ({...f, is_active: e.target.checked}))} />
                        <span className="text-xs text-slate-600">{t("active")}</span>
                      </label>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => handleUpdate(u.id)} disabled={saving}
                          className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditId(null)}
                          className="p-1.5 text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg transition">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {u.first_name} {u.last_name}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[u.role] || "bg-slate-100 text-slate-600"}`}>
                        {roleLabels[u.role] || u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 uppercase text-xs">{u.preferred_locale}</td>
                    <td className="px-4 py-3">
                      {u.is_active ? (
                        <span className="flex items-center gap-1 text-green-600 text-xs"><UserCheck className="w-3.5 h-3.5" />{t("active")}</span>
                      ) : (
                        <span className="flex items-center gap-1 text-slate-400 text-xs"><UserX className="w-3.5 h-3.5" />{t("inactive")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {u.privacy_accepted ? (
                        <span className="inline-flex items-center justify-center w-6 h-6 bg-green-100 rounded-full">
                          <Check className="w-3.5 h-3.5 text-green-600" />
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center w-6 h-6 bg-slate-100 rounded-full">
                          <X className="w-3.5 h-3.5 text-slate-400" />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {u.photos_accepted ? (
                        <span className="inline-flex items-center justify-center w-6 h-6 bg-blue-100 rounded-full">
                          <Check className="w-3.5 h-3.5 text-blue-600" />
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center w-6 h-6 bg-slate-100 rounded-full">
                          <X className="w-3.5 h-3.5 text-slate-400" />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {u.deletion_requested ? (
                        <span className="inline-flex items-center justify-center w-6 h-6 bg-red-100 rounded-full" title="Deletion requested">
                          <AlertCircle className="w-3.5 h-3.5 text-red-600" />
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center w-6 h-6 bg-slate-100 rounded-full">
                          <Check className="w-3.5 h-3.5 text-slate-300" />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        <button onClick={() => startEdit(u)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => { setResetUserId(u.id); setResetModalOpen(true); setResetPassword(null); }}
                          className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition" title={t("resetPasswordTitle")}>
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                        {u.is_active && (
                          <button onClick={() => handleDeactivate(u.id)}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
                            <UserX className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Reset password modal */}
      {resetModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <KeyRound className="w-5 h-5 text-amber-600" />
              <h2 className="text-lg font-bold text-slate-800">{t("resetPasswordTitle")}</h2>
            </div>

            {resetPassword ? (
              <div>
                <p className="text-sm text-slate-600 mb-3">{t("tempPasswordGenerated")}</p>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                  <code className="text-lg font-mono font-bold text-blue-700 select-all">{resetPassword}</code>
                </div>
                <p className="text-xs text-slate-500 mb-4">{t("tempPasswordNote")}</p>
                <button onClick={() => { setResetModalOpen(false); setResetPassword(null); setResetUserId(null); }}
                  className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition">
                  {t("close")}
                </button>
              </div>
            ) : (
              <div>
                <p className="text-sm text-slate-600 mb-4">{t("resetMethodTitle")}</p>
                <div className="space-y-3 mb-4">
                  <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition"
                    onClick={() => setResetMethod("email")}>
                    <input type="radio" name="method" checked={resetMethod === "email"} readOnly className="w-4 h-4" />
                    <div>
                      <p className="font-medium text-slate-800 text-sm">{t("resetByEmail")}</p>
                      <p className="text-xs text-slate-500">{t("resetByEmailDesc")}</p>
                    </div>
                  </label>
                  <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition"
                    onClick={() => setResetMethod("temp_password")}>
                    <input type="radio" name="method" checked={resetMethod === "temp_password"} readOnly className="w-4 h-4" />
                    <div>
                      <p className="font-medium text-slate-800 text-sm">{t("resetByTemp")}</p>
                      <p className="text-xs text-slate-500">{t("resetByTempDesc")}</p>
                    </div>
                  </label>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setResetModalOpen(false); setResetUserId(null); }}
                    className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition">
                    {tc("cancel")}
                  </button>
                  <button onClick={handleResetPassword} disabled={saving}
                    className="flex-1 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 transition">
                    {saving ? "..." : t("resetAction")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete user modal */}
      {deleteModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <UserX className="w-5 h-5 text-red-600" />
              <h2 className="text-lg font-bold text-slate-800">{t("deleteTitle")}</h2>
            </div>
            <p className="text-sm text-slate-600 mb-3">{t("deleteWarning")}</p>
            {deleteError && <div className="mb-3 text-sm text-red-600">{deleteError}</div>}
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-600 mb-1">{t("yourPassword")}</label>
              <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setDeleteModalOpen(false); setDeleteTargetId(null); setAdminPassword(""); }}
                className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-50 transition">
                {tc("cancel")}
              </button>
              <button onClick={confirmDelete} disabled={saving}
                className="flex-1 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition">
                {saving ? "..." : tc("delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pending Invitations Section */}
      <div className="mt-8">
        <h2 className="text-xl font-bold text-slate-800 mb-4">{t("pendingInvitations")}</h2>
        <PendingInvitationsTable />
      </div>
    </div>
  );
}
