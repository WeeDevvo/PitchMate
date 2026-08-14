/**
 * Typed content model for the marketing landing page.
 *
 * This module is the single source of truth for the page's authored copy: the
 * hero value proposition, benefit sections, call-to-action labels/targets, and
 * footer. It holds plain typed data only — no React, no side effects — so the
 * presentational components stay thin and the copy can be validated at
 * build/test time (non-technical vocabulary, benefit completeness, length
 * bounds).
 *
 * Requirements: 1.1, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 3.1, 3.5, 8.1
 */

/** A call-to-action control: its role, visible label, and navigation target. */
export interface CtaModel {
  kind: 'primary' | 'secondary';
  label: string;
  href: string;
}

/** One benefit section: a visible heading with a supporting description. */
export interface BenefitModel {
  id: string;
  heading: string;
  description: string;
}

/** The full authored content model rendered by the landing page. */
export interface LandingContent {
  hero: {
    /** The single value proposition, rendered as the page's one `<h1>`. */
    headline: string;
    /** Supporting line: 1–2 sentences, at most 160 characters. */
    subheadline: string;
    primaryCta: CtaModel;
  };
  headerCtas: { primary: CtaModel; secondary: CtaModel };
  /** 3–8 benefits; the first three cover fair teams, organising, and stats. */
  benefits: BenefitModel[];
  closingCta: CtaModel;
  footer: {
    brandName: string;
    links: { label: string; href: string }[];
  };
}

/** Sign Up entry point — begins account creation. Requirement 3.1. */
const signUpCta: CtaModel = { kind: 'primary', label: 'Sign Up', href: '/signup' };

/** Log In entry point — begins logging in. Requirement 3.1. */
const logInCta: CtaModel = { kind: 'secondary', label: 'Log In', href: '/login' };

/**
 * The authored landing-page content.
 *
 * All visible strings use plain, benefit-focused language and deliberately
 * avoid PitchMate's technical vocabulary (see `content-validation.ts`). The
 * subheadline stays within 160 characters, and the first three benefits cover
 * the required themes in order: fair teams (2.3), easy organising (2.4), and
 * recorded results / stats / leaderboards (2.5).
 */
export const landingContent: LandingContent = {
  hero: {
    headline: 'Fair teams for the football you play with friends',
    subheadline:
      'PitchMate helps friends organise casual football matches and builds balanced teams, so every game is a fair, close contest.',
    primaryCta: signUpCta,
  },
  headerCtas: {
    primary: signUpCta,
    secondary: logInCta,
  },
  benefits: [
    {
      id: 'fair-teams',
      heading: 'Fair teams, every time',
      description:
        'PitchMate builds balanced sides for every match, so games stay close and nobody argues about who plays where.',
    },
    {
      id: 'easy-organising',
      heading: 'Organising made easy',
      description:
        'Pick a day that works for everyone and see who is in at a glance, so getting a game together takes minutes, not endless group chats.',
    },
    {
      id: 'results-and-stats',
      heading: 'Results and stats that stick around',
      description:
        'Every result is saved, so your squad builds up player stats and leaderboards that show progress over the season.',
    },
    {
      id: 'made-for-kickabouts',
      heading: 'Made for weekly kickabouts',
      description:
        'From five-a-side to eight-a-side, PitchMate fits the casual games you already play with your friends each week.',
    },
  ],
  closingCta: signUpCta,
  footer: {
    brandName: 'PitchMate',
    links: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
    ],
  },
};
