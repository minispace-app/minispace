'use client';

import { useEffect, useState } from 'react';
import { authApi } from '@/lib/api';
import { useTranslations } from 'next-intl';
import { UserX, Mail } from 'lucide-react';

interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  invited_by_id: string | null;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
}

export default function PendingInvitationsTable() {
  const t = useTranslations('users');
  const tc = useTranslations('common');
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchInvitations();
  }, []);

  const fetchInvitations = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await authApi.listPendingInvitations();
      setInvitations(response.data || []);
    } catch (err) {
      console.error('Failed to fetch pending invitations:', err);
      setError(t('errorLoadingInvitations'));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async (id: string) => {
    setResendingId(id);
    setResendSuccess(null);
    try {
      await authApi.resendInvitation(id);
      setResendSuccess(t('inviteSuccess'));
      setTimeout(() => setResendSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to resend invitation:', err);
      setError(t('inviteError'));
    } finally {
      setResendingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await authApi.deleteInvitation(id);
      setInvitations((prev) => prev.filter((inv) => inv.id !== id));
    } catch (err) {
      console.error('Failed to delete invitation:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getRoleLabel = (role: string) => {
    const roleMap: Record<string, string> = {
      super_admin: t('roleAdmin'),
      admin_garderie: t('roleAdmin'),
      educateur: t('roleEducator'),
      parent: t('roleParent'),
    };
    return roleMap[role] || role;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="text-gray-500">{tc('loading')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error}
      </div>
    );
  }

  if (invitations.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-gray-600 text-center">
        {t('noPendingInvitations')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {resendSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-700 text-sm">
          {resendSuccess}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-100 border-b border-gray-300">
            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
              {t('emailCol')}
            </th>
            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
              {t('role')}
            </th>
            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
              {t('invitedBy')}
            </th>
            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
              {t('createdAt')}
            </th>
            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">
              {t('expiresAt')}
            </th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {invitations.map((invitation) => (
            <tr
              key={invitation.id}
              className="border-b border-gray-200 hover:bg-gray-50 transition-colors"
            >
              <td className="px-4 py-3 text-sm text-gray-900">{invitation.email}</td>
              <td className="px-4 py-3 text-sm text-gray-700">
                <span className="inline-block bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-medium">
                  {getRoleLabel(invitation.role)}
                </span>
              </td>
              <td className="px-4 py-3 text-sm text-gray-700">
                {invitation.invited_by_name || '—'}
              </td>
              <td className="px-4 py-3 text-sm text-gray-600">
                {formatDate(invitation.created_at)}
              </td>
              <td className="px-4 py-3 text-sm text-gray-600">
                {formatDate(invitation.expires_at)}
              </td>
              <td className="px-4 py-3 text-right flex items-center gap-1 justify-end">
                <button
                  onClick={() => handleResend(invitation.id)}
                  disabled={resendingId === invitation.id}
                  className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition disabled:opacity-40"
                  title={t('inviteSend')}
                >
                  <Mail className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(invitation.id)}
                  disabled={deletingId === invitation.id}
                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition disabled:opacity-40"
                  title={t('deleteInvitation')}
                >
                  <UserX className="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}
