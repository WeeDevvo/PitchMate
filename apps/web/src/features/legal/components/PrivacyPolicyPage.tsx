import { LegalLayout } from './LegalLayout';
import { privacyPolicyContent } from '../content/privacyPolicyContent';

export function PrivacyPolicyPage() {
  return (
    <LegalLayout
      title={privacyPolicyContent.title}
      lastUpdated={privacyPolicyContent.lastUpdated}
      version={privacyPolicyContent.version}
    >
      <aside className="legal-summary-box" aria-label="Data controller details">
        <p className="legal-summary-box__title">Data Controller: {privacyPolicyContent.controller.name}</p>
        <p className="legal-summary-box__text">
          {privacyPolicyContent.controller.address} &middot;{' '}
          <a className="legal-link" href={`mailto:${privacyPolicyContent.contactEmail}`}>
            {privacyPolicyContent.contactEmail}
          </a>
        </p>
      </aside>

      {privacyPolicyContent.sections.map((section) => (
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
    </LegalLayout>
  );
}

export default PrivacyPolicyPage;
