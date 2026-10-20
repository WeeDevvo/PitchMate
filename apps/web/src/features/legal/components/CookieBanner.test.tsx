import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CookieBanner } from './CookieBanner';
import {
  COOKIE_CONSENT_STORAGE_KEY,
  getCookieConsent,
  openCookiePreferences,
} from '../lib/cookieConsent';

describe('CookieBanner', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('renders initial banner when no consent recorded', () => {
    render(<CookieBanner />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /We value your privacy/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Accept All/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reject Non-Essential/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Customise Choices/i })).toBeInTheDocument();
  });

  it('accepts all cookies and stores preference', async () => {
    const user = userEvent.setup();
    render(<CookieBanner />);

    const acceptBtn = screen.getByRole('button', { name: /Accept All/i });
    await user.click(acceptBtn);

    const consent = getCookieConsent();
    expect(consent).not.toBeNull();
    expect(consent?.necessary).toBe(true);
    expect(consent?.analytics).toBe(true);
    expect(consent?.marketing).toBe(true);

    // Floating trigger button should now be visible
    expect(screen.getByRole('button', { name: /Manage Cookie Preferences/i })).toBeInTheDocument();
  });

  it('rejects non-essential cookies and stores preference', async () => {
    const user = userEvent.setup();
    render(<CookieBanner />);

    const rejectBtn = screen.getByRole('button', { name: /Reject Non-Essential/i });
    await user.click(rejectBtn);

    const consent = getCookieConsent();
    expect(consent).not.toBeNull();
    expect(consent?.necessary).toBe(true);
    expect(consent?.analytics).toBe(false);
    expect(consent?.marketing).toBe(false);

    // Floating trigger button should now be visible
    expect(screen.getByRole('button', { name: /Manage Cookie Preferences/i })).toBeInTheDocument();
  });

  it('customises categories with strictly necessary locked and optional categories unchecked', async () => {
    const user = userEvent.setup();
    render(<CookieBanner />);

    await user.click(screen.getByRole('button', { name: /Customise Choices/i }));

    expect(screen.getByRole('heading', { name: /Cookie & Privacy Preferences/i })).toBeInTheDocument();

    const necessaryCheckbox = screen.getByRole('checkbox', { name: /Strictly Necessary/i });
    expect(necessaryCheckbox).toBeChecked();
    expect(necessaryCheckbox).toBeDisabled();

    const analyticsCheckbox = screen.getByRole('checkbox', { name: /Performance & Analytics/i });
    expect(analyticsCheckbox).not.toBeChecked();
    expect(analyticsCheckbox).toBeEnabled();

    const marketingCheckbox = screen.getByRole('checkbox', { name: /Marketing & Announcements/i });
    expect(marketingCheckbox).not.toBeChecked();
    expect(marketingCheckbox).toBeEnabled();

    // Check analytics only
    await user.click(analyticsCheckbox);
    expect(analyticsCheckbox).toBeChecked();

    await user.click(screen.getByRole('button', { name: /Save Preferences/i }));

    const consent = getCookieConsent();
    expect(consent?.analytics).toBe(true);
    expect(consent?.marketing).toBe(false);
  });

  it('re-opens preferences when external event is fired', async () => {
    // Seed consent
    window.localStorage.setItem(
      COOKIE_CONSENT_STORAGE_KEY,
      JSON.stringify({
        necessary: true,
        analytics: true,
        marketing: false,
        timestamp: new Date().toISOString(),
        version: 1,
      }),
    );

    render(<CookieBanner />);

    // Initially collapsed
    expect(screen.queryByRole('heading', { name: /Cookie & Privacy Preferences/i })).not.toBeInTheDocument();

    // Trigger open
    await act(async () => {
      openCookiePreferences();
    });

    expect(screen.getByRole('heading', { name: /Cookie & Privacy Preferences/i })).toBeInTheDocument();
  });
});
