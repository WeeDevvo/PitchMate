import { LegalLayout } from './LegalLayout';
import { termsOfServiceContent } from '../content/termsOfServiceContent';

export function TermsOfServicePage() {
  const { title, lastUpdated, version, sections } = termsOfServiceContent;

  return (
    <LegalLayout title={title} lastUpdated={lastUpdated} version={version}>
      {sections.map((section) => (
        <section key={section.id} id={section.id} className="legal-section">
          <h2>{section.title}</h2>
          {section.content.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </section>
      ))}
    </LegalLayout>
  );
}

export default TermsOfServicePage;
