import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COOKIE_CONSENT_STORAGE_KEY,
  getCookieConsent,
  openCookiePreferences,
} from '../lib/cookieConsent';
import { CookieBanner } from './CookieBanner';

describe('CookieBanner', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders initial consent banner when no decision exists in localStorage', () => {
    render(<CookieBanner />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /We value your privacy/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Accept All/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reject Non-Essential/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Customise Choices/i })).toBeInTheDocument();
  });

  it('saves all consents when Accept All is clicked and hides banner', async () => {
    const user = userEvent.setup();
    render(<CookieBanner />);

    const acceptBtn = screen.getByRole('button', { name: /Accept All/i });
    await user.click(acceptBtn);

    const saved = getCookieConsent();
    expect(saved?.necessary).toBe(true);
    expect(saved?.analytics).toBe(true);
    expect(saved?.marketing).toBe(true);

    expect(screen.queryByRole('heading', { name: /We value your privacy/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Manage Cookie Preferences/i })).toBeInTheDocument();
  });

  it('rejects non-essential cookies when Reject Non-Essential is clicked', async () => {
    const user = userEvent.setup();
    render(<CookieBanner />);

    const rejectBtn = screen.getByRole('button', { name: /Reject Non-Essential/i });
    await user.click(rejectBtn);

    const saved = getCookieConsent();
    expect(saved?.necessary).toBe(true);
    expect(saved?.analytics).toBe(false);
    expect(saved?.marketing).toBe(false);

    expect(screen.queryByRole('heading', { name: /We value your privacy/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Manage Cookie Preferences/i })).toBeInTheDocument();
  });

  it('allows granular toggle selection with defaults unchecked in preferences modal', async () => {
    const user = userEvent.setup();
    render(<CookieBanner />);

    await user.click(screen.getByRole('button', { name: /Customise Choices/i }));

    expect(
      screen.getByRole('heading', { name: /Cookie & Privacy Preferences/i }),
    ).toBeInTheDocument();

    const necessaryCheckbox = screen.getByRole('checkbox', { name: /Strictly Necessary/i });
    expect(necessaryCheckbox).toBeChecked();
    expect(necessaryCheckbox).toBeDisabled();

    const analyticsCheckbox = screen.getByRole('checkbox', { name: /Performance & Analytics/i });
    expect(analyticsCheckbox).not.toBeChecked();
    expect(analyticsCheckbox).toBeEnabled();

    const marketingCheckbox = screen.getByRole('checkbox', { name: /Marketing & Announcements/i });
    expect(marketingCheckbox).not.toBeChecked();

    await user.click(analyticsCheckbox);
    expect(analyticsCheckbox).toBeChecked();

    await user.click(screen.getByRole('button', { name: /Save Preferences/i }));

    const saved = getCookieConsent();
    expect(saved?.analytics).toBe(true);
    expect(saved?.marketing).toBe(false);
  });

  it('routes policy links via onNavigate callback without full-document reload', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(<CookieBanner onNavigate={onNavigate} />);

    await user.click(screen.getByRole('link', { name: /Cookie Policy/i }));
    await user.click(screen.getByRole('link', { name: /Privacy Policy/i }));

    expect(onNavigate).toHaveBeenNthCalledWith(1, '/cookies');
    expect(onNavigate).toHaveBeenNthCalledWith(2, '/privacy');
  });

  it('re-opens preferences when external event is fired', async () => {
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

    expect(
      screen.queryByRole('heading', { name: /Cookie & Privacy Preferences/i }),
    ).not.toBeInTheDocument();

    await act(async () => {
      openCookiePreferences();
    });

    expect(
      screen.getByRole('heading', { name: /Cookie & Privacy Preferences/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Performance & Analytics/i })).toBeChecked();
  });
});
