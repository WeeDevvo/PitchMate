"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/squads", label: "Squads" },
  { href: "/matches", label: "Matches" },
];

export function MainNav() {
  const pathname = usePathname();

  return (
    <nav className="hidden md:flex md:items-center md:gap-6">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "text-sm font-medium transition-colors hover:text-primary",
            pathname === item.href || pathname.startsWith(item.href + "/")
              ? "text-foreground"
              : "text-muted-foreground"
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
