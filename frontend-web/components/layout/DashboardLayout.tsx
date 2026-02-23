"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import { getGarderieName } from "../../lib/auth";
import {
  LayoutDashboard,
  MessageSquare,
  Image,
  FileText,
  Users,
  FolderOpen,
  Settings,
  BookOpen,
  LogOut,
  Menu,
  X,
  User,
} from "lucide-react";
import { LanguageSwitcher } from "../LanguageSwitcher";
import { AnnouncementBanner } from "../AnnouncementBanner";

const navItems = [
  { key: "dashboard", icon: LayoutDashboard, href: "/dashboard", roles: null },
  { key: "messages", icon: MessageSquare, href: "/dashboard/messages", roles: null },
  { key: "media", icon: Image, href: "/dashboard/media", roles: null },
  { key: "documents", icon: FileText, href: "/dashboard/documents", roles: null },
  { key: "children", icon: Users, href: "/dashboard/children", roles: null },
  { key: "groups", icon: FolderOpen, href: "/dashboard/groups", roles: null },
  { key: "journal", icon: BookOpen, href: "/dashboard/journal", roles: null },
  { key: "users", icon: Settings, href: "/dashboard/users", roles: ["admin_garderie", "super_admin"] },
  { key: "myProfile", icon: User, href: "/dashboard/profile", roles: null },
];

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const params = useParams();
  const locale = params.locale as string;
  const garderieName = getGarderieName() || tc("appName");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filteredItems = navItems.filter(
    ({ roles }) => !roles || (user && roles.includes(user.role))
  );

  const SidebarContent = ({ onNavigate }: { onNavigate?: () => void }) => (
    <>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {filteredItems.map(({ key, icon: Icon, href }) => {
          const fullHref = `/${locale}${href}`;
          const active = pathname === fullHref;
          return (
            <Link
              key={key}
              href={fullHref}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${
                active
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {t(key as Parameters<typeof t>[0])}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-slate-100 space-y-2">
        <div className="flex justify-center">
          <LanguageSwitcher />
        </div>
        <button
          onClick={() => logout(locale)}
          className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-slate-600 hover:bg-red-50 hover:text-red-600 transition"
        >
          <LogOut className="w-4 h-4" />
          {tc("logout")}
        </button>
        {process.env.NEXT_PUBLIC_APP_VERSION && (
          <p className="text-center text-xs text-slate-400 pt-1">
            v{process.env.NEXT_PUBLIC_APP_VERSION}
          </p>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-slate-50">
      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex w-64 bg-white border-r border-slate-200 flex-col flex-shrink-0">
        <div className="px-6 py-5 border-b border-slate-100 flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="minispace.app" className="w-28 mb-2" />
          <h1 className="font-bold text-lg text-slate-800 text-center">{garderieName}</h1>
          {user && (
            <p className="text-sm text-slate-500 mt-0.5">
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
        className={`fixed inset-y-0 left-0 w-72 bg-white z-50 flex flex-col shadow-xl transform transition-transform duration-300 ease-in-out md:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex flex-col items-center flex-1 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="GarderieConnect" className="w-24 mb-1" />
            <h1 className="font-bold text-slate-800 text-center text-sm truncate w-full">
              {garderieName}
            </h1>
            {user && (
              <p className="text-xs text-slate-500">
                {user.first_name} {user.last_name}
              </p>
            )}
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <SidebarContent onNavigate={() => setDrawerOpen(false)} />
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top header */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200 flex-shrink-0">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            <Menu className="w-6 h-6" />
          </button>
          <span className="font-semibold text-slate-800 truncate">{garderieName}</span>
        </header>

        <AnnouncementBanner />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
