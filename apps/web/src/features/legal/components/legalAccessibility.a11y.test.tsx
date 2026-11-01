import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'jest-axe';
import { PrivacyPolicyPage } from './PrivacyPolicyPage';
import { TermsOfServicePage } from './TermsOfServicePage';
import { CookiePolicyPage } from './CookiePolicyPage';
import { CookieBanner } from './CookieBanner';
import { AccountPrivacyScreen } from './AccountPrivacyScreen';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

async function checkA11y(container: HTMLElement) {
  const results = await axe(container, {
    runOnly: {
      type: 'tag',
      values: [...WCAG_TAGS],
    },
  });
  expect(results).toHaveNoViolations();
}

describe('Legal Components a11y', () => {
  it('PrivacyPolicyPage has no accessibility violations', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/privacy']}>
        <PrivacyPolicyPage />
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('TermsOfServicePage has no accessibility violations', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/terms']}>
        <TermsOfServicePage />
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('CookiePolicyPage has no accessibility violations', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/cookies']}>
        <CookiePolicyPage />
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('CookieBanner has no accessibility violations in initial state', async () => {
    window.localStorage.clear();
    const { container } = render(
      <MemoryRouter>
        <CookieBanner />
      </MemoryRouter>,
    );
    await checkA11y(container);
  });

  it('AccountPrivacyScreen has no accessibility violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <AccountPrivacyScreen />
      </MemoryRouter>,
    );
    await checkA11y(container);
  });
});
