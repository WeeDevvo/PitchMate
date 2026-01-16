"use client";

import { Inter, Geist_Mono } from "next/font/google";
import { usePathname } from "next/navigation";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { Header } from "@/components/navigation";
import { Toaster } from "@/components/ui/toaster";
import { GoogleOAuthProvider } from "@react-oauth/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
  const pathname = usePathname();
  
  // Hide header on auth pages
  const isAuthPage = pathname === "/login" || pathname === "/register";

  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <GoogleOAuthProvider clientId={googleClientId}>
          <AuthProvider>
            <div className="relative flex min-h-screen flex-col">
              {!isAuthPage && <Header />}
              <main className="flex-1">{children}</main>
              {!isAuthPage && (
                <footer className="border-t py-6">
                  <div className="container flex flex-col items-center justify-between gap-4 md:flex-row">
                    <p className="text-center text-sm text-muted-foreground">
                      © {new Date().getFullYear()} PitchMate. All rights reserved.
                    </p>
                  </div>
                </footer>
              )}
            </div>
            <Toaster />
          </AuthProvider>
        </GoogleOAuthProvider>
      </body>
    </html>
  );
}
