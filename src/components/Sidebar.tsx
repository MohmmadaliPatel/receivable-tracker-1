'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileStack,
  LayoutDashboard,
  Library,
  LogOut,
  Mail,
  Server,
  SlidersHorizontal,
  Upload,
  Users,
} from 'lucide-react';

interface SidebarProps {
  user?: {
    username: string;
    name?: string;
    role?: string;
    accessTradePayable?: boolean;
    accessTradeReceivable?: boolean;
    accessConfirmMsme?: boolean;
  };
}

const COMMON_MASTER_PREFIXES = ['/masters/vendor', '/masters/supplier', '/masters/email-templates', '/masters/listing-uploads'];

const iconClass = 'w-[18px] h-[18px] shrink-0 stroke-[1.75]';

export default function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const canTp = !user || user.role === 'admin' || (user.accessTradePayable ?? true);
  const canTr = !user || user.role === 'admin' || (user.accessTradeReceivable ?? true);
  const canMsme = !user || user.role === 'admin' || (user.accessConfirmMsme ?? true);

  const [mastersOpen, setMastersOpen] = useState(false);

  useEffect(() => {
    if (COMMON_MASTER_PREFIXES.some((p) => pathname?.startsWith(p))) {
      setMastersOpen(true);
    }
  }, [pathname]);

  const topNav: { name: string; href: string; icon: LucideIcon }[] = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    ...(canTp ? [{ name: 'Trade Payables', href: '/trade-payables', icon: ArrowUpRight }] : []),
    ...(canTr ? [{ name: 'Trade Receivables', href: '/trade-receivables', icon: ArrowDownLeft }] : []),
    ...(canMsme ? [{ name: 'Confirm MSME', href: '/confirm-msme', icon: Mail }] : []),
  ];

  const bottomNav: { name: string; href: string; icon: LucideIcon }[] = [
    { name: 'Email Configuration', href: '/email-config', icon: Server },
    // { name: 'Documents', href: '/documents', icon: FolderOpen }, // temporarily hidden
    { name: 'Reports', href: '/reports', icon: BarChart3 },
    { name: 'Settings', href: '/settings', icon: SlidersHorizontal },
    ...(user?.role === 'admin' ? [{ name: 'User Management', href: '/users', icon: Users }] : []),
  ];

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    return pathname?.startsWith(href);
  };

  const masterChildren: { name: string; href: string; icon: LucideIcon }[] = [
    ...(canTp || canTr ? [{ name: 'Listing uploads', href: '/masters/listing-uploads', icon: Upload }] : []),
    ...(canTp ? [{ name: 'Vendor master', href: '/masters/vendor', icon: ClipboardList }] : []),
    ...(canTr ? [{ name: 'Supplier master', href: '/masters/supplier', icon: BookOpen }] : []),
    ...(user?.role === 'admin'
      ? [{ name: 'Email templates', href: '/masters/email-templates', icon: FileStack }]
      : []),
  ];

  const mastersSectionActive = masterChildren.some((c) => isActive(c.href));

  const linkBase =
    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors';
  const linkActive = 'bg-neutral-900 text-white font-medium';
  const linkInactive = 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900';

  return (
    <div className="w-[15.5rem] bg-white border-r border-neutral-200 min-h-screen flex flex-col">
      <div className="px-5 py-6 border-b border-neutral-100">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/logo.png" alt="Taxteck" width={130} height={34} className="opacity-90" />
        </Link>
        {user && (
          <div className="mt-4 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-neutral-200 flex items-center justify-center shrink-0">
              <span className="text-xs font-semibold text-neutral-900">
                {(user.name || user.username).charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-900 truncate">{user.name || user.username}</p>
              {user.role === 'admin' && (
                <span className="inline-block mt-0.5 text-[10px] border border-neutral-300 text-neutral-600 bg-neutral-50 px-1.5 py-0.5 rounded font-medium tracking-wide uppercase">
                  Admin
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 px-2 py-3 overflow-y-auto">
        <ul className="space-y-0.5">
          {topNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link href={item.href} className={`${linkBase} ${active ? linkActive : linkInactive}`}>
                  <Icon className={`${iconClass} ${active ? 'text-white' : 'text-neutral-500'}`} />
                  <span>{item.name}</span>
                </Link>
              </li>
            );
          })}

          {masterChildren.length > 0 && (
            <li className="pt-1">
              <button
                type="button"
                onClick={() => setMastersOpen((o) => !o)}
                className={`w-full ${linkBase} text-left ${
                  mastersSectionActive ? 'bg-neutral-100 text-neutral-900 font-medium' : linkInactive
                }`}
              >
                <Library className={`${iconClass} text-neutral-500`} />
                <span className="flex-1">Common masters</span>
                {mastersOpen ? (
                  <ChevronDown className="w-4 h-4 text-neutral-400 shrink-0" strokeWidth={1.75} />
                ) : (
                  <ChevronRight className="w-4 h-4 text-neutral-400 shrink-0" strokeWidth={1.75} />
                )}
              </button>
              {mastersOpen && (
                <ul className="mt-1 ml-3 pl-3 border-l border-neutral-200 space-y-0.5">
                  {masterChildren.map((c) => {
                    const Icon = c.icon;
                    const active = isActive(c.href);
                    return (
                      <li key={c.href}>
                        <Link
                          href={c.href}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                            active ? linkActive : linkInactive
                          }`}
                        >
                          <Icon className={`${iconClass} ${active ? 'text-white' : 'text-neutral-500'}`} />
                          <span>{c.name}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          )}

          {bottomNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link href={item.href} className={`${linkBase} ${active ? linkActive : linkInactive}`}>
                  <Icon className={`${iconClass} ${active ? 'text-white' : 'text-neutral-500'}`} />
                  <span>{item.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-2 pb-4 pt-3 border-t border-neutral-100">
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-neutral-500 hover:bg-red-50 hover:text-red-700 rounded-lg transition-colors font-medium"
          >
            <LogOut className="w-4 h-4 shrink-0 stroke-[1.75]" />
            Logout
          </button>
        </form>
        <p className="text-[11px] text-neutral-400 text-center mt-2 tracking-wide">Taxteck v1.0</p>
      </div>
    </div>
  );
}
