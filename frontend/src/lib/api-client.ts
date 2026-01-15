import type {
  ApiResponse,
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  User,
  UserSquad,
  Squad,
  Match,
  SquadMembership,
} from "@/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
const TOKEN_KEY = "pitchmate_token";

// Token management
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

// Base fetch wrapper with authentication
async function fetchWithAuth<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = getToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    // Handle 401 Unauthorized - token expired or invalid
    if (response.status === 401) {
      removeToken();
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
      return { error: { code: "AUTH_003", message: "Session expired. Please log in again." } };
    }

    // Handle non-JSON responses
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      if (!response.ok) {
        return { error: { code: "API_ERROR", message: `HTTP ${response.status}: ${response.statusText}` } };
      }
      return { data: undefined as T };
    }

    const data = await response.json();

    if (!response.ok) {
      return { error: data.error || { code: "API_ERROR", message: data.message || "An error occurred" } };
    }

    return { data };
  } catch (error) {
    console.error("API request failed:", error);
    return { error: { code: "NETWORK_ERROR", message: "Network error. Please check your connection." } };
  }
}

// Auth API
export const authApi = {
  async register(request: RegisterRequest): Promise<ApiResponse<AuthResponse>> {
    const response = await fetchWithAuth<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(request),
    });
    if (response.data?.token) {
      setToken(response.data.token);
    }
    return response;
  },

  async login(request: LoginRequest): Promise<ApiResponse<AuthResponse>> {
    const response = await fetchWithAuth<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(request),
    });
    if (response.data?.token) {
      setToken(response.data.token);
    }
    return response;
  },

  async loginWithGoogle(googleToken: string): Promise<ApiResponse<AuthResponse>> {
    const response = await fetchWithAuth<AuthResponse>("/auth/google", {
      method: "POST",
      body: JSON.stringify({ token: googleToken }),
    });
    if (response.data?.token) {
      setToken(response.data.token);
    }
    return response;
  },

  logout(): void {
    removeToken();
  },
};

// Users API
export const usersApi = {
  async getCurrentUser(): Promise<ApiResponse<User>> {
    return fetchWithAuth<User>("/users/me");
  },

  async getUserSquads(): Promise<ApiResponse<UserSquad[]>> {
    const response = await fetchWithAuth<{ squads: UserSquad[] }>("/users/me/squads");
    if (response.data) {
      return { data: response.data.squads };
    }
    return { error: response.error };
  },

  async getUserRatingInSquad(userId: string, squadId: string): Promise<ApiResponse<SquadMembership>> {
    return fetchWithAuth<SquadMembership>(`/users/${userId}/squads/${squadId}/rating`);
  },
};

// Squads API
export const squadsApi = {
  async createSquad(name: string): Promise<ApiResponse<Squad>> {
    return fetchWithAuth<Squad>("/squads", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },

  async getSquad(squadId: string): Promise<ApiResponse<Squad>> {
    return fetchWithAuth<Squad>(`/squads/${squadId}`);
  },

  async joinSquad(squadId: string): Promise<ApiResponse<void>> {
    return fetchWithAuth<void>(`/squads/${squadId}/join`, {
      method: "POST",
    });
  },

  async addAdmin(squadId: string, userId: string): Promise<ApiResponse<void>> {
    return fetchWithAuth<void>(`/squads/${squadId}/admins`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
  },

  async removeMember(squadId: string, userId: string): Promise<ApiResponse<void>> {
    return fetchWithAuth<void>(`/squads/${squadId}/members/${userId}`, {
      method: "DELETE",
    });
  },
};

// Matches API
export const matchesApi = {
  async createMatch(
    squadId: string,
    scheduledAt: string,
    playerIds: string[],
    teamSize?: number
  ): Promise<ApiResponse<Match>> {
    return fetchWithAuth<Match>(`/squads/${squadId}/matches`, {
      method: "POST",
      body: JSON.stringify({ scheduledAt, playerIds, teamSize }),
    });
  },

  async getSquadMatches(squadId: string): Promise<ApiResponse<Match[]>> {
    return fetchWithAuth<Match[]>(`/squads/${squadId}/matches`);
  },

  async getMatch(matchId: string): Promise<ApiResponse<Match>> {
    return fetchWithAuth<Match>(`/matches/${matchId}`);
  },

  async recordResult(
    matchId: string,
    winner: "TeamA" | "TeamB" | "Draw",
    balanceFeedback?: string
  ): Promise<ApiResponse<void>> {
    return fetchWithAuth<void>(`/matches/${matchId}/result`, {
      method: "POST",
      body: JSON.stringify({ winner, balanceFeedback }),
    });
  },
};
