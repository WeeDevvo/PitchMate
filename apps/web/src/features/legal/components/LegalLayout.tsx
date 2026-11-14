import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { Card, Icon, Logo, TabNav, type TabNavItem } from '../../../ui';
import './LegalLayout.css';

export interface LegalLayoutProps {
  title: string;
  lastUpdated: string;
  version: string;
  children: ReactNode;
}

const LEGAL_TABS: readonly TabNavItem[] = [
  { id: '/privacy', label: 'Privacy Policy' },
  { id: '/terms', label: 'Terms of Service' },
  { id: '/cookies', label: 'Cookie Policy' },
];

export function LegalLayout({ title, lastUpdated, version, children }: LegalLayoutProps) {
  const location = useLocation();

  return (
    <div className="legal-page">
      <a href="#legal-main-content" className="legal-skip-link">
        Skip to main content
      </a>

      <header className="legal-header">
        <div className="legal-header__inner">
          <div className="legal-header__top">
            <Link to="/" className="legal-brand" aria-label="PitchMate Home">
              <Logo size={32} wordmark variant="auto" />
            </Link>

            <Link to="/" className="legal-home-link">
              <Icon name="chevronLeft" size={16} />
              <span>Back to Home</span>
            </Link>
          </div>

          <TabNav
            label="Legal documentation"
            tabs={LEGAL_TABS}
            active={location.pathname}
            renderLink={({ tab, className, current, children: tabChildren }) => (
              <Link to={tab.id} className={className} aria-current={current}>
                {tabChildren}
              </Link>
            )}
          />
        </div>
      </header>

      <main id="legal-main-content" className="legal-main" tabIndex={-1}>
        <Card as="article" className="legal-article">
          <header className="legal-article__header">
            <span className="legal-article__eyebrow">Legal &amp; Compliance</span>
            <h1 className="legal-article__title">{title}</h1>
            <dl className="legal-article__meta">
              <div className="legal-article__meta-item">
                <dt>Last updated</dt>
                <dd>{lastUpdated}</dd>
              </div>
              <div className="legal-article__meta-item">
                <dt>Version</dt>
                <dd>{version}</dd>
              </div>
            </dl>
          </header>

          <div className="legal-article__body">{children}</div>
        </Card>
      </main>

      <footer className="legal-footer">
        <div className="legal-footer__inner">
          <p className="legal-footer__copy">
            &copy; {new Date().getFullYear()} PitchMate (pitch-mate.co.uk). UK GDPR &amp; PECR Compliant.
          </p>
          <nav className="legal-footer__nav" aria-label="Legal footer links">
            <Link to="/privacy" className="legal-footer__link">
              Privacy Policy
            </Link>
            <Link to="/terms" className="legal-footer__link">
              Terms of Service
            </Link>
            <Link to="/cookies" className="legal-footer__link">
              Cookie Policy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
