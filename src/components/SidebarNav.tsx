"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, FolderOpen, House, LayoutDashboard, Network } from "lucide-react";

const ICONS = { house: House, report: FileText, dashboard: LayoutDashboard, cases: FolderOpen, links: Network };

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
          <div className="hidden px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted lg:block">
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
                className={`flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                  active ? "bg-surface font-medium text-fg shadow-sm ring-1 ring-line" : "text-fg-2 hover:bg-surface/70 hover:text-fg"
                }`}
              >
                <Icon size={16} strokeWidth={1.75} className={active ? "text-accent" : "text-muted"} aria-hidden />
                <span className="whitespace-nowrap">{item.label}</span>
                {item.count ? (
                  <span className="tabular ml-auto rounded-full bg-accent-wash px-1.5 text-[11px] font-medium text-accent-ink">
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
