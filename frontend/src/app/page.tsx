import type React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Users, Scale, TrendingUp, ChevronRight, Zap } from "lucide-react"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <Zap className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold tracking-tight">PitchMate</span>
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="ghost" asChild>
              <Link href="/login">Sign In</Link>
            </Button>
            <Button asChild>
              <Link href="/register">Get Started</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-32 pb-20">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-1/4 left-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
        </div>

        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-4 py-1.5 text-sm text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              ELO-Powered Team Balancing
            </div>

            <h1 className="mb-6 text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl text-balance">
              FAIR TEAMS. <span className="text-primary">BETTER GAMES.</span>
            </h1>

            <p className="mx-auto mb-10 max-w-2xl text-lg text-muted-foreground leading-relaxed text-pretty">
              The ultimate five-a-side football organizer. Create squads, track player ratings, and let our ELO system
              automatically balance teams for competitive matches every time.
            </p>

            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button size="lg" className="h-12 px-8 text-base" asChild>
                <Link href="/register">
                  Create Account
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="h-12 px-8 text-base bg-transparent" asChild>
                <Link href="/login">Sign In</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 border-t border-border/50">
        <div className="container mx-auto px-4">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">EVERYTHING YOU NEED</h2>
            <p className="text-muted-foreground text-lg">Powerful features to organize the perfect match</p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <FeatureCard
              icon={Users}
              title="Squad Management"
              description="Create and manage multiple squads. Invite players with a unique code and track everyone's progress."
            />
            <FeatureCard
              icon={Scale}
              title="Balanced Teams"
              description="Our algorithm automatically generates fair teams based on player skill ratings for competitive matches."
            />
            <FeatureCard
              icon={TrendingUp}
              title="ELO Rating System"
              description="Track your progress with a proven rating system. Win to climb, improve to compete at higher levels."
            />
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-24 border-t border-border/50">
        <div className="container mx-auto px-4">
          <div className="grid gap-8 sm:grid-cols-3">
            <StatCard value="1000" label="Starting ELO" />
            <StatCard value="5v5" label="Team Format" />
            <StatCard value="∞" label="Squads & Matches" />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} PitchMate. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: { icon: React.ElementType; title: string; description: string }) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/50 hover:bg-card/80">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mb-2 text-xl font-semibold">{title}</h3>
      <p className="text-muted-foreground leading-relaxed">{description}</p>
    </div>
  )
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-5xl font-bold text-primary">{value}</div>
      <div className="mt-2 text-muted-foreground">{label}</div>
    </div>
  )
}
