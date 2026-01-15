"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { matchesApi, squadsApi } from "@/lib/api-client";
import type { Squad } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export default function CreateMatchPage() {
  const router = useRouter();
  const params = useParams();
  const squadId = params.id as string;
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [squad, setSquad] = useState<Squad | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form state
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [teamSize, setTeamSize] = useState("5");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated && squadId) {
      loadSquad();
    }
  }, [isAuthenticated, squadId]);

  useEffect(() => {
    // Set default date to today
    const today = new Date();
    const dateStr = today.toISOString().split("T")[0];
    setScheduledDate(dateStr);
    
    // Set default time to 18:00
    setScheduledTime("18:00");
  }, []);

  const loadSquad = async () => {
    setIsLoading(true);
    setError(null);
    const response = await squadsApi.getSquad(squadId);
    if (response.data) {
      setSquad(response.data);
    } else {
      setError(response.error?.message || "Failed to load squad");
    }
    setIsLoading(false);
  };

  const handlePlayerToggle = (userId: string) => {
    setSelectedPlayerIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const handleSelectAll = () => {
    if (squad) {
      setSelectedPlayerIds(squad.members.map((m) => m.userId));
    }
  };

  const handleClearAll = () => {
    setSelectedPlayerIds([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!scheduledDate || !scheduledTime) {
      setError("Please select a date and time");
      return;
    }

    if (selectedPlayerIds.length < 2) {
      setError("Please select at least 2 players");
      return;
    }

    if (selectedPlayerIds.length % 2 !== 0) {
      setError("Please select an even number of players");
      return;
    }

    const teamSizeNum = parseInt(teamSize);
    if (isNaN(teamSizeNum) || teamSizeNum < 1) {
      setError("Please enter a valid team size");
      return;
    }

    // Combine date and time into ISO string
    const scheduledAt = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();

    setIsCreating(true);
    const response = await matchesApi.createMatch(
      squadId,
      scheduledAt,
      selectedPlayerIds,
      teamSizeNum
    );

    if (response.data) {
      // Navigate to the matches list
      router.push(`/squads/${squadId}/matches`);
    } else {
      setError(response.error?.message || "Failed to create match");
      setIsCreating(false);
    }
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
        <p className="text-muted-foreground">Loading squad...</p>
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

  const isAdmin = user && squad.adminIds.includes(user.id);

  if (!isAdmin) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="mb-4 text-center text-muted-foreground">
              Only squad admins can create matches
            </p>
            <Button asChild>
              <Link href={`/squads/${squadId}/matches`}>Back to Matches</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
        <h1 className="text-3xl font-bold">Create Match</h1>
        <p className="mt-2 text-muted-foreground">
          Schedule a new match for {squad.name}
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-destructive bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Match Details Card */}
        <Card>
          <CardHeader>
            <CardTitle>Match Details</CardTitle>
            <CardDescription>Set the date, time, and team size</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  required
                  disabled={isCreating}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="time">Time</Label>
                <Input
                  id="time"
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  required
                  disabled={isCreating}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="teamSize">Team Size (players per team)</Label>
              <Input
                id="teamSize"
                type="number"
                min="1"
                value={teamSize}
                onChange={(e) => setTeamSize(e.target.value)}
                required
                disabled={isCreating}
                placeholder="5"
              />
              <p className="text-xs text-muted-foreground">
                Default is 5 players per team (5-a-side)
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Player Selection Card */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Select Players</CardTitle>
                <CardDescription>
                  Choose an even number of players (minimum 2)
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSelectAll}
                  disabled={isCreating}
                >
                  Select All
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClearAll}
                  disabled={isCreating}
                >
                  Clear All
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex items-center justify-between rounded-lg border p-4">
              <span className="text-sm font-medium">Selected Players:</span>
              <Badge variant={selectedPlayerIds.length % 2 === 0 ? "default" : "destructive"}>
                {selectedPlayerIds.length}
                {selectedPlayerIds.length % 2 !== 0 && " (must be even)"}
              </Badge>
            </div>

            {squad.members.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No members in this squad yet
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {squad.members
                  .sort((a, b) => b.currentRating - a.currentRating)
                  .map((member) => {
                    const isSelected = selectedPlayerIds.includes(member.userId);
                    const isCurrentUser = user?.id === member.userId;
                    const memberIsAdmin = squad.adminIds.includes(member.userId);

                    return (
                      <button
                        key={member.userId}
                        type="button"
                        onClick={() => handlePlayerToggle(member.userId)}
                        disabled={isCreating}
                        className={`rounded-lg border p-4 text-left transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-accent"
                        } ${isCreating ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm">
                                {isCurrentUser
                                  ? "You"
                                  : `User ${member.userId.substring(0, 8)}...`}
                              </p>
                              {memberIsAdmin && (
                                <Badge variant="secondary" className="text-xs">
                                  Admin
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1 text-lg font-bold">
                              {member.currentRating}
                            </p>
                            <p className="text-xs text-muted-foreground">Rating</p>
                          </div>
                          <div
                            className={`h-5 w-5 rounded border-2 flex items-center justify-center ${
                              isSelected
                                ? "border-primary bg-primary"
                                : "border-muted-foreground"
                            }`}
                          >
                            {isSelected && (
                              <svg
                                className="h-3 w-3 text-primary-foreground"
                                fill="none"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Submit Button */}
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/squads/${squadId}/matches`)}
            disabled={isCreating}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isCreating || selectedPlayerIds.length < 2 || selectedPlayerIds.length % 2 !== 0}
            className="w-full sm:w-auto"
          >
            {isCreating ? "Creating..." : "Create Match"}
          </Button>
        </div>
      </form>
    </div>
  );
}
