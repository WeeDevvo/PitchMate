"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { squadsApi, usersApi } from "@/lib/api-client";
import type { Squad, User } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SquadDetailPage() {
  const router = useRouter();
  const params = useParams();
  const squadId = params.id as string;
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [squad, setSquad] = useState<Squad | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  
  // Admin controls state
  const [showAddAdminDialog, setShowAddAdminDialog] = useState(false);
  const [showRemoveMemberDialog, setShowRemoveMemberDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

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

  const handleJoinSquad = async () => {
    setIsJoining(true);
    setError(null);
    const response = await squadsApi.joinSquad(squadId);
    if (response.data !== undefined) {
      // Reload squad to get updated member list
      await loadSquad();
    } else {
      setError(response.error?.message || "Failed to join squad");
    }
    setIsJoining(false);
  };

  const handleAddAdmin = async () => {
    if (!selectedUserId) return;
    
    setIsProcessing(true);
    setError(null);
    const response = await squadsApi.addAdmin(squadId, selectedUserId);
    if (response.data !== undefined) {
      await loadSquad();
      setShowAddAdminDialog(false);
      setSelectedUserId("");
    } else {
      setError(response.error?.message || "Failed to add admin");
    }
    setIsProcessing(false);
  };

  const handleRemoveMember = async () => {
    if (!selectedUserId) return;
    
    setIsProcessing(true);
    setError(null);
    const response = await squadsApi.removeMember(squadId, selectedUserId);
    if (response.data !== undefined) {
      await loadSquad();
      setShowRemoveMemberDialog(false);
      setSelectedUserId("");
    } else {
      setError(response.error?.message || "Failed to remove member");
    }
    setIsProcessing(false);
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

  const isAdmin = user && squad.adminIds.includes(user.userId);
  const isMember = user && squad.members.some((m) => m.userId === user.userId);
  const userMembership = user ? squad.members.find((m) => m.userId === user.userId) : null;

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="mb-4">
          <Link href="/squads" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to Squads
          </Link>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold">{squad.name}</h1>
              {isAdmin && <Badge>Admin</Badge>}
            </div>
            <p className="mt-2 text-muted-foreground">
              {squad.members.length} {squad.members.length === 1 ? "member" : "members"}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <p className="text-xs text-muted-foreground">Squad ID: {squadId}</p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  navigator.clipboard.writeText(squadId);
                }}
              >
                Copy
              </Button>
            </div>
          </div>
          {!isMember && (
            <Button onClick={handleJoinSquad} disabled={isJoining} size="lg">
              {isJoining ? "Joining..." : "Join Squad"}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-destructive bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* User's Rating Card */}
      {userMembership && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Your Rating</CardTitle>
            <CardDescription>Your current skill rating in this squad</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold">{userMembership.currentRating}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Member since {new Date(userMembership.joinedAt).toLocaleDateString()}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Matches Section - Available to all members */}
      {isMember && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Matches</CardTitle>
            <CardDescription>View and manage squad matches</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="default" size="lg" className="w-full sm:w-auto">
              <Link href={`/squads/${squadId}/matches`}>View Matches</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Admin Controls */}
      {isAdmin && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Admin Controls</CardTitle>
            <CardDescription>Manage squad members and admins</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:flex-row">
            <Dialog open={showAddAdminDialog} onOpenChange={setShowAddAdminDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" className="w-full sm:w-auto">
                  Add Admin
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Admin</DialogTitle>
                  <DialogDescription>
                    Select a member to grant admin privileges
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="admin-select">Select Member</Label>
                    <select
                      id="admin-select"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={selectedUserId}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                      disabled={isProcessing}
                    >
                      <option value="">Select a member...</option>
                      {squad.members
                        .filter((m) => !squad.adminIds.includes(m.userId))
                        .map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.email} (Rating: {member.currentRating})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowAddAdminDialog(false);
                      setSelectedUserId("");
                    }}
                    disabled={isProcessing}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddAdmin}
                    disabled={!selectedUserId || isProcessing}
                  >
                    {isProcessing ? "Adding..." : "Add Admin"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={showRemoveMemberDialog} onOpenChange={setShowRemoveMemberDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" className="w-full sm:w-auto">
                  Remove Member
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Remove Member</DialogTitle>
                  <DialogDescription>
                    Select a member to remove from the squad
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="member-select">Select Member</Label>
                    <select
                      id="member-select"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={selectedUserId}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                      disabled={isProcessing}
                    >
                      <option value="">Select a member...</option>
                      {squad.members
                        .filter((m) => m.userId !== user?.userId)
                        .map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.email} (Rating: {member.currentRating})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowRemoveMemberDialog(false);
                      setSelectedUserId("");
                    }}
                    disabled={isProcessing}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleRemoveMember}
                    disabled={!selectedUserId || isProcessing}
                    variant="destructive"
                  >
                    {isProcessing ? "Removing..." : "Remove Member"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      )}

      {/* Members List */}
      <Card>
        <CardHeader>
          <CardTitle>Squad Members</CardTitle>
          <CardDescription>
            All members and their current ratings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {squad.members.length === 0 ? (
              <p className="text-center text-muted-foreground">No members yet</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {squad.members
                  .sort((a, b) => b.currentRating - a.currentRating)
                  .map((member, index) => {
                    const memberIsAdmin = squad.adminIds.includes(member.userId);
                    const isCurrentUser = user?.userId === member.userId;
                    
                    return (
                      <Card key={member.userId} className={isCurrentUser ? "border-primary" : ""}>
                        <CardContent className="pt-6">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-medium">
                                  {isCurrentUser ? "You" : member.email}
                                </p>
                                {memberIsAdmin && (
                                  <Badge variant="secondary" className="text-xs">
                                    Admin
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-1 text-2xl font-bold">{member.currentRating}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Rank #{index + 1}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
