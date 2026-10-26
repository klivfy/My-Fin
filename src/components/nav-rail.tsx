"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Receipt, Landmark, PiggyBank, BarChart3, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Extrato", icon: Receipt },
  { href: "/accounts", label: "Contas", icon: Landmark },
  { href: "/budgets", label: "Orçamentos", icon: PiggyBank },
  { href: "/reports", label: "Relatórios", icon: BarChart3 },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Navigation Rail (desktop) — vira barra inferior fixa em telas estreitas. */
export function NavRail() {
  const pathname = usePathname();

  return (
    <>
      <nav className="hidden w-20 shrink-0 flex-col items-center gap-2 border-r border-outline-variant bg-surface-container-low py-6 pl-safe md:flex">
        <div className="mb-4 flex size-10 items-center justify-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground">
          MF
        </div>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}
      </nav>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-outline-variant bg-surface-container-low py-2 pb-safe pl-safe pr-safe md:hidden">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} compact />
        ))}
      </nav>
    </>
  );
}

function NavLink({
  item,
  active,
  compact,
}: {
  item: { href: string; label: string; icon: LucideIcon };
  active: boolean;
  compact?: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex flex-col items-center gap-1 rounded-2xl px-3 py-2 text-[11px] font-medium transition-colors",
        compact ? "w-16" : "w-16",
        active
          ? "bg-secondary text-secondary-foreground"
          : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
      )}
    >
      <Icon className="size-5" />
      {item.label}
    </Link>
  );
}
