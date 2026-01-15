"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { matchesApi, squadsApi } from "@/lib/api-client";
import type { Match, Squad, TeamDesignation } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function MatchDetailPage() {
  const router = useRouter();
  const params = useParams();
  const squadId = params.id as string;
  const matchId = params.matchId as string;
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [squad, setSquad] = useState<Squad | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Result submission state
  const [showResultDialog, setShowResultDialog] = useState(false);
  const [selectedWinner, setSelectedWinner] = useState<TeamDesignation | "">("");
  const [balanceFeedback, setBalanceFeedback] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated && squadId && matchId) {
      loadData();
    }
  }, [isAuthenticated, squadId, matchId]);

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

    // Load match details
    const matchResponse = await matchesApi.getMatch(matchId);
    if (matchResponse.data) {
      setMatch(matchResponse.data);
    } else {
      setError(matchResponse.error?.message || "Failed to load match");
    }

    setIsLoading(false);
  };

  const handleSubmitResult = async () => {
    if (!selectedWinner) {
      setError("Please select a winner");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const response = await matchesApi.recordResult(
      matchId,
      selectedWinner as TeamDesignation,
      balanceFeedback || undefined
    );

    if (response.data !== undefined) {
      // Reload match to show updated result
      await loadData();
      setShowResultDialog(false);
      setSelectedWinner("");
      setBalanceFeedback("");
    } else {
      setError(response.error?.message || "Failed to record result");
    }

    setIsSubmitting(false);
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
        <p className="text-muted-foreground">Loading match...</p>
      </div>
    );
  }

  if (!squad || !match) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="mb-4 text-center text-muted-foreground">
              {error || "Match not found"}
            </p>
            <Button asChild>
              <Link href={`/squads/${squadId}/matches`}>Back to Matches</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isAdmin = user && squad.adminIds.includes(user.id);
  const canRecordResult = isAdmin && match.status === "Pending";

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="mb-4">
          <Link
            href={`/squads/${squadId}/matches`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to Matches
          </Link>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">Match Details</h1>
              <Badge variant={match.status === "Completed" ? "default" : "secondary"}>
                {match.status}
              </Badge>
            </div>
            <p className="mt-2 text-muted-foreground">
              {new Date(match.scheduledAt).toLocaleDateString()} at{" "}
              {new Date(match.scheduledAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          {canRecordResult && (
            <Dialog open={showResultDialog} onOpenChange={setShowResultDialog}>
              <DialogTrigger asChild>
                <Button size="lg">Record Result</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Record Match Result</DialogTitle>
                  <DialogDescription>
                    Select the winning team or mark as a draw
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="winner">Winner</Label>
                    <select
                      id="winner"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={selectedWinner}
                      onChange={(e) => setSelectedWinner(e.target.value as TeamDesignation | "")}
                      disabled={isSubmitting}
                    >
                      <option value="">Select winner...</option>
                      <option value="TeamA">Team A</option>
                      <option value="TeamB">Team B</option>
                      <option value="Draw">Draw</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="feedback">Balance Feedback (Optional)</Label>
                    <Input
                      id="feedback"
                      placeholder="How balanced was the match?"
                      value={balanceFeedback}
                      onChange={(e) => setBalanceFeedback(e.target.value)}
                      disabled={isSubmitting}
                    />
                    <p className="text-xs text-muted-foreground">
                      Share your thoughts on team balance for future improvements
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowResultDialog(false);
                      setSelectedWinner("");
                      setBalanceFeedback("");
                    }}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSubmitResult}
                    disabled={!selectedWinner || isSubmitting}
                  >
                    {isSubmitting ? "Submitting..." : "Submit Result"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-destructive bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Match Result (if completed) */}
      {match.result && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Match Result</CardTitle>
            <CardDescription>
              Recorded on {new Date(match.result.recordedAt).toLocaleDateString()} at{" "}
              {new Date(match.result.recordedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-center py-4">
                <Badge variant="default" className="text-lg px-6 py-2">
                  {match.result.winner === "Draw"
                    ? "Match Ended in a Draw"
                    : `${match.result.winner} Won`}
                </Badge>
              </div>
              {match.result.balanceFeedback && (
                <div className="rounded-lg border p-4 bg-muted/50">
                  <p className="text-sm font-medium mb-2">Balance Feedback:</p>
                  <p className="text-sm text-muted-foreground">
                    {match.result.balanceFeedback}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Teams */}
      {match.teamA && match.teamB ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Team A */}
          <Card className={match.result?.winner === "TeamA" ? "border-primary" : ""}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Team A</CardTitle>
                {match.result?.winner === "TeamA" && (
                  <Badge variant="default">Winner</Badge>
                )}
              </div>
              <CardDescription>
                Total Rating: {match.teamA.totalRating}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {match.teamA.players.map((player, index) => (
                  <div
                    key={player.userId}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium text-sm">
                        Player {index + 1}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        User {player.userId.substring(0, 8)}...
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">{player.ratingAtMatchTime}</p>
                      <p className="text-xs text-muted-foreground">Rating</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Team B */}
          <Card className={match.result?.winner === "TeamB" ? "border-primary" : ""}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Team B</CardTitle>
                {match.result?.winner === "TeamB" && (
                  <Badge variant="default">Winner</Badge>
                )}
              </div>
              <CardDescription>
                Total Rating: {match.teamB.totalRating}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {match.teamB.players.map((player, index) => (
                  <div
                    key={player.userId}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium text-sm">
                        Player {index + 1}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        User {player.userId.substring(0, 8)}...
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">{player.ratingAtMatchTime}</p>
                      <p className="text-xs text-muted-foreground">Rating</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Teams have not been generated yet
            </p>
          </CardContent>
        </Card>
      )}

      {/* Match Info */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Match Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">Total Players</p>
              <p className="text-lg font-semibold">{match.players.length}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Team Size</p>
              <p className="text-lg font-semibold">{match.teamSize} per team</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Squad</p>
              <p className="text-lg font-semibold">{squad.name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <p className="text-lg font-semibold">{match.status}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
