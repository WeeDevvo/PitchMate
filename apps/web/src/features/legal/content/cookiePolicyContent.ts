/**
 * Authorised copy and structure for PitchMate's Cookie Policy.
 *
 * Compliant with the Privacy and Electronic Communications Regulations (PECR) and UK GDPR.
 */

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
  lastUpdated: '19 October 2026',
  effectiveDate: '19 October 2026',
  version: '1.0.0',
  sections: [
    {
      id: 'what-are-cookies',
      title: '1. What Are Cookies and Local Storage?',
      content: [
        'Cookies and browser storage mechanisms (such as localStorage and sessionStorage) are small data files placed on your computer or mobile device when you visit our website.',
        'They are widely used to make websites work efficiently, keep you signed in securely, remember your display preferences, and provide anonymous reporting data.',
      ],
    },
    {
      id: 'categories',
      title: '2. Cookie Categories We Use',
      content: [
        'Strictly Necessary Cookies: Essential for the core operation of PitchMate. These enable secure user authentication, prevent session hijacking and cross-site forgery, and preserve your theme preferences. They cannot be turned off in our systems.',
        'Performance & Analytics Cookies (Opt-In): Help us understand how visitors interact with our application by reporting anonymous telemetry and diagnosing errors. These are only activated if you provide affirmative opt-in consent.',
        'Marketing & Announcement Cookies (Opt-In): Used to measure the effectiveness of outreach and product update announcements. These are only activated if you provide affirmative opt-in consent.',
      ],
    },
    {
      id: 'managing-cookies',
      title: '3. How to Manage Your Cookie Preferences',
      content: [
        'Under UK PECR regulations, no non-essential cookie is set on your device without your explicit consent.',
        'You can change or withdraw your consent at any time by selecting "Cookie Preferences" at the bottom of our pages or in your Account Settings.',
        'Most web browsers also allow you to control cookies through their browser settings. However, disabling essential cookies will prevent you from signing in to PitchMate.',
      ],
    },
  ],
  cookies: [
    {
      name: 'pitchmate_session',
      category: 'Strictly Necessary',
      purpose: 'Stores authentication tokens to maintain your secure signed-in session.',
      provider: 'PitchMate',
      duration: 'Session / 7 days rotating',
    },
    {
      name: 'pitchmate_cookie_consent_v1',
      category: 'Strictly Necessary',
      purpose: 'Remembers your cookie consent choices so you are not prompted on every visit.',
      provider: 'PitchMate',
      duration: '12 months',
    },
    {
      name: 'pitchmate-theme',
      category: 'Strictly Necessary',
      purpose: 'Preserves your selected light or dark mode theme preference.',
      provider: 'PitchMate',
      duration: 'Persistent',
    },
    {
      name: '_pk_analytics',
      category: 'Performance & Analytics',
      purpose: 'Gathers anonymous usage statistics and page response times to improve performance.',
      provider: 'PitchMate',
      duration: '30 days',
    },
  ],
};
