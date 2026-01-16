// User types
export interface User {
  userId: string;
  email: string;
  createdAt?: string;
}

// Squad types - matches backend UserSquadDto
export interface UserSquad {
  squadId: string;
  name: string;
  currentRating: number;
  joinedAt: string;
  isAdmin: boolean;
}

// Full squad type (for detail pages)
export interface Squad {
  id: string;
  name: string;
  createdAt: string;
  adminIds: string[];
  members: SquadMembership[];
}

export interface SquadMembership {
  userId: string;
  email: string;
  squadId: string;
  currentRating: number;
  joinedAt: string;
}

// Match types
export interface Match {
  matchId: string;
  squadId?: string;
  scheduledAt: string;
  teamSize: number;
  status: MatchStatus;
  playerCount: number;
  teamA?: Team;
  teamB?: Team;
  winner?: TeamDesignation | null;
  completedAt?: string | null;
  // Legacy properties for backward compatibility
  id?: string;
  players?: MatchPlayer[];
  result?: MatchResult;
}

export type MatchStatus = "Pending" | "Completed" | "Cancelled";

export interface MatchPlayer {
  userId: string;
  rating: number;
  ratingAtMatchTime?: number; // Legacy property
}

export interface Team {
  players: MatchPlayer[];
  totalRating: number;
}

export interface MatchResult {
  winner: TeamDesignation;
  balanceFeedback?: string;
  recordedAt: string;
}

export type TeamDesignation = "TeamA" | "TeamB" | "Draw";

// Auth types
export interface AuthResponse {
  token: string;
  user: User;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
}

// API response types
export interface ApiError {
  code: string;
  message: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
}
