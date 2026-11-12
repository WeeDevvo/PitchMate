import { Button } from '../../../ui';
import { LegalLayout } from './LegalLayout';
import { cookiePolicyContent } from '../content/cookiePolicyContent';
import { openCookiePreferences } from '../lib/cookieConsent';

export function CookiePolicyPage() {
  return (
    <LegalLayout
      title={cookiePolicyContent.title}
      lastUpdated={cookiePolicyContent.lastUpdated}
      version={cookiePolicyContent.version}
    >
      {cookiePolicyContent.sections.map((section) => (
        <section key={section.id} id={section.id} className="legal-section" aria-labelledby={`${section.id}-title`}>
          <h2 id={`${section.id}-title`} className="legal-section__heading">
            {section.title}
          </h2>
          {section.content.map((paragraph, idx) => (
            <p key={idx} className="legal-section__paragraph">
              {paragraph}
            </p>
          ))}
        </section>
      ))}

      <section className="legal-section" aria-labelledby="cookie-inventory-heading">
        <h2 id="cookie-inventory-heading" className="legal-section__heading">
          Browser Storage &amp; Authentication Flows
        </h2>

        <div
          className="legal-table-wrapper"
          role="region"
          aria-labelledby="cookie-inventory-caption"
          tabIndex={0}
        >
          <table className="legal-table">
            <caption id="cookie-inventory-caption" className="legal-table__caption">
              Cookies, localStorage keys, and sign-in technologies used by PitchMate
            </caption>
            <thead>
              <tr>
                <th scope="col">Name / Key</th>
                <th scope="col">Category</th>
                <th scope="col">Purpose</th>
                <th scope="col">Provider</th>
                <th scope="col">Duration</th>
              </tr>
            </thead>
            <tbody>
              {cookiePolicyContent.cookies.map((cookie) => (
                <tr key={cookie.name}>
                  <th scope="row" data-label="Name / Key">
                    <code className="legal-code">{cookie.name}</code>
                  </th>
                  <td data-label="Category">
                    <span className="legal-badge">{cookie.category}</span>
                  </td>
                  <td data-label="Purpose">{cookie.purpose}</td>
                  <td data-label="Provider">{cookie.provider}</td>
                  <td data-label="Duration">{cookie.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="legal-action-bar">
          <Button
            type="button"
            variant="primary"
            icon="settings"
            onClick={() => openCookiePreferences()}
          >
            Change Cookie Preferences
          </Button>
        </div>
      </section>
    </LegalLayout>
  );
}

export default CookiePolicyPage;
