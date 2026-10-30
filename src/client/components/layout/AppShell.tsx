// Signed-in application frame: sidebar navigation + content area
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigation } from "react-router-dom";
import { Ban, FileText, LayoutDashboard, ListChecks, LogOut, Menu, Send, Settings, Users, X, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { useAuth } from "../../lib/auth";
import { initials } from "../../lib/format";
import { ROLE_LABELS } from "@shared/auth";
import { BrandLockup, BrandMark } from "./Brand";

import { useQueryClient } from "@tanstack/react-query";
import { keys } from "../../lib/queries";
import { api } from "../../lib/api";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Outreach",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
      { to: "/campaigns", label: "Campaigns", icon: Send },
      { to: "/templates", label: "Templates", icon: FileText },
    ],
  },
  {
    title: "Audience",
    items: [
      { to: "/contacts", label: "Contacts", icon: Users },
      { to: "/lists", label: "Lists", icon: ListChecks },
      { to: "/suppressions", label: "Suppressions", icon: Ban },
    ],
  },
];

function NavItemLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  const qc = useQueryClient();

  const handlePrefetch = () => {
    if (item.to === "/") {
      void qc.prefetchQuery({ queryKey: keys.overview, queryFn: () => api.get("/api/overview") });
    } else if (item.to === "/contacts") {
      void qc.prefetchQuery({
        queryKey: keys.contacts({ page: 1, search: "" }),
        queryFn: () => api.get("/api/contacts?page=1&pageSize=25"),
      });
    } else if (item.to === "/campaigns") {
      void qc.prefetchQuery({ queryKey: keys.campaigns({}), queryFn: () => api.get("/api/campaigns") });
    } else if (item.to === "/templates") {
      void qc.prefetchQuery({ queryKey: keys.templates(""), queryFn: () => api.get("/api/templates") });
    } else if (item.to === "/lists") {
      void qc.prefetchQuery({ queryKey: keys.lists, queryFn: () => api.get("/api/lists") });
    }
  };

  return (
    <NavLink
      to={item.to}
      end={item.end}
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      className={({ isActive }) =>
        cn(
          "relative flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors",
          isActive ? "bg-brand-soft text-brand-ink" : "text-ink-muted hover:bg-surface-muted hover:text-ink"
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-[#5B9BFF]" aria-hidden="true" />}
          <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-brand" : "text-ink-faint")} aria-hidden="true" />
          {item.label}
        </>
      )}
    </NavLink>
  );
}

function UserCard() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!user) return null;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-md p-2 text-left hover:bg-surface-muted"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white ring-2 ring-white/10">{initials(user.name)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{user.name}</span>
          <span className="block truncate text-xs text-ink-subtle">{ROLE_LABELS[user.role]}</span>
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-line bg-surface py-1 shadow-pop animate-pop-in">
          <p className="truncate px-3 py-2 text-xs text-ink-subtle">{user.email}</p>
          <NavLink role="menuitem" to="/settings/account" onClick={() => setOpen(false)} className="block px-3 py-2 text-[13px] text-ink hover:bg-surface-muted">
            Account & password
          </NavLink>
          <button
            role="menuitem"
            onClick={() => void logout()}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink hover:bg-surface-muted">
            <LogOut className="h-4 w-4 text-ink-subtle" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function SidebarContent() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center border-b border-line px-5">
        <BrandLockup />
      </div>
      <nav className="flex-1 space-y-7 overflow-y-auto px-3 py-5" aria-label="Main">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="mb-2 px-3 text-2xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{section.title}</p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavItemLink key={item.to} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-1 border-t border-line p-3">
        <NavItemLink item={{ to: "/settings", label: "Settings", icon: Settings }} />
        <UserCard />
      </div>
    </div>
  );
}

/** Thin bar under the top edge while the next page's code loads */
function NavigationProgress() {
  const navigation = useNavigation();
  if (navigation.state !== "loading") return null;
  return (
    <div className="fixed inset-x-0 top-0 z-toast h-0.5 overflow-hidden bg-brand-soft" role="progressbar" aria-label="Loading page">
      <div className="h-full w-1/3 bg-brand motion-safe:animate-nav-progress" />
    </div>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-toast focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>
      <NavigationProgress />

      {/* Desktop sidebar: full-height column, sticky contents */}
      <div className="hidden w-60 shrink-0 border-r border-line bg-surface lg:block">
        <aside className="sticky top-0 h-screen">
          <SidebarContent />
        </aside>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-drawer lg:hidden">
          <div className="absolute inset-0 bg-navy/40 animate-fade-in" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-surface shadow-pop animate-slide-in">
            <button onClick={() => setMobileOpen(false)} className="absolute right-2 top-4 z-10 rounded-md p-2 text-ink-muted hover:bg-surface-muted hover:text-ink" aria-label="Close navigation">
              <X className="h-4 w-4" />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-dropdown flex h-14 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
          <button onClick={() => setMobileOpen(true)} className="rounded-md p-2 text-ink-muted hover:bg-surface-sunken" aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </button>
          <BrandMark size={28} />
          <span className="text-sm font-semibold text-navy">FocusRealm Mail Merge</span>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
