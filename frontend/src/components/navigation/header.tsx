"use client";

import Link from "next/link";
import { Zap } from "lucide-react";
import { MobileNav } from "./mobile-nav";
import { UserMenu } from "./user-menu";
import { useAuth } from "@/lib/auth-context";

export function Header() {
  const { isAuthenticated } = useAuth();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center">
          <MobileNav />
          
          <Link href={isAuthenticated ? "/squads" : "/"} className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <Zap className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold tracking-tight">PitchMate</span>
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
