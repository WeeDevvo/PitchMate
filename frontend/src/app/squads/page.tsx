"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { usersApi, squadsApi } from "@/lib/api-client";
import type { UserSquad } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Users, ChevronRight, Shield } from "lucide-react";

export default function SquadsPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [squads, setSquads] = useState<UserSquad[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [newSquadName, setNewSquadName] = useState("");
  const [squadIdToJoin, setSquadIdToJoin] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  const getRatingColor = (rating: number) => {
    if (rating >= 1300) return "text-yellow-400"
    if (rating >= 1200) return "text-primary"
    if (rating >= 1100) return "text-blue-400"
    return "text-muted-foreground"
  }

  const getRatingTier = (rating: number) => {
    if (rating >= 1300) return "Elite"
    if (rating >= 1200) return "Pro"
    if (rating >= 1100) return "Rising"
    return "Starter"
  }

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated) {
      loadSquads();
    }
  }, [isAuthenticated]);

  const loadSquads = async () => {
    setIsLoading(true);
    setError(null);
    const response = await usersApi.getUserSquads();
    if (response.data) {
      setSquads(response.data);
    } else {
      setError(response.error?.message || "Failed to load squads");
    }
    setIsLoading(false);
  };

  const handleCreateSquad = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSquadName.trim()) return;

    setIsCreating(true);
    setError(null);
    const response = await squadsApi.createSquad(newSquadName.trim());
    if (response.data) {
      // Reload squads to get the new one with proper structure
      await loadSquads();
      setNewSquadName("");
      setShowCreateForm(false);
    } else {
      setError(response.error?.message || "Failed to create squad");
    }
    setIsCreating(false);
  };

  const handleJoinSquad = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!squadIdToJoin.trim()) return;

    setIsJoining(true);
    setError(null);
    const response = await squadsApi.joinSquad(squadIdToJoin.trim());
    if (response.data !== undefined) {
      // Reload squads to show the newly joined squad
      await loadSquads();
      setSquadIdToJoin("");
      setShowJoinForm(false);
    } else {
      setError(response.error?.message || "Failed to join squad");
    }
    setIsJoining(false);
  };

  if (authLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">My Squads</h1>
        <p className="mt-2 text-muted-foreground">Manage your squads and track your progress</p>
      </div>

      {/* Actions */}
      <div className="mb-8 flex flex-wrap gap-3">
        <Button
          onClick={() => {
            setShowJoinForm(!showJoinForm);
            setShowCreateForm(false);
          }}
        >
          <Users className="mr-2 h-4 w-4" />
          Join Squad
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setShowCreateForm(!showCreateForm);
            setShowJoinForm(false);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Create New Squad
        </Button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-destructive bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <div className="mb-8 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">Create New Squad</h2>
          <form onSubmit={handleCreateSquad} className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="squadName" className="sr-only">
                Squad Name
              </Label>
              <Input
                id="squadName"
                placeholder="Enter squad name..."
                value={newSquadName}
                onChange={(e) => setNewSquadName(e.target.value)}
                disabled={isCreating}
                className="h-11 bg-secondary/50"
                required
              />
            </div>
            <Button type="submit" className="h-11" disabled={isCreating || !newSquadName.trim()}>
              {isCreating ? "Creating..." : "Create Squad"}
            </Button>
          </form>
        </div>
      )}

      {/* Join Form */}
      {showJoinForm && (
        <div className="mb-8 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">Join a Squad</h2>
          <form onSubmit={handleJoinSquad} className="space-y-3">
            <div className="flex gap-3">
              <div className="flex-1">
                <Label htmlFor="squadId" className="sr-only">
                  Squad ID
                </Label>
                <Input
                  id="squadId"
                  placeholder="Enter squad ID..."
                  value={squadIdToJoin}
                  onChange={(e) => setSquadIdToJoin(e.target.value)}
                  disabled={isJoining}
                  className="h-11 bg-secondary/50"
                  required
                />
              </div>
              <Button type="submit" className="h-11" disabled={isJoining || !squadIdToJoin.trim()}>
                {isJoining ? "Joining..." : "Join Squad"}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">Ask your squad admin for the unique squad ID</p>
          </form>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading squads...</p>
        </div>
      ) : squads.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <p className="mb-4 text-muted-foreground">
              You haven&apos;t joined any squads yet.
            </p>
            <Button onClick={() => setShowCreateForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Squad
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {squads.map((squad) => (
            <Link
              key={squad.squadId}
              href={`/squads/${squad.squadId}`}
              className="group relative overflow-hidden rounded-xl border border-border bg-card p-6 transition-all hover:border-primary/50 hover:bg-card/80"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-lg">{squad.name}</h3>
                    {squad.isAdmin && (
                      <Badge variant="secondary" className="bg-primary/10 text-primary border-0">
                        <Shield className="mr-1 h-3 w-3" />
                        Admin
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">Squad member</p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
              </div>

              <div className="mt-6 flex items-end justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Your Rating</p>
                  <p className={`text-3xl font-bold ${getRatingColor(squad.currentRating)}`}>{squad.currentRating}</p>
                  <p className={`text-xs ${getRatingColor(squad.currentRating)}`}>{getRatingTier(squad.currentRating)}</p>
                </div>
                <div className="text-right text-sm text-muted-foreground">
                  <p>Joined</p>
                  <p>{new Date(squad.joinedAt).toLocaleDateString()}</p>
                </div>
              </div>

              {/* Rating indicator bar */}
              <div className="mt-4 h-1 w-full rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${Math.min((squad.currentRating / 1500) * 100, 100)}%` }}
                />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
