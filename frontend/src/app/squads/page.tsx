"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { usersApi, squadsApi } from "@/lib/api-client";
import type { UserSquad } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SquadsPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [squads, setSquads] = useState<UserSquad[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSquadName, setNewSquadName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

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

  if (authLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">My Squads</h1>
          <p className="mt-2 text-muted-foreground">
            Manage your squads and organize matches
          </p>
        </div>
        <Button
          onClick={() => setShowCreateForm(!showCreateForm)}
          size="lg"
          className="w-full sm:w-auto"
        >
          {showCreateForm ? "Cancel" : "Create New Squad"}
        </Button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-destructive bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {showCreateForm && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Create New Squad</CardTitle>
            <CardDescription>
              Give your squad a name to get started
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateSquad} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="squadName">Squad Name</Label>
                <Input
                  id="squadName"
                  type="text"
                  placeholder="e.g., Sunday League Warriors"
                  value={newSquadName}
                  onChange={(e) => setNewSquadName(e.target.value)}
                  disabled={isCreating}
                  required
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={isCreating || !newSquadName.trim()}>
                  {isCreating ? "Creating..." : "Create Squad"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewSquadName("");
                    setError(null);
                  }}
                  disabled={isCreating}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading squads...</p>
        </div>
      ) : squads.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="mb-4 text-center text-muted-foreground">
              You haven&apos;t joined any squads yet.
            </p>
            <Button onClick={() => setShowCreateForm(true)}>
              Create Your First Squad
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {squads.map((squad) => {
            return (
              <Link key={squad.squadId} href={`/squads/${squad.squadId}`}>
                <Card className="h-full transition-shadow hover:shadow-lg">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <CardTitle className="line-clamp-2">{squad.name}</CardTitle>
                      {squad.isAdmin && (
                        <span className="rounded-full bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">
                          Admin
                        </span>
                      )}
                    </div>
                    <CardDescription>
                      Squad member
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">Your Rating</p>
                      <p className="text-2xl font-bold">{squad.currentRating}</p>
                    </div>
                    <p className="mt-4 text-xs text-muted-foreground">
                      Joined {new Date(squad.joinedAt).toLocaleDateString()}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
