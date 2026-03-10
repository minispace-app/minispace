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
      month: 'short',
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
      <div className="bg-surface-card rounded-xl shadow-card p-8 text-center text-body text-ink-muted">
        {tc('loading')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-status-danger/10 rounded-xl p-4 text-body text-status-danger">
        {error}
      </div>
    );
  }

  if (invitations.length === 0) {
    return (
      <div className="bg-surface-card rounded-xl shadow-soft p-6 text-body text-ink-muted text-center">
        {t('noPendingInvitations')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {resendSuccess && (
        <div className="bg-status-success/10 rounded-xl p-3 text-body text-status-success font-medium">
          {resendSuccess}
        </div>
      )}

      <div className="bg-surface-card rounded-xl shadow-card overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-5 py-3 bg-surface-soft border-b border-border-soft">
          <span className="text-caption font-semibold text-ink-muted uppercase tracking-wide">{t('emailCol')}</span>
          <span className="text-caption font-semibold text-ink-muted uppercase tracking-wide">{t('role')}</span>
          <span className="text-caption font-semibold text-ink-muted uppercase tracking-wide hidden md:block">{t('invitedBy')}</span>
          <span className="text-caption font-semibold text-ink-muted uppercase tracking-wide hidden md:block">{t('expiresAt')}</span>
          <span />
        </div>

        {/* Rows */}
        {invitations.map((invitation, i) => (
          <div
            key={invitation.id}
            className={`grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 items-center px-5 py-3.5 hover:bg-surface-soft transition-all duration-[180ms] ${
              i < invitations.length - 1 ? 'border-b border-border-soft' : ''
            }`}
          >
            {/* Email */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-pill bg-status-warning/20 flex items-center justify-center flex-shrink-0">
                <Mail size={14} strokeWidth={1.5} className="text-status-warning" />
              </div>
              <div className="min-w-0">
                <p className="text-body font-medium text-ink truncate">{invitation.email}</p>
                {invitation.invited_by_name && (
                  <p className="text-caption text-ink-muted md:hidden">{invitation.invited_by_name}</p>
                )}
              </div>
            </div>

            {/* Role badge */}
            <span className="text-caption font-semibold rounded-pill px-2.5 py-1 bg-primary-soft text-primary whitespace-nowrap">
              {getRoleLabel(invitation.role)}
            </span>

            {/* Invited by */}
            <span className="text-body text-ink-secondary hidden md:block whitespace-nowrap">
              {invitation.invited_by_name || '—'}
            </span>

            {/* Expires */}
            <span className="text-caption text-ink-muted hidden md:block whitespace-nowrap">
              {formatDate(invitation.expires_at)}
            </span>

            {/* Actions */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleResend(invitation.id)}
                disabled={resendingId === invitation.id}
                className="w-8 h-8 flex items-center justify-center text-ink-muted hover:text-primary hover:bg-primary-soft rounded-pill transition-all duration-[180ms] disabled:opacity-40"
                title={t('inviteSend')}
              >
                <Mail size={14} strokeWidth={1.5} />
              </button>
              <button
                onClick={() => handleDelete(invitation.id)}
                disabled={deletingId === invitation.id}
                className="w-8 h-8 flex items-center justify-center text-ink-muted hover:text-status-danger hover:bg-status-danger/10 rounded-pill transition-all duration-[180ms] disabled:opacity-40"
                title={t('deleteInvitation')}
              >
                <UserX size={14} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
