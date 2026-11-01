/**
 * Authorised copy and structure for PitchMate's Privacy Policy.
 *
 * Compliant with UK General Data Protection Regulation (UK GDPR), the Data Protection Act 2018 (DPA 2018),
 * and the Privacy and Electronic Communications Regulations (PECR).
 */

export interface LegalSection {
  id: string;
  title: string;
  content: string[];
}

export interface PrivacyPolicyData {
  title: string;
  lastUpdated: string;
  effectiveDate: string;
  version: string;
  contactEmail: string;
  controller: {
    name: string;
    address: string;
    email: string;
  };
  sections: LegalSection[];
}

export const privacyPolicyContent: PrivacyPolicyData = {
  title: 'Privacy Policy',
  lastUpdated: '19 October 2026',
  effectiveDate: '19 October 2026',
  version: '1.0.0',
  contactEmail: 'privacy@pitchmate.app',
  controller: {
    name: 'PitchMate Ltd',
    address: 'London, United Kingdom',
    email: 'privacy@pitchmate.app',
  },
  sections: [
    {
      id: 'introduction',
      title: '1. Introduction and Data Controller',
      content: [
        'PitchMate Ltd ("PitchMate", "we", "us", or "our") is dedicated to protecting and respecting your personal privacy. We act as the Data Controller under the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018.',
        'This Privacy Policy describes how we collect, store, process, transfer, and delete your personal data when you use the PitchMate website, applications, and match-coordination services.',
        'If you have any questions about this policy or our data practices, please contact our Privacy Team at privacy@pitchmate.app.',
      ],
    },
    {
      id: 'information-we-collect',
      title: '2. Information We Collect',
      content: [
        'Account & Identity Information: Your display name, email address, password hash (if registering via credentials), external identity subject identifiers (such as Google OAuth profile keys), and profile avatar.',
        'Squad & Match Information: Squad memberships, roles (Owner, Organiser, Member), match RSVPs, availability selections, and team attendance records.',
        'Athletic & Match Performance: Historical match appearances, team affiliations, match outcomes (wins, draws, losses), and calculated performance metrics necessary for creating balanced sides.',
        'Technical & Device Data: Internet Protocol (IP) address, operating system, browser type, device identifiers, session tokens, and access timestamps collected to guarantee service security and prevent fraudulent access.',
      ],
    },
    {
      id: 'lawful-basis',
      title: '3. Lawful Bases for Processing',
      content: [
        'Performance of a Contract (Article 6(1)(b) UK GDPR): We process your account details, squad rosters, and availability to fulfill our core service of organising matches, forming fair teams, and tracking your season records.',
        'Legitimate Interests (Article 6(1)(f) UK GDPR): We process technical logs and aggregated match metrics to safeguard against abuse, maintain platform stability, ensure referential integrity of squad histories, and enhance team-balancing balance.',
        'Consent (Article 6(1)(a) UK GDPR): Where required by PECR, we request your explicit, opt-in consent before setting non-essential performance, analytics, or marketing cookies. You may revoke this consent at any time via Cookie Preferences.',
      ],
    },
    {
      id: 'child-privacy',
      title: '4. Children & Age Assurance (Under 18s)',
      content: [
        'PitchMate is designed for community football participants aged 13 and older. We adhere to the UK Age Appropriate Design Code (Children’s Code).',
        'High-Privacy Defaults: For users identified as minors (aged 13–17), default profile settings are configured to high privacy, restricting profile visibility to registered squad members only and disabling non-essential marketing processing.',
        'We do not knowingly collect personal data from children under 13 without verified parental or legal guardian consent. If we become aware that an under-13 user has registered without verified authorization, we will immediately erase the account.',
      ],
    },
    {
      id: 'retention-and-anonymisation',
      title: '5. Retention and Permanent Anonymisation',
      content: [
        'Data Minimisation: Ephemeral verification tokens, password reset links, and inactive refresh tokens are automatically purged after 48 hours.',
        'Active Account Data: Retained as long as your account remains active and open.',
        'Self-Service Account Erasure: When you delete your account, your personal identifying information (name, email address, external sign-in links) is immediately and permanently anonymised.',
        'Preservation of Squad History: To safeguard the integrity of league standings and squad match histories for your fellow players, your previous match appearances and team rosters are retained under the de-identified pseudonym "Former player".',
        'Squad Deletion Grace Period: Squads marked for removal enter a 30-day soft-delete grace period before permanent purge, allowing squad owners to reverse accidental deletions.',
      ],
    },
    {
      id: 'your-rights',
      title: '6. Your Rights under UK GDPR',
      content: [
        'Right of Access (Article 15): You have the right to request a complete copy of the personal data we hold about you.',
        'Right to Rectification (Article 16): You may update inaccurate personal details at any time in your Account Settings.',
        'Right to Erasure ("Right to be Forgotten", Article 17): You have the right to delete your account and erase personal data through our self-service deletion feature.',
        'Right to Data Portability (Article 20): You can download a comprehensive, machine-readable JSON archive of your personal profile, squads, matches, and stats using the "Download My Data" button.',
        'Right to Restrict or Object (Articles 18 & 21): You can object to processing based on legitimate interests or request temporary restriction of your data.',
        'Right to Withdraw Consent: Where processing relies on consent (e.g. non-essential cookies), you may withdraw it at any time.',
      ],
    },
    {
      id: 'subprocessors',
      title: '7. Third-Party Subprocessors and Transfers',
      content: [
        'We use trusted service providers to support our platform operations:',
        'Cloud Hosting & Database: PostgreSQL database infrastructure hosted in secure UK/EU datacentres with encryption in transit and at rest.',
        'Authentication Providers: Google OAuth for identity assertion (only when chosen by you).',
        'Error Monitoring: Application performance and error diagnostics with IP anonymisation enabled.',
        'All transfers outside the UK are protected by approved International Data Transfer Agreements (IDTA) or UK adequacy regulations.',
      ],
    },
    {
      id: 'complaints',
      title: '8. How to Complain',
      content: [
        'If you have any concerns regarding how we handle your personal data, we ask that you contact us first at privacy@pitchmate.app so we can resolve the issue.',
        'You also have the right to lodge a complaint with the UK supervisory authority: Information Commissioner’s Office (ICO), Wycliffe House, Water Lane, Wilmslow, Cheshire, SK9 5AF, Tel: 0303 123 1113, Website: https://ico.org.uk.',
      ],
    },
  ],
};
