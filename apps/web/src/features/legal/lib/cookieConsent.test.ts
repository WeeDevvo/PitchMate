import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptAllCookies,
  COOKIE_CONSENT_STORAGE_KEY,
  getCookieConsent,
  hasGivenConsent,
  openCookiePreferences,
  rejectNonEssentialCookies,
  saveCookieConsent,
  subscribeToConsentUpdates,
  subscribeToOpenPreferences,
} from './cookieConsent';

describe('cookieConsent', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns null when no consent has been stored', () => {
    expect(getCookieConsent()).toBeNull();
    expect(hasGivenConsent()).toBe(false);
  });

  it('saves and retrieves user choices correctly', () => {
    const prefs = saveCookieConsent({ analytics: true, marketing: false });
    expect(prefs.necessary).toBe(true);
    expect(prefs.analytics).toBe(true);
    expect(prefs.marketing).toBe(false);
    expect(prefs.version).toBe(1);
    expect(typeof prefs.timestamp).toBe('string');

    const loaded = getCookieConsent();
    expect(loaded).toEqual(prefs);
    expect(hasGivenConsent()).toBe(true);
  });

  it('accepts all cookies', () => {
    const prefs = acceptAllCookies();
    expect(prefs.necessary).toBe(true);
    expect(prefs.analytics).toBe(true);
    expect(prefs.marketing).toBe(true);
    expect(getCookieConsent()).toEqual(prefs);
  });

  it('rejects non-essential cookies', () => {
    const prefs = rejectNonEssentialCookies();
    expect(prefs.necessary).toBe(true);
    expect(prefs.analytics).toBe(false);
    expect(prefs.marketing).toBe(false);
    expect(getCookieConsent()).toEqual(prefs);
  });

  it('handles corrupted localStorage payload gracefully', () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, '{invalid json');
    expect(getCookieConsent()).toBeNull();
    expect(hasGivenConsent()).toBe(false);
  });

  it('handles invalid schema payload gracefully', () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({ version: 99 }));
    expect(getCookieConsent()).toBeNull();
  });

  it('dispatches and listens to openCookiePreferences event', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeToOpenPreferences(callback);

    openCookiePreferences();
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    openCookiePreferences();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers when consent is updated', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeToConsentUpdates(callback);

    const saved = saveCookieConsent({ analytics: true, marketing: true });
    expect(callback).toHaveBeenCalledWith(saved);

    unsubscribe();
    saveCookieConsent({ analytics: false, marketing: false });
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
