import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { PitchMateApiClient } from '@pitchmate/api-client';
import { AccountPrivacyScreen } from './AccountPrivacyScreen';
import * as cookieConsent from '../lib/cookieConsent';

describe('AccountPrivacyScreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all three GDPR sections', () => {
    render(
      <MemoryRouter>
        <AccountPrivacyScreen />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /Data Portability \(GDPR Article 20\)/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Cookie & Tracking Preferences/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Delete Account & Personal Data \(GDPR Article 17\)/i })).toBeInTheDocument();
  });

  it('triggers download when Download My Data is clicked', async () => {
    const user = userEvent.setup();
    const mockExportData = {
      profile: { userId: 'u-1', displayName: 'Player One', email: 'p1@example.com' },
      squads: [],
      matches: [],
      stats: { totalMatchesPlayed: 0, totalWins: 0, totalDraws: 0, totalLosses: 0 },
      payments: [],
      exportedAt: new Date().toISOString(),
    };

    const mockGet = vi.fn().mockResolvedValue({
      data: mockExportData,
      response: { status: 200 },
    });

    const mockClient = {
      GET: mockGet,
    } as unknown as PitchMateApiClient;

    // Mock URL.createObjectURL and revokeObjectURL
    const createObjectUrlSpy = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectUrlSpy = vi.fn();
    window.URL.createObjectURL = createObjectUrlSpy;
    window.URL.revokeObjectURL = revokeObjectUrlSpy;

    render(
      <MemoryRouter>
        <AccountPrivacyScreen apiClient={mockClient} />
      </MemoryRouter>,
    );

    const downloadBtn = screen.getByRole('button', { name: /Download My Data/i });
    await user.click(downloadBtn);

    expect(mockGet).toHaveBeenCalledWith('/api/v1/users/me/export', {});
    expect(createObjectUrlSpy).toHaveBeenCalled();
    expect(screen.getByText(/Your personal data export has been downloaded successfully/i)).toBeInTheDocument();
  });

  it('opens cookie preferences dialog when Manage Cookie Preferences is clicked', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(cookieConsent, 'openCookiePreferences');

    render(
      <MemoryRouter>
        <AccountPrivacyScreen />
      </MemoryRouter>,
    );

    const manageBtn = screen.getByRole('button', { name: /Manage Cookie Preferences/i });
    await user.click(manageBtn);

    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('opens deletion modal and enforces confirmation before allowing deletion', async () => {
    const user = userEvent.setup();
    const mockDelete = vi.fn().mockResolvedValue({
      response: { status: 204 },
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

    expect(screen.getByRole('heading', { name: /Delete Account Confirmation/i })).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /Permanently Delete Account/i });
    expect(confirmBtn).toBeDisabled();

    // Check confirmation checkbox
    const checkbox = screen.getByRole('checkbox', { name: /I understand that this action is irreversible/i });
    await user.click(checkbox);
    expect(confirmBtn).toBeDisabled();

    // Type wrong confirm text
    const input = screen.getByLabelText(/Type DELETE to confirm:/i);
    await user.type(input, 'NO');
    expect(confirmBtn).toBeDisabled();

    // Type DELETE
    await user.clear(input);
    await user.type(input, 'DELETE');
    expect(confirmBtn).toBeEnabled();

    // Submit deletion
    await user.click(confirmBtn);

    expect(mockDelete).toHaveBeenCalledWith('/api/v1/users/me', {});
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('displays sole-owner blocking message when server returns 409 OwnerConstraint', async () => {
    const user = userEvent.setup();
    const mockDelete = vi.fn().mockResolvedValue({
      error: {
        code: 'OwnerConstraint',
        message: 'Ownership of a live squad must be transferred before the owning user can be erased.',
      },
      response: { status: 409 },
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

    const checkbox = screen.getByRole('checkbox', { name: /I understand that this action is irreversible/i });
    await user.click(checkbox);

    const input = screen.getByLabelText(/Type DELETE to confirm:/i);
    await user.type(input, 'DELETE');

    const confirmBtn = screen.getByRole('button', { name: /Permanently Delete Account/i });
    await user.click(confirmBtn);

    expect(mockDelete).toHaveBeenCalledWith('/api/v1/users/me', {});
    expect(
      screen.getByText(/Account deletion blocked: You are the sole owner of one or more active squads/i),
    ).toBeInTheDocument();
  });
});
