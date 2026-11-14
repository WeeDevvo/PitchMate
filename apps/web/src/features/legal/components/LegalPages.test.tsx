import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { SESSION_STORAGE_KEY } from '../../auth';
import { APPEARANCE_STORAGE_KEY } from '../../../theme';
import { OPEN_COOKIE_PREFERENCES_EVENT, COOKIE_CONSENT_STORAGE_KEY } from '../lib/cookieConsent';
import { PrivacyPolicyPage } from './PrivacyPolicyPage';
import { TermsOfServicePage } from './TermsOfServicePage';
import { CookiePolicyPage } from './CookiePolicyPage';

describe('Legal Documentation Pages', () => {
  it('renders PrivacyPolicyPage with headings, sections, and pitch-mate.co.uk contact details', () => {
    render(
      <MemoryRouter initialEntries={['/privacy']}>
        <PrivacyPolicyPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: /Privacy Policy/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /1\. Introduction and Data Controller/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /6\. Your Rights under UK GDPR/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /PitchMate Home/i })).toBeInTheDocument();
    expect(screen.getAllByText(/privacy@pitch-mate\.co\.uk/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/pitchmate\.app/i)).not.toBeInTheDocument();
  });

  it('renders TermsOfServicePage with headings and sections', () => {
    render(
      <MemoryRouter initialEntries={['/terms']}>
        <TermsOfServicePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: /Terms of Service/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /1\. Acceptance of Terms/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /4\. Squad Organisers and Ownership/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/support@pitch-mate\.co\.uk/i).length).toBeGreaterThan(0);
  });

  it('renders CookiePolicyPage with real storage keys and preference trigger', async () => {
    const user = userEvent.setup();
    const openSpy = vi.fn();
    window.addEventListener(OPEN_COOKIE_PREFERENCES_EVENT, openSpy);

    try {
      render(
        <MemoryRouter initialEntries={['/cookies']}>
          <CookiePolicyPage />
        </MemoryRouter>,
      );

      expect(screen.getByRole('heading', { level: 1, name: /Cookie Policy/i })).toBeInTheDocument();
      expect(screen.getByText(SESSION_STORAGE_KEY)).toBeInTheDocument();
      expect(screen.getByText(APPEARANCE_STORAGE_KEY)).toBeInTheDocument();
      expect(screen.getByText(COOKIE_CONSENT_STORAGE_KEY)).toBeInTheDocument();
      expect(screen.queryByText('_pk_analytics')).not.toBeInTheDocument();

      const changeBtn = screen.getByRole('button', { name: /Change Cookie Preferences/i });
      expect(changeBtn).toBeInTheDocument();

      await user.click(changeBtn);
      expect(openSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(OPEN_COOKIE_PREFERENCES_EVENT, openSpy);
    }
  });
});
