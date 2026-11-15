import { useEffect, useState, type MouseEvent } from 'react';

import { Button, Card, Checkbox, Dialog, Icon } from '../../../ui';
import {
  acceptAllCookies,
  getCookieConsent,
  rejectNonEssentialCookies,
  saveCookieConsent,
  subscribeToOpenPreferences,
  type CookieConsentPreferences,
} from '../lib/cookieConsent';
import './CookieBanner.css';

export interface CookieBannerProps {
  /**
   * Optional client-side router navigation callback (used when mounted outside
   * `<RouterProvider>` so legal links navigate without full-document reloads).
   */
  readonly onNavigate?: (path: string) => void;
}

export function CookieBanner({ onNavigate }: CookieBannerProps = {}) {
  const [consent, setConsent] = useState<CookieConsentPreferences | null>(() =>
    getCookieConsent(),
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [analyticsConsent, setAnalyticsConsent] = useState<boolean>(
    () => consent?.analytics ?? false,
  );
  const [marketingConsent, setMarketingConsent] = useState<boolean>(
    () => consent?.marketing ?? false,
  );

  useEffect(() => {
    return subscribeToOpenPreferences(() => {
      const current = getCookieConsent();
      setAnalyticsConsent(current?.analytics ?? false);
      setMarketingConsent(current?.marketing ?? false);
      setIsModalOpen(true);
    });
  }, []);

  const handlePolicyClick = (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    if (onNavigate) {
      event.preventDefault();
      onNavigate(path);
    }
  };

  const openModal = () => {
    const current = getCookieConsent();
    setAnalyticsConsent(current?.analytics ?? false);
    setMarketingConsent(current?.marketing ?? false);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
  };

  const handleAcceptAll = () => {
    const saved = acceptAllCookies();
    setConsent(saved);
    setAnalyticsConsent(true);
    setMarketingConsent(true);
    setIsModalOpen(false);
  };

  const handleRejectNonEssential = () => {
    const saved = rejectNonEssentialCookies();
    setConsent(saved);
    setAnalyticsConsent(false);
    setMarketingConsent(false);
    setIsModalOpen(false);
  };

  const handleSavePreferences = () => {
    const saved = saveCookieConsent({
      analytics: analyticsConsent,
      marketing: marketingConsent,
    });
    setConsent(saved);
    setIsModalOpen(false);
  };

  return (
    <>
      {consent === null && !isModalOpen && (
        <div
          className="cookie-banner"
          role="dialog"
          aria-modal="false"
          aria-labelledby="cookie-banner-title"
        >
          <Card raised className="cookie-banner__surface">
            <div className="cookie-banner__inner">
              <div className="cookie-banner__icon" aria-hidden="true">
                <Icon name="shield" size={20} />
              </div>

              <div className="cookie-banner__copy">
                <h2 id="cookie-banner-title" className="cookie-banner__title">
                  We value your privacy
                </h2>
                <p className="cookie-banner__description">
                  PitchMate uses strictly necessary browser storage to keep you signed in and
                  remember your theme preference. Optional analytics and marketing tracking remain
                  off unless you opt in. Read our{' '}
                  <a
                    href="/cookies"
                    className="cookie-banner__link"
                    onClick={(event) => handlePolicyClick(event, '/cookies')}
                  >
                    Cookie Policy
                  </a>{' '}
                  and{' '}
                  <a
                    href="/privacy"
                    className="cookie-banner__link"
                    onClick={(event) => handlePolicyClick(event, '/privacy')}
                  >
                    Privacy Policy
                  </a>
                  .
                </p>
              </div>
            </div>

            <div className="cookie-banner__actions">
              <Button type="button" variant="accent-ghost" size="sm" onClick={openModal}>
                Customise Choices
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleRejectNonEssential}
              >
                Reject Non-Essential
              </Button>
              <Button type="button" variant="primary" size="sm" onClick={handleAcceptAll}>
                Accept All
              </Button>
            </div>
          </Card>
        </div>
      )}

      {consent !== null && !isModalOpen && (
        <div className="cookie-reopen">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon="settings"
            className="cookie-reopen__btn"
            aria-label="Manage Cookie Preferences"
            onClick={openModal}
          >
            Manage Cookie Preferences
          </Button>
        </div>
      )}

      <Dialog
        open={isModalOpen}
        title="Cookie & Privacy Preferences"
        icon="shield"
        tone="neutral"
        onClose={closeModal}
        actions={
          <>
            <Button type="button" variant="ghost" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="button" variant="secondary" onClick={handleRejectNonEssential}>
              Reject Non-Essential
            </Button>
            <Button type="button" variant="primary" onClick={handleSavePreferences}>
              Save Preferences
            </Button>
          </>
        }
      >
        <p className="pm-dialog__body">
          Manage your PECR &amp; UK GDPR storage choices below. Non-essential categories are off by
          default. View the{' '}
          <a
            href="/cookies"
            className="cookie-banner__link"
            onClick={(event) => {
              closeModal();
              handlePolicyClick(event, '/cookies');
            }}
          >
            Cookie Policy
          </a>{' '}
          for full technical details.
        </p>

        <div className="cookie-pref-list">
          <div className="cookie-pref-item">
            <Checkbox
              label="Strictly Necessary"
              checked={true}
              disabled={true}
              onChange={() => {}}
              description="Essential authentication session, theme appearance, and cookie consent storage required for PitchMate to operate."
            />
          </div>

          <div className="cookie-pref-item">
            <Checkbox
              label="Performance & Analytics"
              checked={analyticsConsent}
              onChange={setAnalyticsConsent}
              description="Optional anonymous usage diagnostics and reliability measurements. Off by default unless enabled."
            />
          </div>

          <div className="cookie-pref-item">
            <Checkbox
              label="Marketing & Announcements"
              checked={marketingConsent}
              onChange={setMarketingConsent}
              description="Optional announcements about new PitchMate features and updates. Off by default unless enabled."
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}

export default CookieBanner;
