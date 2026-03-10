"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import useSWR from "swr";
import { useAuth } from "../../../hooks/useAuth";
import { getGarderieName } from "../../../lib/auth";
import { useTenantInfo } from "../../../hooks/useTenantInfo";
import { messagesApi } from "../../../lib/api";
import {
  MessageSquare, Image, FileText, Users, BookOpen,
  LogOut, User, Menu, X, Shield,
} from "lucide-react";
import { LanguageSwitcher } from "../../../components/LanguageSwitcher";
import { AnnouncementBanner } from "../../../components/AnnouncementBanner";

const navItems = [
  { key: "children", icon: Users, href: "/parent/children" },
  { key: "messages", icon: MessageSquare, href: "/parent/messages" },
  { key: "media", icon: Image, href: "/parent/media" },
  { key: "documents", icon: FileText, href: "/parent/documents" },
  { key: "myProfile", icon: User, href: "/parent/profile" },
  { key: "privacy", icon: Shield, href: "/parent/privacy" },
];

export default function ParentLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const params = useParams();
  const locale = params.locale as string;
  const garderieName = getGarderieName() || tc("appName");
  const { logo_url: tenantLogoUrl } = useTenantInfo();
  const { data: conversations } = useSWR(
    "conversations",
    () => messagesApi.getConversations().then((r) => r.data as { unread_count: number }[]),
    { refreshInterval: 30000 }
  );
  const totalUnread = (conversations ?? []).reduce((sum, c) => sum + (c.unread_count || 0), 0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const SidebarContent = ({ onNavigate }: { onNavigate?: () => void }) => (
    <>
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ key, icon: Icon, href }) => {
          const fullHref = `/${locale}${href}`;
          const active = pathname === fullHref;
          return (
            <Link
              key={key}
              href={fullHref}
              onClick={onNavigate}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-body transition-all duration-[180ms] ease-out ${
                active
                  ? "bg-ink text-white font-medium"
                  : "text-ink-secondary hover:bg-surface-soft hover:text-ink"
              }`}
            >
              <Icon size={16} strokeWidth={1.5} className="flex-shrink-0" />
              <span className="flex-1 truncate">{t(key as Parameters<typeof t>[0])}</span>
              {key === "messages" && totalUnread > 0 && (
                <span className="flex-shrink-0 min-w-[1.25rem] h-5 px-1 bg-status-danger text-white text-[10px] rounded-pill flex items-center justify-center font-semibold">
                  {totalUnread > 99 ? "99+" : totalUnread}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 space-y-0.5 border-t border-border-soft/50">
        <div className="flex justify-center py-1.5">
          <LanguageSwitcher />
        </div>
        <button
          onClick={() => logout(locale)}
          className="flex items-center gap-2.5 px-3 py-2 w-full rounded-lg text-body text-ink-secondary hover:bg-status-danger/10 hover:text-status-danger transition-all duration-[180ms] ease-out"
        >
          <LogOut size={16} strokeWidth={1.5} className="flex-shrink-0" />
          <span>{tc("logout")}</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen" style={{ height: "100dvh" }}>
      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex w-60 bg-white/80 backdrop-blur-sm shadow-card flex-col flex-shrink-0 my-3 ml-3 rounded-xl overflow-hidden">
        <div className="px-5 py-5 flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={tenantLogoUrl || "/logo.png"} alt="minispace.app" className="w-28 mb-2" />
          {!tenantLogoUrl && (
            <div className="mb-3 text-center">
              <span className="text-body-lg font-bold" style={{ color: '#001F3F' }}>minispace</span>
              <span className="text-body-lg font-bold" style={{ color: '#ff3c7a' }}>.app</span>
            </div>
          )}
          <h1 className="text-h3 font-semibold text-ink text-center">{garderieName}</h1>
          {user && (
            <p className="text-caption text-ink-secondary mt-0.5">
              {user.first_name} {user.last_name}
            </p>
          )}
        </div>
        <SidebarContent />
      </aside>

      {/* ── Mobile drawer overlay ── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── Mobile drawer ── */}
      <aside
        className={`fixed inset-y-0 left-0 w-72 bg-white/80 backdrop-blur-sm z-50 flex flex-col shadow-hover transform transition-transform duration-300 ease-in-out md:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex flex-col items-center flex-1 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={tenantLogoUrl || "/logo.png"} alt="minispace.app" className="w-24 mb-1" />
            {!tenantLogoUrl && (
              <div className="mb-2 text-center">
                <span className="text-caption font-semibold" style={{ color: '#001F3F' }}>minispace</span>
                <span className="text-caption font-semibold" style={{ color: '#ff3c7a' }}>.app</span>
              </div>
            )}
            <h1 className="font-semibold text-ink text-center text-body truncate w-full">
              {garderieName}
            </h1>
            {user && (
              <p className="text-caption text-ink-secondary">
                {user.first_name} {user.last_name}
              </p>
            )}
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            className="w-9 h-9 flex items-center justify-center text-ink-secondary hover:bg-surface-soft rounded-pill transition-all duration-[180ms] flex-shrink-0"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
        <SidebarContent onNavigate={() => setDrawerOpen(false)} />
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top header — glassmorphism */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-white/60 backdrop-blur-sm shadow-soft flex-shrink-0">
          <button
            onClick={() => setDrawerOpen(true)}
            className="w-9 h-9 flex items-center justify-center text-ink-secondary bg-white/70 backdrop-blur-sm shadow-soft rounded-pill transition-all duration-[180ms]"
          >
            <Menu size={18} strokeWidth={1.5} />
          </button>
          <span className="text-body font-semibold text-ink truncate">{garderieName}</span>
        </header>

        <AnnouncementBanner />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
