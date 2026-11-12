/**
 * Legal content data for PitchMate's Cookie Policy (`/cookies`).
 *
 * Discloses the exact first-party browser storage keys imported directly from
 * their owning modules alongside PECR opt-in controls.
 */

import { SESSION_STORAGE_KEY } from '../../auth';
import { APPEARANCE_STORAGE_KEY } from '../../../theme';
import { COOKIE_CONSENT_STORAGE_KEY } from '../lib/cookieConsent';
import type { LegalSection } from './privacyPolicyContent';

export interface CookieItem {
  name: string;
  category: 'Strictly Necessary' | 'Performance & Analytics' | 'Marketing';
  purpose: string;
  provider: string;
  duration: string;
}

export interface CookiePolicyData {
  title: string;
  lastUpdated: string;
  effectiveDate: string;
  version: string;
  sections: LegalSection[];
  cookies: CookieItem[];
}

export const cookiePolicyContent: CookiePolicyData = {
  title: 'Cookie Policy',
  lastUpdated: '12 November 2026',
  effectiveDate: '12 November 2026',
  version: '1.1.0',
  sections: [
    {
      id: 'what-are-cookies',
      title: '1. What Are Cookies & Browser Storage?',
      content: [
        'Cookies and similar browser storage technologies (such as browser localStorage) allow web applications like PitchMate (pitch-mate.co.uk) to keep you signed in and remember your essential interface choices.',
        'Under the Privacy and Electronic Communications Regulations (PECR) and UK GDPR, strictly necessary storage required to provide the service you requested is enabled by default, whereas any optional analytics or marketing storage requires your explicit prior consent.',
      ],
    },
    {
      id: 'how-we-use',
      title: '2. How PitchMate Uses Browser Storage',
      content: [
        'Essential Functionality Only by Default: On initial load, PitchMate writes only strictly necessary state in localStorage (when signed in, when choosing an appearance theme, or after recording your cookie decision). Post-authentication redirect paths are held transiently in memory during sign-in.',
        'No Active Advertising or Third-Party Trackers: PitchMate does not run third-party advertising trackers or non-essential analytics scripts by default. Performance & Analytics and Marketing consent categories remain disabled unless you explicitly opt in, and are reserved only for future first-party improvements covered by your saved consent preferences.',
        'Optional Google Sign-In: If you actively click "Continue with Google" to authenticate, Google Identity Services may process temporary session tokens solely to issue your sign-in assertion.',
      ],
    },
    {
      id: 'manage-preferences',
      title: '3. Managing Your Cookie Preferences',
      content: [
        'You can inspect, update, or withdraw consent for optional categories at any time using the "Change Cookie Preferences" button below or in Account & Privacy Settings.',
        'You can also clear or block site storage via your browser settings, though blocking strictly necessary storage will prevent persistent sign-in and theme selection.',
      ],
    },
    {
      id: 'contact',
      title: '4. Questions',
      content: [
        'If you have questions about how PitchMate uses browser storage or cookies, contact our Privacy Team at privacy@pitch-mate.co.uk.',
      ],
    },
  ],
  cookies: [
    {
      name: SESSION_STORAGE_KEY,
      category: 'Strictly Necessary',
      purpose:
        'Stores your authenticated PitchMate session tokens in localStorage so you remain signed in across page reloads.',
      provider: 'PitchMate (First-party)',
      duration: 'Until sign-out or session expiry',
    },
    {
      name: APPEARANCE_STORAGE_KEY,
      category: 'Strictly Necessary',
      purpose:
        'Stores your selected dark or light theme preference in localStorage so PitchMate renders in your chosen appearance before paint.',
      provider: 'PitchMate (First-party)',
      duration: 'Persistent until changed or cleared',
    },
    {
      name: COOKIE_CONSENT_STORAGE_KEY,
      category: 'Strictly Necessary',
      purpose:
        'Records your PECR / UK GDPR cookie consent decision, version, and UTC timestamp in localStorage.',
      provider: 'PitchMate (First-party)',
      duration: 'Persistent until reset or cleared',
    },
    {
      name: 'Google OAuth (if selected)',
      category: 'Strictly Necessary',
      purpose:
        'Initiated only when you choose "Continue with Google" to verify your identity with Google Identity Services.',
      provider: 'Google Identity Services',
      duration: 'Session-scoped to sign-in flow',
    },
  ],
};
