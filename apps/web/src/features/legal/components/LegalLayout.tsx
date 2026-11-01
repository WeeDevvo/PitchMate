import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './LegalLayout.css';

export interface LegalLayoutProps {
  title: string;
  lastUpdated: string;
  version: string;
  children: ReactNode;
}

const LEGAL_TABS = [
  { label: 'Privacy Policy', path: '/privacy' },
  { label: 'Terms of Service', path: '/terms' },
  { label: 'Cookie Policy', path: '/cookies' },
] as const;

export function LegalLayout({ title, lastUpdated, version, children }: LegalLayoutProps) {
  const location = useLocation();

  return (
    <div className="legal-page">
      <header className="legal-header">
        <div className="legal-nav-top">
          <Link to="/" className="legal-brand-link" aria-label="PitchMate Home">
            ← PitchMate
          </Link>
          <nav className="legal-tabs" aria-label="Legal Documents">
            {LEGAL_TABS.map((tab) => (
              <Link
                key={tab.path}
                to={tab.path}
                className="legal-tab-link"
                aria-current={location.pathname === tab.path ? 'page' : undefined}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="legal-title-group">
          <h1>{title}</h1>
          <div className="legal-meta">
            <span>Last Updated: {lastUpdated}</span>
            <span>Version: {version}</span>
          </div>
        </div>
      </header>

      <main className="legal-content">
        <article>{children}</article>
      </main>
    </div>
  );
}
