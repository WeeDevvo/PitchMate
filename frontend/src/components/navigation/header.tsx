"use client";

import Link from "next/link";
import { MainNav } from "./main-nav";
import { MobileNav } from "./mobile-nav";
import { UserMenu } from "./user-menu";
import { useAuth } from "@/lib/auth-context";

export function Header() {
  const { isAuthenticated } = useAuth();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <MobileNav />
        
        <Link href="/" className="mr-6 flex items-center space-x-2">
          <span className="text-xl font-bold">PitchMate</span>
        </Link>

        {isAuthenticated && <MainNav />}

        <div className="flex flex-1 items-center justify-end space-x-4">
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
