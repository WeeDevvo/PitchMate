/**
 * Authorised copy and structure for PitchMate's Terms of Service.
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
  lastUpdated: '19 October 2026',
  effectiveDate: '19 October 2026',
  version: '1.0.0',
  sections: [
    {
      id: 'acceptance',
      title: '1. Acceptance of Terms',
      content: [
        'By creating an account, accessing, or using PitchMate ("the Service"), you agree to be bound by these Terms of Service and our Privacy Policy. If you do not agree to these terms, you must not access or use the Service.',
        'These Terms constitute a legally binding agreement between you and PitchMate Ltd ("PitchMate", "we", "us").',
      ],
    },
    {
      id: 'eligibility',
      title: '2. Eligibility and Account Security',
      content: [
        'You must be at least 13 years of age to register for PitchMate. If you are under 18, you confirm that you have your parent or legal guardian’s permission.',
        'You are responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your account.',
        'You must provide accurate, current, and complete information and promptly update your details when changes occur.',
      ],
    },
    {
      id: 'acceptable-use',
      title: '3. Acceptable Use and Community Conduct',
      content: [
        'PitchMate is designed to foster friendly, fair, and inclusive grassroots football. You agree not to:',
        'Use the Service for any unlawful, discriminatory, or harassing purpose.',
        'Impersonate any other player or post fraudulent availability or match results.',
        'Attempt to circumvent or disable any security features, authentication tokens, or rate-limiting safeguards.',
        'Interfere with or disrupt the integrity or performance of the servers or data networks.',
      ],
    },
    {
      id: 'squad-responsibilities',
      title: '4. Squad Organisers and Ownership',
      content: [
        'Squad Owners hold administrative responsibility for their squad rosters, invitations, and match schedules.',
        'Single-Owner Invariant: Every active squad must maintain an designated Owner. If an Owner wishes to delete their account or leave the squad, they must transfer squad ownership to another active member or archive/delete the squad.',
        'Match Coordination & Venues: PitchMate provides software tools for team organisation and balancing. We do not own, manage, or inspect physical football pitches or facilities.',
      ],
    },
    {
      id: 'limitation-of-liability',
      title: '5. Health, Safety, and Limitation of Liability',
      content: [
        'Physical Activity Warning: Football is a contact sport with inherent risk of physical injury. You participate in matches organised through PitchMate entirely at your own risk.',
        'PitchMate accepts no liability for personal injury, property loss, accidents, or disputes arising at or during matches organised via the platform.',
        'To the fullest extent permitted by English law, PitchMate shall not be liable for any indirect, incidental, special, or consequential damages.',
      ],
    },
    {
      id: 'termination',
      title: '6. Termination and Erasure',
      content: [
        'You may terminate your account at any time via Account Settings.',
        'Upon account termination, your personal identifying information is immediately anonymised in accordance with our Privacy Policy.',
        'PitchMate reserves the right to suspend or terminate accounts that breach these Terms or engage in abusive or harmful conduct.',
      ],
    },
    {
      id: 'governing-law',
      title: '7. Governing Law and Jurisdiction',
      content: [
        'These Terms and any dispute or claim arising out of or in connection with them shall be governed by and construed in accordance with the laws of England and Wales.',
        'The courts of England and Wales shall have exclusive jurisdiction to settle any dispute or claim.',
      ],
    },
  ],
};
