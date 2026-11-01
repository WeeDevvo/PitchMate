/**
 * Public barrel for the legal and privacy compliance feature.
 *
 * Exposes the public legal pages (/privacy, /terms, /cookies),
 * cookie consent banner, account privacy management screen, and consent utilities.
 */

export * from './lib/cookieConsent';
export * from './content/privacyPolicyContent';
export * from './content/termsOfServiceContent';
export * from './content/cookiePolicyContent';

export { PrivacyPolicyPage } from './components/PrivacyPolicyPage';
export { TermsOfServicePage } from './components/TermsOfServicePage';
export { CookiePolicyPage } from './components/CookiePolicyPage';
export { CookieBanner } from './components/CookieBanner';
export { AccountPrivacyScreen, type AccountPrivacyScreenProps } from './components/AccountPrivacyScreen';

export const PRIVACY_ROUTE = '/privacy';
export const TERMS_ROUTE = '/terms';
export const COOKIES_ROUTE = '/cookies';
export const LEGAL_ROUTES = [PRIVACY_ROUTE, TERMS_ROUTE, COOKIES_ROUTE] as const;
