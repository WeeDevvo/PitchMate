import { LegalLayout } from './LegalLayout';
import { termsOfServiceContent } from '../content/termsOfServiceContent';

export function TermsOfServicePage() {
  return (
    <LegalLayout
      title={termsOfServiceContent.title}
      lastUpdated={termsOfServiceContent.lastUpdated}
      version={termsOfServiceContent.version}
    >
      {termsOfServiceContent.sections.map((section) => (
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

export default TermsOfServicePage;
