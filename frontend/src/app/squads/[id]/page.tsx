"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { squadsApi, usersApi } from "@/lib/api-client";
import type { Squad, User } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ArrowLeft, Copy, Shield, Calendar, Trophy, UserPlus, UserMinus, Check } from "lucide-react";

export default function SquadDetailPage() {
  const router = useRouter();
  const params = useParams();
  const squadId = params.id as string;
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [squad, setSquad] = useState<Squad | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [copied, setCopied] = useState(false);
  
  // Admin controls state
  const [showAddAdminDialog, setShowAddAdminDialog] = useState(false);
  const [showRemoveMemberDialog, setShowRemoveMemberDialog] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const getRatingColor = (rating: number) => {
    if (rating >= 1300) return "text-yellow-400"
    if (rating >= 1200) return "text-primary"
    if (rating >= 1100) return "text-blue-400"
    return "text-muted-foreground"
  }

  const handleCopyCode = async () => {
    await navigator.clipboard.writeText(squadId)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

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
        <div className="rounded-xl border border-border bg-card p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <p className="mb-4 text-muted-foreground">
              {error || "Squad not found"}
            </p>
            <Button asChild>
              <Link href="/squads">Back to Squads</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const isAdmin = user && squad.adminIds.includes(user.userId);
  const isMember = user && squad.members.some((m) => m.userId === user.userId);
  const userMembership = user ? squad.members.find((m) => m.userId === user.userId) : null;
  const sortedMembers = [...squad.members].sort((a, b) => b.currentRating - a.currentRating);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <Link
        href="/squads"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Squads
      </Link>

      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{squad.name}</h1>
            {isAdmin && (
              <Badge variant="secondary" className="bg-primary/10 text-primary border-0">
                <Shield className="mr-1 h-3 w-3" />
                Admin
              </Badge>
            )}
          </div>
          <p className="mt-2 text-muted-foreground">{squad.members.length} members</p>
        </div>

        {/* Squad Code */}
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2">
          <span className="text-sm text-muted-foreground">Squad ID:</span>
          <code className="font-mono text-sm">{squadId.substring(0, 13)}...</code>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCopyCode}>
            {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-destructive bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Your Rating Card */}
          {userMembership && (
            <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground uppercase tracking-wider">Your Rating</p>
                  <p className={`text-5xl font-bold ${getRatingColor(userMembership.currentRating)}`}>
                    {userMembership.currentRating}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Joined {new Date(userMembership.joinedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-6xl opacity-20">
                    <Trophy className="h-20 w-20" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Matches Section */}
          {isMember && (
            <div className="rounded-xl border border-border bg-card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Matches</h2>
                  <p className="text-sm text-muted-foreground">View and manage squad matches</p>
                </div>
                <Button asChild>
                  <Link href={`/squads/${squadId}/matches`}>
                    <Calendar className="mr-2 h-4 w-4" />
                    View Matches
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {/* Admin Controls */}
          {isAdmin && (
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="mb-4 text-lg font-semibold">Admin Controls</h2>
              <div className="flex flex-wrap gap-3">
                <Dialog open={showAddAdminDialog} onOpenChange={setShowAddAdminDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline">
                      <UserPlus className="mr-2 h-4 w-4" />
                      Add Admin
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Admin</DialogTitle>
                      <DialogDescription>Select a member to grant admin privileges</DialogDescription>
                    </DialogHeader>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={selectedUserId}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                    >
                      <option value="">Select a member</option>
                      {squad.members
                        .filter((m) => !squad.adminIds.includes(m.userId))
                        .map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.email}
                          </option>
                        ))}
                    </select>
                    <Button className="mt-4" onClick={handleAddAdmin} disabled={!selectedUserId || isProcessing}>
                      {isProcessing ? "Adding..." : "Add Admin"}
                    </Button>
                  </DialogContent>
                </Dialog>

                <Dialog open={showRemoveMemberDialog} onOpenChange={setShowRemoveMemberDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="text-destructive hover:text-destructive bg-transparent">
                      <UserMinus className="mr-2 h-4 w-4" />
                      Remove Member
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Remove Member</DialogTitle>
                      <DialogDescription>Select a member to remove from the squad</DialogDescription>
                    </DialogHeader>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={selectedUserId}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                    >
                      <option value="">Select a member</option>
                      {squad.members
                        .filter((m) => m.userId !== user?.userId)
                        .map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.email}
                          </option>
                        ))}
                    </select>
                    <Button 
                      variant="destructive" 
                      className="mt-4" 
                      onClick={handleRemoveMember} 
                      disabled={!selectedUserId || isProcessing}
                    >
                      {isProcessing ? "Removing..." : "Remove Member"}
                    </Button>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          )}
        </div>

        {/* Members List - Leaderboard */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">Leaderboard</h2>
          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2">
            {sortedMembers.map((member, index) => {
              const memberIsAdmin = squad.adminIds.includes(member.userId);
              const isCurrentUser = user?.userId === member.userId;
              
              return (
                <div
                  key={member.userId}
                  className={`flex items-center justify-between rounded-lg p-3 transition-colors ${
                    isCurrentUser
                      ? "bg-primary/10 border border-primary/30"
                      : "bg-secondary/30 hover:bg-secondary/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                        index === 0
                          ? "bg-yellow-500/20 text-yellow-400"
                          : index === 1
                            ? "bg-gray-400/20 text-gray-400"
                            : index === 2
                              ? "bg-orange-500/20 text-orange-400"
                              : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {index + 1}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {isCurrentUser ? "You" : member.email.split("@")[0]}
                        </span>
                        {memberIsAdmin && <Shield className="h-3 w-3 text-primary" />}
                      </div>
                    </div>
                  </div>
                  <span className={`text-lg font-bold ${getRatingColor(member.currentRating)}`}>
                    {member.currentRating}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
