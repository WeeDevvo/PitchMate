/**
 * Legal content data for PitchMate's Privacy Policy (`/privacy`).
 *
 * Drafted in alignment with UK GDPR, the Data Protection Act 2018, and PitchMate's
 * implemented data flows (accounts, squads, guest claims, matches, live event
 * tracking, ratings, notifications, and automated retention cleanup).
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
  lastUpdated: '12 November 2026',
  effectiveDate: '12 November 2026',
  version: '1.1.0',
  contactEmail: 'privacy@pitch-mate.co.uk',
  controller: {
    name: 'PitchMate',
    address: 'United Kingdom (contact via email for postal correspondence)',
    email: 'privacy@pitch-mate.co.uk',
  },
  sections: [
    {
      id: 'introduction',
      title: '1. Introduction and Data Controller',
      content: [
        'PitchMate ("we", "us", "our", available at pitch-mate.co.uk) is committed to protecting and respecting your privacy in compliance with the UK General Data Protection Regulation (UK GDPR), the Data Protection Act 2018, and the Privacy and Electronic Communications Regulations (PECR).',
        'For the purposes of data protection law, PitchMate is the Data Controller responsible for your personal data processed through the PitchMate web application and APIs.',
        'If you have any questions about this policy or our data practices, please contact our Privacy Team at privacy@pitch-mate.co.uk.',
      ],
    },
    {
      id: 'data-we-collect',
      title: '2. Personal Data We Collect',
      content: [
        'Account & Authentication Data: Email address, display name, verification status, cryptographic password hash (never stored in plaintext), optional Google sign-in subject link, optional avatar reference, and short-lived authentication/verification tokens.',
        'Squad, Membership & Guest Claim Data: Squad memberships, member display names, roles (Owner, Admin, Player), skill tier, OpenSkill team-balancing ratings (mu and sigma), guest player indicators, squad organiser lawful-basis acknowledgements, and single-use guest claim links.',
        'Match, Availability, Live Event & Statistics Data: Match fixtures (kick-off times, locations, statuses), weekly player availability responses, kickoff lineups, live-tracked match events (goals scored, own goals, goalkeeper stints, clean sheets), derived player leaderboards, and rating progression snapshots.',
        'Notifications & Preferences: In-app squad notifications (event type, read status, timestamps), transactional account emails, and your cookie and theme preferences.',
        'Operational Logs: Essential HTTP request metadata (IP address, request timestamps, and diagnostic errors) required for platform security, rate limiting, and reliability. PitchMate does not process payment card details or run commercial ad-tech profiling.',
      ],
    },
    {
      id: 'lawful-bases',
      title: '3. Lawful Bases for Processing',
      content: [
        'Performance of a Contract (Article 6(1)(b) UK GDPR): Creating and authenticating your account, administering squad memberships, collecting availability, balancing teams, recording match events and statistics, and delivering in-app and account emails.',
        'Legitimate Interests (Article 6(1)(f) UK GDPR): Platform security, rate-limiting, fraud prevention, maintaining historical match integrity when anonymising departing accounts, and allowing squad organisers to manage named guest placeholders after confirming a lawful basis before issuing a claim link.',
        'Consent (Article 6(1)(a) UK GDPR & PECR): Optional analytics or announcement preferences configured via our Cookie Preferences controls (unchecked by default).',
      ],
    },
    {
      id: 'data-sharing',
      title: '4. Data Sharing and Subprocessors',
      content: [
        'Squad Visibility: PitchMate squads are private and invite-only. Your display name, squad role, skill ratings, availability, and match participation statistics are visible to fellow members of squads you belong to.',
        'Core Service Providers: We host application services and encrypted PostgreSQL databases on Microsoft Azure, and send transactional authentication emails (verification and password reset) via Azure Communication Services or SendGrid.',
        'Optional Identity Provider: If you choose "Continue with Google", Google Identity Services verifies your identity token strictly for authentication.',
        'No Commercial Sale: We do not sell, rent, or trade your personal data to third-party advertisers or data brokers.',
      ],
    },
    {
      id: 'retention',
      title: '5. Data Retention and Automated Purges',
      content: [
        'Account Data: Retained while your account remains active until you trigger self-service erasure.',
        'Ephemeral Security Tokens: Expired email verification, password reset, and refresh tokens are automatically purged in background maintenance once 48 hours past expiry.',
        'Soft-Deleted Squads: When an Owner deletes a squad, it enters a 30-day recovery grace period during which the Owner may restore it or export squad data. Automated background cleanup permanently purges the squad and its records once 30 days have elapsed.',
        'Post-Erasure Match Integrity: When you delete your account, memberships without match history are deleted cleanly. If your membership is referenced by recorded match participation, ratings, or live match events, your profile reference is unlinked and your membership display name is anonymised rather than fabricating match history; any pending guest claims linked to your account are cancelled and scrubbed, and your in-app notifications are removed.',
      ],
    },
    {
      id: 'your-rights',
      title: '6. Your Rights under UK GDPR',
      content: [
        'Right of Access & Data Portability (Articles 15 & 20): You can download a complete machine-readable JSON archive of your account, memberships, availability, match participation, live-tracked statistics, rating history, notifications, and guest claims directly in Account & Privacy Settings.',
        'Right to Erasure (Article 17): You can permanently delete your account from Account & Privacy Settings. If you are the sole Owner of an active squad, you must first transfer ownership or delete that squad before deleting your account.',
        'Right to Rectification, Restriction & Objection (Articles 16, 18, 21): You may update profile details in the app or request corrections or processing restrictions by emailing privacy@pitch-mate.co.uk.',
        'Right to Withdraw Consent (Article 7(3)): You can change or withdraw optional cookie preferences at any time without affecting essential functionality.',
      ],
    },
    {
      id: 'privacy-by-default',
      title: '7. Minimum Age & Privacy by Default',
      content: [
        'PitchMate is intended for individuals aged 13 or older (or the applicable digital age of consent in your jurisdiction). We do not knowingly permit children under 13 to register accounts; if you believe an underage account exists, please contact privacy@pitch-mate.co.uk so we can remove it.',
        'Rather than profiling age groups, PitchMate enforces universal privacy-by-default safeguards for every account: all squads are private and invite-only with no public directory, and optional analytics and marketing tracking remain disabled by default unless explicitly consented to.',
      ],
    },
    {
      id: 'complaints',
      title: '8. Supervisory Authority and Contact',
      content: [
        'If you have concerns regarding how we handle personal data, please contact us first at privacy@pitch-mate.co.uk so we can address them promptly.',
        'You also have the right to lodge a complaint with the UK Information Commissioner’s Office (ICO) via https://ico.org.uk or on 0303 123 1113.',
      ],
    },
  ],
};
