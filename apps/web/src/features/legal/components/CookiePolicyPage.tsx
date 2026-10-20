import { LegalLayout } from './LegalLayout';
import { cookiePolicyContent } from '../content/cookiePolicyContent';
import { openCookiePreferences } from '../lib/cookieConsent';

export function CookiePolicyPage() {
  const { title, lastUpdated, version, sections, cookies } = cookiePolicyContent;

  return (
    <LegalLayout title={title} lastUpdated={lastUpdated} version={version}>
      <div className="legal-action-box">
        <div>
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Manage Your Consent</h2>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            Review or update your opt-in choices for analytics and marketing cookies at any time.
          </p>
        </div>
        <button
          type="button"
          onClick={openCookiePreferences}
          className="legal-btn-primary"
        >
          Change Cookie Preferences
        </button>
      </div>

      {sections.map((section) => (
        <section key={section.id} id={section.id} className="legal-section">
          <h2>{section.title}</h2>
          {section.content.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </section>
      ))}

      <section className="legal-section">
        <h2>Cookies and Storage Inventory</h2>
        <div className="legal-table-wrapper">
          <table className="legal-table">
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
              {cookies.map((c) => (
                <tr key={c.name}>
                  <td><code>{c.name}</code></td>
                  <td>{c.category}</td>
                  <td>{c.purpose}</td>
                  <td>{c.provider}</td>
                  <td>{c.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </LegalLayout>
  );
}

export default CookiePolicyPage;
