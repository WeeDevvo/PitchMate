/**
 * The one Appearance_Preference store for the whole web application.
 *
 * This module owns {@link APPEARANCE_STORAGE_KEY} — the single namespaced
 * browser storage key holding the Appearance_Preference. It is declared here
 * exactly once and imported by the marketing landing page, the auth screens,
 * and the app shell, so no second key can hold a differing value
 * (Requirements 12.5, 15.7).
 *
 * Both directions are defensive, because browser storage is genuinely optional:
 * it can be absent (SSR, a locked-down embed), throw on access (privacy modes),
 * or reject a write (quota, blocked storage).
 *
 * - A read that cannot happen, or that yields a value which is not one of
 *   `system`, `dark`, or `light`, resolves to `system` and surfaces no error
 *   (Requirement 12.6). The interpretation rule itself lives in
 *   {@link interpretStoredPreference}; this module only supplies the raw value.
 * - A write that is rejected does not throw. It reports that it did not persist
 *   so the caller can honour the selected value in memory for the rest of the
 *   session, while the next start of the application falls back to `system`
 *   (Requirement 12.14).
 *
 * The stored representation is the bare preference string rather than JSON, so
 * the pre-paint bootstrap can read it with a single `getItem` and no parsing.
 */

import {
  interpretStoredPreference,
  type AppearancePreference,
} from './themeResolution';

/**
 * The single namespaced browser storage key for the Appearance_Preference.
 *
 * Declared exactly once in the web application (Requirements 12.5, 15.7).
 * Namespacing avoids collisions with other storage consumers on the origin.
 */
export const APPEARANCE_STORAGE_KEY = 'pitchmate.appearance';

/**
 * The slice of the browser `Storage` API this module needs.
 *
 * Narrowing to the two methods used keeps the seam small and lets a caller or a
 * test supply a stub — including one whose accessors throw — without standing up
 * a whole `Storage`.
 */
export interface AppearanceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * `undefined` means "resolve the ambient browser storage"; `null` means
 * "there is no storage", which is how an unavailable store is expressed.
 */
type SuppliedStorage = AppearanceStorage | null | undefined;

/**
 * Resolve the ambient browser storage, or `null` when it is unavailable.
 *
 * Merely *touching* `localStorage` can throw (some privacy modes make the
 * property access itself raise), so the probe is wrapped rather than relying on
 * a truthiness check.
 */
function ambientStorage(): AppearanceStorage | null {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Resolve the storage to use: an explicitly supplied one (possibly `null` for
 * "unavailable"), or the ambient browser storage when nothing was supplied.
 */
function resolveStorage(supplied: SuppliedStorage): AppearanceStorage | null {
  return supplied === undefined ? ambientStorage() : supplied;
}

/**
 * Read the stored Appearance_Preference.
 *
 * Total and never throwing: unavailable storage, a rejected read, an absent
 * key, and a stored value that is not one of `system`, `dark`, or `light` all
 * yield `system`, and no error is raised or surfaced (Requirement 12.6).
 *
 * @param storage - Storage to read from. Omit to use the ambient browser
 *   storage; pass `null` to model storage being unavailable.
 *
 * Requirements: 12.6, 15.7
 */
export function readAppearancePreference(
  storage?: SuppliedStorage,
): AppearancePreference {
  const store = resolveStorage(storage);
  if (store === null) {
    return 'system';
  }

  let raw: string | null;
  try {
    raw = store.getItem(APPEARANCE_STORAGE_KEY);
  } catch {
    return 'system';
  }

  return interpretStoredPreference(raw);
}

/**
 * Write the Appearance_Preference under {@link APPEARANCE_STORAGE_KEY}.
 *
 * Never throws. The return value reports whether the value was persisted:
 * `false` means storage was unavailable or the write was rejected, in which case
 * the caller keeps honouring the selected value for the remainder of the session
 * in memory and the next start of the application reads `system`
 * (Requirement 12.14).
 *
 * @param preference - The value the person selected.
 * @param storage - Storage to write to. Omit to use the ambient browser
 *   storage; pass `null` to model storage being unavailable.
 * @returns `true` iff the value was persisted.
 *
 * Requirements: 12.5, 12.14, 15.7
 */
export function writeAppearancePreference(
  preference: AppearancePreference,
  storage?: SuppliedStorage,
): boolean {
  const store = resolveStorage(storage);
  if (store === null) {
    return false;
  }

  try {
    store.setItem(APPEARANCE_STORAGE_KEY, preference);
    return true;
  } catch {
    // Best-effort persistence: the selection still stands for this session.
    return false;
  }
}

/**
 * Create an in-memory {@link AppearanceStorage} holding its state in a closure.
 *
 * Useful for tests and for any context that wants the read/write contract
 * without touching global state. It does not survive a reload, which mirrors
 * the "rejected write" case: the selection holds for the session only.
 */
export function createInMemoryAppearanceStorage(): AppearanceStorage {
  const values = new Map<string, string>();

  return {
    getItem(key: string): string | null {
      return values.has(key) ? (values.get(key) as string) : null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
  };
}
