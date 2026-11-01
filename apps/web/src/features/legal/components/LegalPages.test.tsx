import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PrivacyPolicyPage } from './PrivacyPolicyPage';
import { TermsOfServicePage } from './TermsOfServicePage';
import { CookiePolicyPage } from './CookiePolicyPage';
import * as cookieConsent from '../lib/cookieConsent';

describe('Legal Pages', () => {
  it('renders PrivacyPolicyPage with headings and sections', () => {
    render(
      <MemoryRouter initialEntries={['/privacy']}>
        <PrivacyPolicyPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: /Privacy Policy/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /1\. Introduction and Data Controller/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /6\. Your Rights under UK GDPR/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /PitchMate Home/i })).toBeInTheDocument();
  });

  it('renders TermsOfServicePage with headings and sections', () => {
    render(
      <MemoryRouter initialEntries={['/terms']}>
        <TermsOfServicePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: /Terms of Service/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /1\. Acceptance of Terms/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /4\. Squad Organisers and Ownership/i })).toBeInTheDocument();
  });

  it('renders CookiePolicyPage with cookie inventory table and preference trigger', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(cookieConsent, 'openCookiePreferences');

    render(
      <MemoryRouter initialEntries={['/cookies']}>
        <CookiePolicyPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: /Cookie Policy/i })).toBeInTheDocument();
    expect(screen.getByText('pitchmate_session')).toBeInTheDocument();
    expect(screen.getByText('pitchmate_cookie_consent_v1')).toBeInTheDocument();

    const changeBtn = screen.getByRole('button', { name: /Change Cookie Preferences/i });
    expect(changeBtn).toBeInTheDocument();

    await user.click(changeBtn);
    expect(openSpy).toHaveBeenCalledTimes(1);
  });
});
