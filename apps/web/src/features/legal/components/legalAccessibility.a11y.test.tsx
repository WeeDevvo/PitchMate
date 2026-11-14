import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PrivacyPolicyPage } from './PrivacyPolicyPage';
import { TermsOfServicePage } from './TermsOfServicePage';
import { CookiePolicyPage } from './CookiePolicyPage';
import { CookieBanner } from './CookieBanner';
import { AccountPrivacyScreen } from './AccountPrivacyScreen';

const THEMES = ['dark', 'light'] as const;

describe('Legal & GDPR Accessibility (WCAG 2.1 AA)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  describe.each(THEMES)('when data-theme="%s"', (theme) => {
    beforeEach(() => {
      document.documentElement.setAttribute('data-theme', theme);
    });

    it('PrivacyPolicyPage has no accessibility violations', async () => {
      const { container } = render(
        <MemoryRouter initialEntries={['/privacy']}>
          <PrivacyPolicyPage />
        </MemoryRouter>,
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('TermsOfServicePage has no accessibility violations', async () => {
      const { container } = render(
        <MemoryRouter initialEntries={['/terms']}>
          <TermsOfServicePage />
        </MemoryRouter>,
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('CookiePolicyPage has no accessibility violations', async () => {
      const { container } = render(
        <MemoryRouter initialEntries={['/cookies']}>
          <CookiePolicyPage />
        </MemoryRouter>,
      );

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('CookieBanner has no accessibility violations in initial banner and preferences modal', async () => {
      const user = userEvent.setup();
      const { baseElement } = render(
        <MemoryRouter>
          <CookieBanner />
        </MemoryRouter>,
      );

      const initialResults = await axe(baseElement);
      expect(initialResults).toHaveNoViolations();

      await user.click(screen.getByRole('button', { name: /Customise Choices/i }));
      const modalResults = await axe(baseElement);
      expect(modalResults).toHaveNoViolations();
    });

    it('AccountPrivacyScreen under Settings heading has no accessibility violations in idle or delete dialog state', async () => {
      const user = userEvent.setup();
      const { baseElement } = render(
        <MemoryRouter>
          <main>
            <h1>Account Settings</h1>
            <AccountPrivacyScreen />
          </main>
        </MemoryRouter>,
      );

      const idleResults = await axe(baseElement);
      expect(idleResults).toHaveNoViolations();

      await user.click(screen.getByRole('button', { name: /Delete Account/i }));
      const modalResults = await axe(baseElement);
      expect(modalResults).toHaveNoViolations();
    });
  });
});
