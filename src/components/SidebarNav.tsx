"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, FolderOpen, KeyRound, LayoutDashboard, Network } from "lucide-react";

const ICONS = { dashboard: LayoutDashboard, cases: FolderOpen, links: Network, reports: FileText, key: KeyRound };

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  count?: number;
  /** Solo coincide con la ruta exacta (para las páginas raíz). */
  exact?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-5 lg:overflow-visible" aria-label="Principal">
      {groups.map((g) => (
        <div key={g.title} className="flex gap-1 lg:flex-col lg:gap-0.5">
          <div className="hidden px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-white/45 lg:block">
            {g.title}
          </div>
          {g.items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-white font-semibold text-accent-ink shadow-glow"
                    : "text-white/75 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon size={17} strokeWidth={2} className={active ? "text-accent" : "text-white/70"} aria-hidden />
                <span className="whitespace-nowrap">{item.label}</span>
                {item.count ? (
                  <span
                    className={`tabular ml-auto rounded-full px-2 text-[11px] font-bold ${
                      active ? "bg-accent text-white" : "bg-white/15 text-white"
                    }`}
                  >
                    {item.count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
