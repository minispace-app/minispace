"use client";

import { useRouter, useParams } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import { useEffect } from "react";
import Link from "next/link";

export default function RootPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const locale = params.locale as string;

  useEffect(() => {
    if (loading) return;

    // Check if this is a tenant subdomain (not www.minispace.app or minispace.app)
    const hostname = typeof window !== "undefined" ? window.location.hostname : "";
    const isMainDomain = hostname === "www.minispace.app" || hostname === "minispace.app" || hostname.includes("localhost") || hostname.includes("127.0.0.1");

    if (!isMainDomain) {
      // Tenant subdomain: redirect to login
      router.push(`/${locale}/login`);
      return;
    }

    // If authenticated, redirect to dashboard
    if (user) {
      const redirectPath = user.role === "parent" ? "/parent/messages" : "/dashboard";
      router.push(`/${locale}${redirectPath}`);
    }
  }, [user, loading, router, locale]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-500">Loading...</p>
      </div>
    );
  }

  // Translations
  const t = {
    fr: {
      title: "Connectez garderies et familles en temps réel",
      subtitle: "Une plateforme collaborative tout-en-un pour une meilleure communication et une gestion simplifiée",
      cta_primary: "Accès démo",
      cta_secondary: "En savoir plus",
      badge: "✓ Gratuit • Sans installation • Accès immédiat",
      features_title: "Fonctionnalités principales",
      messaging_title: "Messages en temps réel",
      messaging_desc: "Communiquez instantanément avec les parents. Messages individuels, en groupe ou diffusion générale.",
      photos_title: "Partage de photos et vidéos",
      photos_desc: "Capturez les moments précieux de la journée et partagez-les en toute sécurité avec les familles.",
      journal_title: "Journal de bord quotidien",
      journal_desc: "Documentez santé, nutrition, sommeil et observations pour chaque enfant.",
      management_title: "Gestion d'équipe",
      management_desc: "Organisez vos éducateurs, gérez les accès et les rôles facilement.",
      security_title: "Sécurité et confidentialité",
      security_desc: "Données chiffrées, contrôle d'accès granulaire et conformité RGPD.",
      documents_title: "Documents et formulaires",
      documents_desc: "Centralisez menus, politiques, bulletins et documents importants.",
      cta_heading: "Prêt à simplifier votre gestion de garderie ?",
      cta_subheading: "Rejoignez les garderies qui font confiance à minispace.app",
      login: "Se connecter",
      register: "Créer un compte",
    },
    en: {
      title: "Connect daycares and families in real-time",
      subtitle: "An all-in-one collaborative platform for better communication and simplified management",
      cta_primary: "Demo access",
      cta_secondary: "Learn more",
      badge: "✓ Free • No installation • Instant access",
      features_title: "Key Features",
      messaging_title: "Real-time messaging",
      messaging_desc: "Communicate instantly with parents. Individual, group, or broadcast messages.",
      photos_title: "Photo and video sharing",
      photos_desc: "Capture precious moments and securely share them with families.",
      journal_title: "Daily journal",
      journal_desc: "Document health, nutrition, sleep, and observations for each child.",
      management_title: "Team management",
      management_desc: "Organize your educators, manage access and roles easily.",
      security_title: "Security and privacy",
      security_desc: "Encrypted data, granular access control, and GDPR compliance.",
      documents_title: "Documents and forms",
      documents_desc: "Centralize menus, policies, newsletters, and important documents.",
      cta_heading: "Ready to simplify your daycare management?",
      cta_subheading: "Join daycares that trust minispace.app",
      login: "Sign in",
      register: "Create account",
    }
  };

  const lang = locale === "en" ? "en" : "fr";
  const text = t[lang as keyof typeof t];

  // Check if this is a tenant subdomain
  const hostname = typeof window !== "undefined" ? window.location.hostname : "";
  const isMainDomain = hostname === "www.minispace.app" || hostname === "minispace.app" || hostname.includes("localhost") || hostname.includes("127.0.0.1");

  // Tenant subdomain: show loading while redirecting to login
  if (!isMainDomain) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-500">Redirecting...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header / Navigation */}
      <header className="border-b border-slate-200 sticky top-0 bg-white z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
                <span className="text-white font-bold text-lg">mS</span>
              </div>
              <span className="font-bold text-lg bg-gradient-to-r from-blue-500 to-blue-700 bg-clip-text text-transparent">
                minispace.app
              </span>
            </div>
            <div className="flex items-center gap-4">
              <Link href={`/${locale === "en" ? "fr" : "en"}`} className="text-sm font-medium text-slate-600 hover:text-blue-600">
                {locale === "en" ? "FR" : "EN"}
              </Link>
              <Link href={`/${locale}/login`} className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
                {text.login}
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20 bg-gradient-to-br from-blue-50 to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div>
              <h1 className="text-4xl md:text-5xl font-bold text-slate-900 mb-6 leading-tight">
                {text.title}
              </h1>
              <p className="text-xl text-slate-600 mb-8 leading-relaxed">
                {text.subtitle}
              </p>
              <div className="flex gap-4 mb-8 flex-wrap">
                <Link href={`/${locale}/login`} className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition transform hover:-translate-y-0.5 hover:shadow-lg">
                  {text.cta_primary}
                </Link>
                <a href="#features" className="px-6 py-3 border-2 border-blue-600 text-blue-600 rounded-lg font-medium hover:bg-blue-50 transition">
                  {text.cta_secondary}
                </a>
              </div>
              <p className="text-sm text-slate-500">{text.badge}</p>
            </div>
            <div className="flex items-center justify-center">
              <div className="w-full aspect-square bg-gradient-to-br from-blue-100 to-blue-50 rounded-2xl flex items-center justify-center shadow-xl">
                <svg viewBox="0 0 400 300" className="w-full h-auto max-w-sm" xmlns="http://www.w3.org/2000/svg">
                  <rect width="400" height="300" fill="#dbeafe"/>
                  <circle cx="200" cy="150" r="80" fill="#3b82f6"/>
                  <text x="200" y="160" textAnchor="middle" fill="#fff" fontSize="32" fontWeight="bold">
                    minispace
                  </text>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-slate-900 mb-16">
            {text.features_title}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: "📱", title: text.messaging_title, desc: text.messaging_desc },
              { icon: "📸", title: text.photos_title, desc: text.photos_desc },
              { icon: "📔", title: text.journal_title, desc: text.journal_desc },
              { icon: "👥", title: text.management_title, desc: text.management_desc },
              { icon: "🔒", title: text.security_title, desc: text.security_desc },
              { icon: "📊", title: text.documents_title, desc: text.documents_desc },
            ].map((feature, idx) => (
              <div key={idx} className="p-6 border border-slate-200 rounded-xl hover:border-blue-300 hover:shadow-lg transition">
                <div className="text-4xl mb-4">{feature.icon}</div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">{feature.title}</h3>
                <p className="text-slate-600">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-gradient-to-r from-blue-600 to-blue-800 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">{text.cta_heading}</h2>
          <p className="text-xl mb-8 opacity-95">{text.cta_subheading}</p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link href={`/${locale}/login`} className="px-8 py-3 bg-white text-blue-600 rounded-lg font-bold hover:bg-slate-100 transition transform hover:-translate-y-0.5 hover:shadow-lg">
              {text.login}
            </Link>
            <Link href={`/${locale}/register`} className="px-8 py-3 border-2 border-white text-white rounded-lg font-bold hover:bg-white hover:text-blue-600 transition transform hover:-translate-y-0.5">
              {text.register}
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-300 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center">&copy; 2026 minispace.app • All rights reserved</p>
        </div>
      </footer>
    </div>
  );
}
