"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenText,
  CalendarClock,
  Gauge,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Menu,
  PiggyBank,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Um só mapa do app: finanças pessoais e trading são seções do mesmo livro. */
export const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Finanças",
    items: [
      { href: "/", label: "Visão geral", icon: LayoutDashboard },
      { href: "/transactions", label: "Extrato", icon: Receipt },
      { href: "/review", label: "Revisar", icon: ListChecks },
      { href: "/recurring", label: "Recorrentes", icon: CalendarClock },
      { href: "/accounts", label: "Contas", icon: Landmark },
      { href: "/budgets", label: "Orçamentos", icon: PiggyBank },
    ],
  },
  {
    label: "Trading",
    items: [
      { href: "/trading", label: "Diário", icon: BookOpenText },
      { href: "/trading/risco", label: "Risco", icon: Gauge },
    ],
  },
];

/** Atalhos da barra inferior no celular; o resto fica no menu. */
const MOBILE_PRIMARY = ["/", "/transactions", "/trading"];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

/** O item ativo é o de prefixo mais longo (para /trading/risco não acender /trading). */
function activeHref(pathname: string): string | undefined {
  return ALL_ITEMS.map((i) => i.href)
    .filter((href) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0];
}

export function AppNav() {
  const pathname = usePathname();
  const current = activeHref(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const primary = ALL_ITEMS.filter((i) => MOBILE_PRIMARY.includes(i.href));
  const menuHasCurrent = current !== undefined && !MOBILE_PRIMARY.includes(current);

  return (
    <>
      <nav
        aria-label="Principal"
        className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-6 overflow-y-auto border-r border-outline-variant bg-surface-container-low px-3 py-5 md:flex"
      >
        <Link href="/" className="rounded-md px-3 text-base font-semibold tracking-tight text-on-surface">
          My-Fin
        </Link>
        <NavGroups current={current} />
      </nav>

      <nav
        aria-label="Atalhos"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-outline-variant bg-surface-container-low pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {primary.map((item) => (
          <TabLink key={item.href} item={item} active={current === item.href} />
        ))}
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-haspopup="dialog"
          className={tabClass(menuHasCurrent)}
        >
          <TabIcon icon={Menu} active={menuHasCurrent} />
          Menu
        </button>
      </nav>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 bg-surface-container-low">
          <SheetHeader>
            <SheetTitle>My-Fin</SheetTitle>
          </SheetHeader>
          <div className="px-3">
            <NavGroups current={current} onNavigate={() => setMenuOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function NavGroups({ current, onNavigate }: { current?: string; onNavigate?: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <p className="px-3 pb-1 text-xs font-medium text-on-surface-variant">{group.label}</p>
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = current === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors duration-150",
                  active
                    ? "bg-secondary text-secondary-foreground"
                    : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
                )}
              >
                <Icon className="size-4.5 shrink-0" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function tabClass(active: boolean) {
  return cn(
    "flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150",
    active ? "text-on-surface" : "text-on-surface-variant",
  );
}

function TabIcon({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  return (
    <span
      className={cn(
        "flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-150",
        active && "bg-secondary text-secondary-foreground",
      )}
    >
      <Icon className="size-5" aria-hidden />
    </span>
  );
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
      <TabIcon icon={item.icon} active={active} />
      {item.label}
    </Link>
  );
}
