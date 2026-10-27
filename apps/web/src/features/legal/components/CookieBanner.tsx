import { useEffect, useState, type FormEvent } from 'react';
import {
  acceptAllCookies,
  getCookieConsent,
  rejectNonEssentialCookies,
  saveCookieConsent,
  subscribeToOpenPreferences,
} from '../lib/cookieConsent';
import './CookieBanner.css';

export function CookieBanner() {
  const [isOpen, setIsOpen] = useState(() => !getCookieConsent());
  const [isCustomising, setIsCustomising] = useState(false);
  const [analytics, setAnalytics] = useState(() => getCookieConsent()?.analytics ?? false);
  const [marketing, setMarketing] = useState(() => getCookieConsent()?.marketing ?? false);
  const [hasConsented, setHasConsented] = useState(() => Boolean(getCookieConsent()));

  useEffect(() => {
    const unsubscribe = subscribeToOpenPreferences(() => {
      const current = getCookieConsent();
      if (current) {
        setAnalytics(current.analytics);
        setMarketing(current.marketing);
      }
      setIsCustomising(true);
      setIsOpen(true);
    });

    return unsubscribe;
  }, []);

  const handleAcceptAll = () => {
    acceptAllCookies();
    setHasConsented(true);
    setIsOpen(false);
    setIsCustomising(false);
  };

  const handleRejectNonEssential = () => {
    rejectNonEssentialCookies();
    setHasConsented(true);
    setIsOpen(false);
    setIsCustomising(false);
  };

  const handleSaveCustom = (e: FormEvent) => {
    e.preventDefault();
    saveCookieConsent({ analytics, marketing });
    setHasConsented(true);
    setIsOpen(false);
    setIsCustomising(false);
  };

  if (!isOpen) {
    if (!hasConsented) return null;
    return (
      <button
        type="button"
        className="cookie-retrigger-btn"
        onClick={() => {
          setIsCustomising(true);
          setIsOpen(true);
        }}
        aria-label="Manage Cookie Preferences"
      >
        🍪 Cookies
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-banner-title"
      aria-describedby="cookie-banner-desc"
      className="cookie-banner-wrapper"
    >
      <h2 id="cookie-banner-title" className="cookie-banner-title">
        {isCustomising ? 'Cookie & Privacy Preferences' : 'We value your privacy'}
      </h2>

      <p id="cookie-banner-desc" className="cookie-banner-desc">
        {isCustomising ? (
          <>
            Choose which cookie categories you permit. Essential cookies are required to sign in and
            use PitchMate securely. See our{' '}
            <a href="/cookies" onClick={() => setIsOpen(false)}>
              Cookie Policy
            </a>{' '}
            for full details.
          </>
        ) : (
          <>
            We use strictly necessary cookies to keep you signed in and secure. With your consent, we
            also use optional performance and marketing cookies to improve PitchMate. Learn more in our{' '}
            <a href="/cookies" onClick={() => setIsOpen(false)}>
              Cookie Policy
            </a>{' '}
            and{' '}
            <a href="/privacy" onClick={() => setIsOpen(false)}>
              Privacy Policy
            </a>
            .
          </>
        )}
      </p>

      {isCustomising ? (
        <form onSubmit={handleSaveCustom}>
          <div className="cookie-categories">
            <div className="cookie-category-item">
              <input
                type="checkbox"
                id="cookie-cat-necessary"
                checked={true}
                disabled={true}
                aria-describedby="desc-cat-necessary"
              />
              <label htmlFor="cookie-cat-necessary" className="cookie-category-label">
                <span className="cookie-category-name">
                  Strictly Necessary <span className="cookie-badge-required">Always Active</span>
                </span>
                <span id="desc-cat-necessary" className="cookie-category-desc">
                  Required for user authentication, security tokens, CSRF protection, and theme preference.
                </span>
              </label>
            </div>

            <div className="cookie-category-item">
              <input
                type="checkbox"
                id="cookie-cat-analytics"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
                aria-describedby="desc-cat-analytics"
              />
              <label htmlFor="cookie-cat-analytics" className="cookie-category-label">
                <span className="cookie-category-name">Performance & Analytics</span>
                <span id="desc-cat-analytics" className="cookie-category-desc">
                  Anonymous usage stats and error diagnostics to help us improve match organisation performance.
                </span>
              </label>
            </div>

            <div className="cookie-category-item">
              <input
                type="checkbox"
                id="cookie-cat-marketing"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
                aria-describedby="desc-cat-marketing"
              />
              <label htmlFor="cookie-cat-marketing" className="cookie-category-label">
                <span className="cookie-category-name">Marketing & Announcements</span>
                <span id="desc-cat-marketing" className="cookie-category-desc">
                  Measures the reach of new feature updates and referral invites.
                </span>
              </label>
            </div>
          </div>

          <div className="cookie-banner-actions">
            <button type="submit" className="cookie-btn-primary">
              Save Preferences
            </button>
            <button type="button" onClick={handleAcceptAll} className="cookie-btn-secondary">
              Accept All
            </button>
            <button type="button" onClick={handleRejectNonEssential} className="cookie-btn-ghost">
              Reject Non-Essential
            </button>
          </div>
        </form>
      ) : (
        <div className="cookie-banner-actions">
          <button type="button" onClick={handleAcceptAll} className="cookie-btn-primary">
            Accept All
          </button>
          <button type="button" onClick={handleRejectNonEssential} className="cookie-btn-secondary">
            Reject Non-Essential
          </button>
          <button
            type="button"
            onClick={() => setIsCustomising(true)}
            className="cookie-btn-ghost"
          >
            Customise Choices
          </button>
        </div>
      )}
    </div>
  );
}

export default CookieBanner;
