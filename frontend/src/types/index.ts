// User types
export interface User {
  id: string;
  email: string;
  createdAt: string;
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
  squadId: string;
  currentRating: number;
  joinedAt: string;
}

// Match types
export interface Match {
  id: string;
  squadId: string;
  scheduledAt: string;
  teamSize: number;
  status: MatchStatus;
  players: MatchPlayer[];
  teamA?: Team;
  teamB?: Team;
  result?: MatchResult;
}

export type MatchStatus = "Pending" | "Completed" | "Cancelled";

export interface MatchPlayer {
  userId: string;
  ratingAtMatchTime: number;
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
