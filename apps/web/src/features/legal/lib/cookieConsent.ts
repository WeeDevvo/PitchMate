/**
 * UK GDPR & PECR compliant cookie consent management for PitchMate.
 *
 * Implements persistent opt-in cookie category consent in `localStorage`.
 * Per the Privacy and Electronic Communications Regulations (PECR) and UK GDPR:
 * - Strictly Necessary cookies cannot be disabled and are active by default.
 * - Performance / Analytics and Marketing cookies require affirmative opt-in
 *   and must NOT be pre-ticked or pre-activated.
 * - Visitors must be able to change or withdraw their consent at any time.
 */

export const COOKIE_CONSENT_STORAGE_KEY = 'pitchmate_cookie_consent_v1';
export const OPEN_COOKIE_PREFERENCES_EVENT = 'pitchmate:open-cookie-preferences';
export const COOKIE_CONSENT_UPDATED_EVENT = 'pitchmate:cookie-consent-updated';

export interface CookieConsentPreferences {
  /** Essential session authentication, CSRF, security tokens, and theme preference. Cannot be opted out. */
  readonly necessary: true;
  /** Anonymous usage analytics, performance diagnostics, and crash reports. */
  readonly analytics: boolean;
  /** Marketing campaigns, referral attribution, and feature announcements. */
  readonly marketing: boolean;
  /** ISO 8601 UTC timestamp of when consent decision was made or updated. */
  readonly timestamp: string;
  /** Schema version for forward-compatible consent migrations. */
  readonly version: 1;
}

export type UserConsentChoices = Pick<CookieConsentPreferences, 'analytics' | 'marketing'>;

/**
 * Retrieves the currently saved cookie consent preferences from local storage.
 * Returns `null` if the user has not yet made a choice.
 */
export function getCookieConsent(): CookieConsentPreferences | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CookieConsentPreferences>;
    if (
      parsed &&
      parsed.version === 1 &&
      parsed.necessary === true &&
      typeof parsed.analytics === 'boolean' &&
      typeof parsed.marketing === 'boolean' &&
      typeof parsed.timestamp === 'string'
    ) {
      return parsed as CookieConsentPreferences;
    }
  } catch {
    // If corrupted, treat as unconsented.
  }

  return null;
}

/**
 * Checks whether the user has already recorded a cookie consent decision.
 */
export function hasGivenConsent(): boolean {
  return getCookieConsent() !== null;
}

/**
 * Saves the user's cookie choices, records the timestamp, and notifies listeners.
 */
export function saveCookieConsent(choices: UserConsentChoices): CookieConsentPreferences {
  const preferences: CookieConsentPreferences = {
    necessary: true,
    analytics: Boolean(choices.analytics),
    marketing: Boolean(choices.marketing),
    timestamp: new Date().toISOString(),
    version: 1,
  };

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(preferences));
      window.dispatchEvent(
        new CustomEvent<CookieConsentPreferences>(COOKIE_CONSENT_UPDATED_EVENT, {
          detail: preferences,
        }),
      );
    } catch {
      // Storage quota or privacy mode exception.
    }
  }

  return preferences;
}

/**
 * Grants opt-in consent to all cookie categories.
 */
export function acceptAllCookies(): CookieConsentPreferences {
  return saveCookieConsent({ analytics: true, marketing: true });
}

/**
 * Rejects all non-essential cookies (analytics and marketing set to false).
 */
export function rejectNonEssentialCookies(): CookieConsentPreferences {
  return saveCookieConsent({ analytics: false, marketing: false });
}

/**
 * Emits a custom event to reopen the cookie preferences dialog from anywhere in the app
 * (e.g. from the footer, cookie policy page, or settings).
 */
export function openCookiePreferences(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPEN_COOKIE_PREFERENCES_EVENT));
  }
}

/**
 * Subscribes to requests to reopen the cookie preferences dialog.
 * Returns an unsubscription function.
 */
export function subscribeToOpenPreferences(callback: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const listener = () => callback();
  window.addEventListener(OPEN_COOKIE_PREFERENCES_EVENT, listener);
  return () => window.removeEventListener(OPEN_COOKIE_PREFERENCES_EVENT, listener);
}

/**
 * Subscribes to updates to cookie consent preferences.
 * Returns an unsubscription function.
 */
export function subscribeToConsentUpdates(
  callback: (prefs: CookieConsentPreferences) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<CookieConsentPreferences>;
    if (customEvent.detail) {
      callback(customEvent.detail);
    }
  };

  window.addEventListener(COOKIE_CONSENT_UPDATED_EVENT, listener);
  return () => window.removeEventListener(COOKIE_CONSENT_UPDATED_EVENT, listener);
}
