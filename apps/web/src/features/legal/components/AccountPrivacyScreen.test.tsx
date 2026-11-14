import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { PitchMateApiClient } from '@pitchmate/api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OPEN_COOKIE_PREFERENCES_EVENT } from '../lib/cookieConsent';
import { AccountPrivacyScreen } from './AccountPrivacyScreen';

describe('AccountPrivacyScreen', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all three GDPR sections as level-2 headings under SettingsDestination', () => {
    render(
      <MemoryRouter>
        <AccountPrivacyScreen />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: /Data Portability \(GDPR Article 20\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /Cookie & Tracking Preferences/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /Delete Account & Personal Data \(GDPR Article 17\)/i }),
    ).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /Privacy Policy/i })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: /Terms of Service/i })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: /Cookie Policy/i })).toHaveAttribute('href', '/cookies');
  });

  it('triggers download when Download My Data is clicked', async () => {
    const user = userEvent.setup();
    const mockExportData = {
      profile: { id: 'user-1', email: 'test@pitch-mate.co.uk', displayName: 'Test User' },
      squads: [],
      matches: [],
      stats: {
        totalMatchesPlayed: 0,
        totalWins: 0,
        totalDraws: 0,
        totalLosses: 0,
        totalGoalsScored: 0,
        totalOwnGoals: 0,
        totalCleanSheets: 0,
        totalKeeperMinutes: 0,
      },
      availabilityResponses: [],
      guestClaims: [],
      notifications: [],
      exportedAt: new Date().toISOString(),
    };

    const mockGet = vi.fn().mockResolvedValue({
      data: mockExportData,
      response: { ok: true, status: 200 },
    });

    const mockClient = {
      GET: mockGet,
    } as unknown as PitchMateApiClient;

    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    render(
      <MemoryRouter>
        <AccountPrivacyScreen apiClient={mockClient} />
      </MemoryRouter>,
    );

    const downloadBtn = screen.getByRole('button', { name: /Download My Data/i });
    await user.click(downloadBtn);

    expect(mockGet).toHaveBeenCalledWith('/api/v1/users/me/export', {});
    expect(createObjectUrlSpy).toHaveBeenCalled();
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:mock-url');
    expect(
      screen.getByText(/Your personal data export has been downloaded successfully/i),
    ).toBeInTheDocument();
  });

  it('opens cookie preferences dialog when Manage Cookie Preferences is clicked', async () => {
    const user = userEvent.setup();
    const openSpy = vi.fn();
    window.addEventListener(OPEN_COOKIE_PREFERENCES_EVENT, openSpy);

    try {
      render(
        <MemoryRouter>
          <AccountPrivacyScreen />
        </MemoryRouter>,
      );

      const manageBtn = screen.getByRole('button', { name: /Manage Cookie Preferences/i });
      await user.click(manageBtn);

      expect(openSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(OPEN_COOKIE_PREFERENCES_EVENT, openSpy);
    }
  });

  it('opens deletion modal and enforces confirmation before allowing deletion', async () => {
    const user = userEvent.setup();
    const mockDelete = vi.fn().mockResolvedValue({
      response: { ok: true, status: 204 },
    });

    const mockSignOut = vi.fn();

    const mockClient = {
      DELETE: mockDelete,
    } as unknown as PitchMateApiClient;

    render(
      <MemoryRouter>
        <AccountPrivacyScreen apiClient={mockClient} onSignedOut={mockSignOut} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /Delete Account/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Delete Account Confirmation/i })).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /Permanently Delete Account/i });
    expect(confirmBtn).toBeDisabled();

    const checkbox = screen.getByRole('checkbox', {
      name: /I understand that this action is irreversible/i,
    });
    await user.click(checkbox);
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByLabelText(/Type DELETE to confirm:/i);
    await user.type(input, 'WRONG');
    expect(confirmBtn).toBeDisabled();

    await user.clear(input);
    await user.type(input, 'DELETE');
    expect(confirmBtn).toBeEnabled();

    await user.click(confirmBtn);

    expect(mockDelete).toHaveBeenCalledWith('/api/v1/users/me', {});
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('displays sole-owner blocking message when server returns 409 OwnerConstraint', async () => {
    const user = userEvent.setup();
    const mockDelete = vi.fn().mockResolvedValue({
      error: {
        code: 'OwnerConstraint',
        detail: 'You are the sole owner of one or more active squads. Please transfer ownership first.',
      },
      response: { ok: false, status: 409 },
    });

    const mockClient = {
      DELETE: mockDelete,
    } as unknown as PitchMateApiClient;

    render(
      <MemoryRouter>
        <AccountPrivacyScreen apiClient={mockClient} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /Delete Account/i }));

    const checkbox = screen.getByRole('checkbox', {
      name: /I understand that this action is irreversible/i,
    });
    await user.click(checkbox);

    const input = screen.getByLabelText(/Type DELETE to confirm:/i);
    await user.type(input, 'DELETE');

    const confirmBtn = screen.getByRole('button', { name: /Permanently Delete Account/i });
    await user.click(confirmBtn);

    expect(
      screen.getByText(/Account deletion blocked: You are the sole owner of one or more active squads/i),
    ).toBeInTheDocument();
  });
});
