/**
 * Legal content data for PitchMate's Terms of Service (`/terms`).
 */

import type { LegalSection } from './privacyPolicyContent';

export interface TermsOfServiceData {
  title: string;
  lastUpdated: string;
  effectiveDate: string;
  version: string;
  sections: LegalSection[];
}

export const termsOfServiceContent: TermsOfServiceData = {
  title: 'Terms of Service',
  lastUpdated: '12 November 2026',
  effectiveDate: '12 November 2026',
  version: '1.1.0',
  sections: [
    {
      id: 'acceptance',
      title: '1. Acceptance of Terms',
      content: [
        'By accessing or using PitchMate (pitch-mate.co.uk), you agree to be bound by these Terms of Service and our Privacy Policy and Cookie Policy.',
        'You must be at least 13 years old (or the minimum age required to consent to data processing in your jurisdiction) to create an account. If you are under 18, please confirm you have permission from a parent or legal guardian where required.',
      ],
    },
    {
      id: 'accounts',
      title: '2. Account Registration and Security',
      content: [
        'You agree to provide accurate account information and verify your email address (or authenticate via Google Sign-In) when registering.',
        'You are responsible for safeguarding your login credentials and notifying us at support@pitch-mate.co.uk if you suspect unauthorised access to your account.',
      ],
    },
    {
      id: 'acceptable-use',
      title: '3. Acceptable Use & Community Conduct',
      content: [
        'PitchMate is designed exclusively for organising recreational five-a-side and amateur football matches and squads.',
        'You must not use abusive, offensive, defamatory, or discriminatory language in display names, guest names, squad names, or match locations, nor attempt to scrape, disrupt, or bypass PitchMate access controls.',
      ],
    },
    {
      id: 'squad-organisers',
      title: '4. Squad Organisers and Ownership',
      content: [
        'Squad Owners and Admins manage membership invitations, fixture scheduling, live match tracking, and team selection within private invite-only squads.',
        'Lawful Basis for Guest Players: Before creating a Guest Player profile or issuing a Guest Claim link, the organiser must acknowledge that they have an appropriate lawful basis to record that person’s name for match organisation and invite them to claim or delete the record.',
        'Ownership Transfer Requirement: If you are the sole Owner of one or more active squads, you must transfer ownership to another member or delete those squads before initiating personal account deletion.',
        'Soft Deletion & Export: Deleting a squad initiates a 30-day recovery grace period during which the Owner may restore the squad or export squad records. After 30 days, squad data is permanently purged automatically.',
      ],
    },
    {
      id: 'features-and-ratings',
      title: '5. Availability, Live Match Tracking & Ratings',
      content: [
        'PitchMate provides player availability polling, automated OpenSkill rating calculations, live match event logging (goals, own goals, goalkeeper stints), and leaderboards strictly for friendly recreational coordination.',
        'PitchMate does not process financial transactions, pitch booking fees, or match payments between players or venues.',
      ],
    },
    {
      id: 'termination',
      title: '6. Account Erasure and Termination',
      content: [
        'You may delete your account at any time in Account & Privacy Settings once sole-owner squad obligations are resolved.',
        'We may suspend or terminate accounts that materially breach these Terms or pose security or safety risks to other players.',
      ],
    },
    {
      id: 'liability',
      title: '7. Disclaimers, Liability and Governing Law',
      content: [
        'PitchMate is provided on an "as is" and "as available" basis for recreational coordination. Nothing in these Terms excludes liability for death or personal injury caused by negligence, fraud, or any liability that cannot be excluded under the laws of England and Wales.',
        'These Terms are governed by the laws of England and Wales. For support or legal enquiries, contact support@pitch-mate.co.uk.',
      ],
    },
  ],
};
