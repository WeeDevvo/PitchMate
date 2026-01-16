"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Zap, Mail, Lock, CheckCircle2, ArrowLeft } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const { register, isLoading: authLoading } = useAuth();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{
    email?: string;
    password?: string;
    confirmPassword?: string;
  }>({});

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePassword = (password: string): boolean => {
    return password.length >= 8;
  };

  const validateForm = (): boolean => {
    const errors: typeof validationErrors = {};
    let isValid = true;

    if (!email) {
      errors.email = "Email is required";
      isValid = false;
    } else if (!validateEmail(email)) {
      errors.email = "Please enter a valid email address";
      isValid = false;
    }

    if (!password) {
      errors.password = "Password is required";
      isValid = false;
    } else if (!validatePassword(password)) {
      errors.password = "Password must be at least 8 characters";
      isValid = false;
    }

    if (!confirmPassword) {
      errors.confirmPassword = "Please confirm your password";
      isValid = false;
    } else if (password !== confirmPassword) {
      errors.confirmPassword = "Passwords do not match";
      isValid = false;
    }

    setValidationErrors(errors);
    return isValid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setValidationErrors({});

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      const result = await register(email, password);
      if (result.success) {
        router.push("/squads");
      } else {
        setError(result.error || "Registration failed. Please try again.");
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/3 right-1/4 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="w-full max-w-md">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        <div className="rounded-2xl border border-border bg-card p-8">
            <div className="mb-8 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
                <Zap className="h-6 w-6 text-primary-foreground" />
              </div>
              <h1 className="text-2xl font-bold">Create an account</h1>
              <p className="mt-2 text-muted-foreground">Sign up to start organizing matches</p>
            </div>

            {error && (
              <div className="mb-4 rounded-lg border border-destructive bg-destructive/10 p-3">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (validationErrors.email) {
                        setValidationErrors({ ...validationErrors, email: undefined });
                      }
                    }}
                    className="pl-10 h-11 bg-secondary/50 border-border"
                    required
                    disabled={isLoading}
                    autoComplete="email"
                  />
                </div>
                {validationErrors.email && (
                  <p className="text-sm text-destructive">{validationErrors.email}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (validationErrors.password) {
                        setValidationErrors({ ...validationErrors, password: undefined });
                      }
                    }}
                    className="pl-10 h-11 bg-secondary/50 border-border"
                    required
                    disabled={isLoading}
                    autoComplete="new-password"
                  />
                </div>
                {validationErrors.password && (
                  <p className="text-sm text-destructive">{validationErrors.password}</p>
                )}
                <p className="text-xs text-muted-foreground">Must be at least 8 characters</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <div className="relative">
                  <CheckCircle2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (validationErrors.confirmPassword) {
                        setValidationErrors({ ...validationErrors, confirmPassword: undefined });
                      }
                    }}
                    className="pl-10 h-11 bg-secondary/50 border-border"
                    required
                    disabled={isLoading}
                    autoComplete="new-password"
                  />
                </div>
                {validationErrors.confirmPassword && (
                  <p className="text-sm text-destructive">{validationErrors.confirmPassword}</p>
                )}
              </div>

              <Button type="submit" className="w-full h-11" disabled={isLoading}>
                {isLoading ? "Creating account..." : "Create Account"}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary hover:underline font-medium">
                Sign in
              </Link>
            </p>
          </div>
      </div>
    </div>
  );
}
