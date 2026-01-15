import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Hero Section */}
      <section className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
          Welcome to <span className="text-primary">PitchMate</span>
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground sm:text-xl">
          Create fair and balanced five-a-side football matches with our ELO-based team generation system.
        </p>
        <div className="mt-8 flex flex-col gap-4 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/login">Get Started</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/register">Create Account</Link>
          </Button>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-muted/50 px-4 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-8 text-center text-3xl font-bold">Features</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Squad Management</CardTitle>
                <CardDescription>
                  Create and manage multiple squads with your friends
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Join different squads for different groups of players. Each squad maintains its own rankings and match history.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Balanced Teams</CardTitle>
                <CardDescription>
                  Automatic team generation based on skill ratings
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Our algorithm creates the most balanced teams possible using each player&apos;s ELO rating.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>ELO Rating System</CardTitle>
                <CardDescription>
                  Track your progress with a proven rating system
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Your skill rating updates after each match, reflecting your true performance level over time.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
}
