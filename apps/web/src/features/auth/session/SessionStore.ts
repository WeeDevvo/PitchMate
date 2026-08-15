/**
 * Persistence seam for the auth feature's Session model.
 *
 * A {@link SessionStore} is the sole boundary through which a Session's
 * Access_Token and Refresh_Token are persisted and restored. Keeping it behind
 * a small interface means:
 *
 * - the default browser implementation can persist under `localStorage` so a
 *   Session survives a full-document reload (Requirement 8.3);
 * - tests inject an in-memory implementation with identical semantics, without
 *   touching global state; and
 * - the storage backend can change later (e.g. an HttpOnly-cookie strategy)
 *   without altering the `SessionManager` contract.
 *
 * `load()` is defensive: it returns `null` whenever persisted state is absent
 * or cannot be interpreted as a valid Session because the Access_Token or
 * Refresh_Token is missing (Requirement 8.5). Callers treat `null` as
 * "unauthenticated" and discard any partial state.
 */

/**
 * A Session's persisted shape: the pair of tokens plus the Access_Token expiry
 * instant. This is the minimum needed to restore a usable Session after a
 * full-document reload (Requirement 8.3).
 */
export interface PersistedSession {
  /** Opaque bearer Access_Token. */
  readonly accessToken: string;
  /** Rotating, revocable Refresh_Token. */
  readonly refreshToken: string;
  /** Access_Token expiry instant, in epoch milliseconds. */
  readonly expiresAtMs: number;
}

/**
 * The persistence seam: load, save, and clear a {@link PersistedSession}.
 *
 * `load()` returns `null` when state is absent or uninterpretable
 * (Requirement 8.5). `save()` replaces any existing state. `clear()` deletes
 * the persisted state so a reload cannot restore a usable Session
 * (Requirements 9.3, 10.2, 10.3).
 */
export interface SessionStore {
  /** Return the persisted Session, or `null` when absent or uninterpretable. */
  load(): PersistedSession | null;
  /** Persist the given Session, replacing any existing state. */
  save(session: PersistedSession): void;
  /** Delete any persisted state. */
  clear(): void;
}

/**
 * The single namespaced key under which the browser store persists the Session.
 * Namespacing avoids collisions with other `localStorage` consumers.
 */
export const SESSION_STORAGE_KEY = 'pitchmate.auth.session';

/**
 * Interpret an arbitrary parsed value as a {@link PersistedSession}, or return
 * `null` when it cannot be a valid Session.
 *
 * A value is a valid Session iff it is an object with non-empty string
 * `accessToken` and `refreshToken`, and a finite numeric `expiresAtMs`
 * (Requirement 8.5). Any other shape — missing/empty/non-string tokens, or a
 * missing/non-finite expiry — yields `null`.
 */
function interpretSession(value: unknown): PersistedSession | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const { accessToken, refreshToken, expiresAtMs } = candidate;

  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return null;
  }
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    return null;
  }
  if (typeof expiresAtMs !== 'number' || !Number.isFinite(expiresAtMs)) {
    return null;
  }

  return { accessToken, refreshToken, expiresAtMs };
}

/**
 * Serialise a Session to the JSON string persisted under the namespaced key.
 * Only the three known fields are written so the stored shape stays stable.
 */
function serialiseSession(session: PersistedSession): string {
  return JSON.stringify({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAtMs: session.expiresAtMs,
  });
}

/**
 * A `localStorage`-backed {@link SessionStore}.
 *
 * State is persisted under a single namespaced key, so it survives a
 * full-document reload (Requirement 8.3). Every access to `localStorage` is
 * guarded: the API can be unavailable (SSR, privacy modes) or throw (quota,
 * blocked storage). On `load`, any failure — unavailable storage, absent key,
 * malformed JSON, or an incomplete Session — is treated as absent state and
 * yields `null` (Requirement 8.5), so a broken store never surfaces as an
 * error to the Session model. `save` and `clear` failures are swallowed rather
 * than thrown, since persistence is best-effort and the in-memory Session
 * remains the source of truth.
 */
class LocalStorageSessionStore implements SessionStore {
  /**
   * Resolve the backing `Storage`, or `null` when unavailable. Accessing
   * `localStorage` can throw in some environments, so it is probed defensively.
   */
  private getStorage(): Storage | null {
    try {
      if (typeof localStorage === 'undefined') {
        return null;
      }
      return localStorage;
    } catch {
      return null;
    }
  }

  load(): PersistedSession | null {
    const storage = this.getStorage();
    if (storage === null) {
      return null;
    }

    let raw: string | null;
    try {
      raw = storage.getItem(SESSION_STORAGE_KEY);
    } catch {
      return null;
    }

    if (raw === null) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    return interpretSession(parsed);
  }

  save(session: PersistedSession): void {
    const storage = this.getStorage();
    if (storage === null) {
      return;
    }
    try {
      storage.setItem(SESSION_STORAGE_KEY, serialiseSession(session));
    } catch {
      // Best-effort persistence: quota/blocked storage failures are ignored.
    }
  }

  clear(): void {
    const storage = this.getStorage();
    if (storage === null) {
      return;
    }
    try {
      storage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Best-effort: a failed clear leaves the in-memory Session authoritative.
    }
  }
}

/**
 * Create the default `localStorage`-backed {@link SessionStore}.
 *
 * Use this in the running app. Persistence survives a full-document reload
 * (Requirement 8.3) and degrades to "absent" when `localStorage` is
 * unavailable.
 */
export function createLocalStorageSessionStore(): SessionStore {
  return new LocalStorageSessionStore();
}

/**
 * Create an in-memory {@link SessionStore} for tests.
 *
 * It holds state in a closure rather than `localStorage`, so it never touches
 * global state and does not survive a reload. It shares the browser store's
 * `load()` null-on-incomplete semantics: a stored value missing either token or
 * a finite `expiresAtMs` is reported as absent (Requirement 8.5). Because
 * callers construct `PersistedSession` values through the typed `save()` API,
 * incompleteness is validated on the way in, and `load()` re-validates so the
 * in-memory contract matches the browser store exactly.
 */
export function createInMemorySessionStore(): SessionStore {
  let state: PersistedSession | null = null;

  return {
    load(): PersistedSession | null {
      return state === null ? null : interpretSession(state);
    },
    save(session: PersistedSession): void {
      state = interpretSession(session);
    },
    clear(): void {
      state = null;
    },
  };
}
