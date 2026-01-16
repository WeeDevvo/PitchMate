"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { matchesApi, squadsApi } from "@/lib/api-client";
import type { Match, Squad } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SquadMatchesPage() {
  const router = useRouter();
  const params = useParams();
  const squadId = params.id as string;
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [squad, setSquad] = useState<Squad | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated && squadId) {
      loadData();
    }
  }, [isAuthenticated, squadId]);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    
    // Load squad details
    const squadResponse = await squadsApi.getSquad(squadId);
    if (squadResponse.data) {
      setSquad(squadResponse.data);
    } else {
      setError(squadResponse.error?.message || "Failed to load squad");
      setIsLoading(false);
      return;
    }

    // Load matches
    const matchesResponse = await matchesApi.getSquadMatches(squadId);
    console.log("Matches API Response:", matchesResponse);
    
    if (matchesResponse.data) {
      // Ensure matches is always an array
      const matchesData = Array.isArray(matchesResponse.data) 
        ? matchesResponse.data 
        : [];
      console.log("Matches Data (array):", matchesData);
      setMatches(matchesData);
    } else {
      console.error("Matches API Error:", matchesResponse.error);
      setError(matchesResponse.error?.message || "Failed to load matches");
      setMatches([]); // Set empty array on error
    }
    
    setIsLoading(false);
  };

  if (authLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading matches...</p>
      </div>
    );
  }

  if (!squad) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="mb-4 text-center text-muted-foreground">
              {error || "Squad not found"}
            </p>
            <Button asChild>
              <Link href="/squads">Back to Squads</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isAdmin = user && squad.adminIds.includes(user.userId);
  const upcomingMatches = (matches || []).filter((m) => m.status === "Pending");
  const completedMatches = (matches || []).filter((m) => m.status === "Completed");

  // Debug logging
  console.log("Matches Page Debug:", {
    userId: user?.userId,
    squadAdminIds: squad.adminIds,
    isAdmin,
    userObject: user,
    matchesArray: matches,
    matchesLength: matches?.length,
  });

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="mb-4">
          <Link
            href={`/squads/${squadId}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to {squad.name}
          </Link>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Matches</h1>
            <p className="mt-2 text-muted-foreground">
              {(matches || []).length} {(matches || []).length === 1 ? "match" : "matches"} total
            </p>
          </div>
          {isAdmin && (
            <Button asChild size="lg">
              <Link href={`/squads/${squadId}/matches/create`}>Create Match</Link>
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-destructive bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Upcoming Matches */}
      <div className="mb-8">
        <h2 className="mb-4 text-2xl font-semibold">Upcoming Matches</h2>
        {upcomingMatches.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No upcoming matches</p>
              {isAdmin && (
                <Button asChild className="mt-4" variant="outline">
                  <Link href={`/squads/${squadId}/matches/create`}>Create First Match</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcomingMatches.map((match) => (
              <Link key={match.matchId} href={`/squads/${squadId}/matches/${match.matchId}`}>
                <Card className="transition-colors hover:bg-accent">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-lg">
                        {new Date(match.scheduledAt).toLocaleDateString()}
                      </CardTitle>
                      <Badge variant="secondary">{match.status}</Badge>
                    </div>
                    <CardDescription>
                      {new Date(match.scheduledAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Players:</span>
                        <span className="font-medium">{match.playerCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Team Size:</span>
                        <span className="font-medium">{match.teamSize}</span>
                      </div>
                      {match.teamA && match.teamB && (
                        <div className="mt-4 pt-4 border-t">
                          <p className="text-xs text-muted-foreground mb-2">Teams Generated</p>
                          <div className="flex justify-between text-xs">
                            <span>Team A: {match.teamA.totalRating}</span>
                            <span>Team B: {match.teamB.totalRating}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Completed Matches */}
      <div>
        <h2 className="mb-4 text-2xl font-semibold">Completed Matches</h2>
        {completedMatches.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No completed matches yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {completedMatches.map((match) => (
              <Link key={match.matchId} href={`/squads/${squadId}/matches/${match.matchId}`}>
                <Card className="transition-colors hover:bg-accent">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-lg">
                        {new Date(match.scheduledAt).toLocaleDateString()}
                      </CardTitle>
                      <Badge variant="default">{match.status}</Badge>
                    </div>
                    <CardDescription>
                      {new Date(match.scheduledAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Players:</span>
                        <span className="font-medium">{match.playerCount}</span>
                      </div>
                      {match.winner && (
                        <div className="mt-4 pt-4 border-t">
                          <p className="text-xs text-muted-foreground mb-2">Result</p>
                          <div className="flex items-center justify-center">
                            <Badge variant="outline" className="text-sm">
                              {match.winner === "Draw"
                                ? "Draw"
                                : `${match.winner} Won`}
                            </Badge>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
