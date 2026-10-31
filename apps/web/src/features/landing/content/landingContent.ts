/**
 * Typed content model for the marketing landing page.
 *
 * This module is the single source of truth for the page's authored copy: the
 * hero value proposition, benefit cards, how-it-works steps, the stats pitch,
 * call-to-action labels/targets, the footer, and the example squad the page's
 * illustrations show. It holds plain typed data only — no React, no side
 * effects — so the presentational components stay thin and the copy can be
 * validated at build/test time (non-technical vocabulary, benefit completeness,
 * length bounds).
 *
 * The layout and voice follow the design system's "Landing page" screen
 * (ScreenWebLanding). Its copy is adapted where it would overclaim: PitchMate
 * helps the organiser pick the day rather than picking it, apps beyond the web
 * aren't out yet, and the page avoids the word "rating" (see
 * `content-validation.ts`).
 *
 * Requirements: 1.1, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 3.1, 3.5, 8.1
 */
import type { IconName } from '../../../ui'

/**
 * A call-to-action control: its visual role, visible label, and navigation
 * target. `primary`, `secondary` and `ghost` are the design system's buttons;
 * `ink` is its call to action on a green band.
 */
export interface CtaModel {
  kind: 'primary' | 'secondary' | 'ghost' | 'ink';
  label: string;
  href: string;
  /** A trailing icon, such as the hero's arrow. */
  icon?: IconName;
}

/** A link to a section of this page (a `#fragment`), handled by the browser. */
export interface SectionLinkModel {
  label: string;
  href: `#${string}`;
}

/** One benefit card: an icon, a visible heading and a supporting description. */
export interface BenefitModel {
  id: string;
  icon: IconName;
  heading: string;
  description: string;
}

/** One numbered how-it-works step. */
export interface StepModel {
  heading: string;
  description: string;
}

/** A player in the example team sheet. */
export interface DemoPlayer {
  name: string;
  guest?: boolean;
  /** The player's number as the squad sees it, e.g. "1,240". */
  score: string;
}

/** A team in the example team sheet. */
export interface DemoTeam {
  name: string;
  bibs?: boolean;
  average: string;
  players: DemoPlayer[];
}

/** A place in the example leaderboard. */
export interface DemoStanding {
  rank: number;
  name: string;
  guest?: boolean;
  me?: boolean;
  value: string;
  record: string;
}

/** An example stat tile. */
export interface DemoStat {
  label: string;
  value: string;
  sub?: string;
  icon: IconName;
  tone?: 'bib';
}

/** The full authored content model rendered by the landing page. */
export interface LandingContent {
  header: {
    sections: SectionLinkModel[];
    primary: CtaModel;
    secondary: CtaModel;
  };
  hero: {
    overline: string;
    /** The single value proposition, rendered as the page's one `<h1>`. */
    headline: string;
    /** The end of the headline, set on its own green line. */
    headlineAccent: string;
    /** Supporting line: 1–2 sentences, at most 160 characters. */
    subheadline: string;
    primaryCta: CtaModel;
    secondaryLink: SectionLinkModel;
    footnote: string;
    /** The rolled match the hero's fairness card shows. */
    example: { when: string; state: string; teamA: string; teamB: string; winA: number; draw: number; winB: number };
  };
  /** 3–8 benefits; the first three cover fair teams, organising, and stats. */
  benefits: BenefitModel[];
  howItWorks: {
    id: string;
    heading: string;
    steps: StepModel[];
    exampleCaption: string;
    teams: [DemoTeam, DemoTeam];
  };
  stats: {
    id: string;
    heading: string;
    /** The heading's second line. */
    headingAccent: string;
    description: string;
    exampleCaption: string;
    leaderboardTitle: string;
    standings: DemoStanding[];
    tiles: DemoStat[];
  };
  closing: {
    heading: string;
    cta: CtaModel;
  };
  footer: {
    brandName: string;
    links: { label: string; href: string }[];
  };
}

/** Sign-up entry point — begins account creation. Requirement 3.1. */
const startSquad = (label: string, kind: CtaModel['kind'] = 'primary', icon?: IconName): CtaModel => ({
  kind,
  label,
  href: '/signup',
  ...(icon && { icon }),
});

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
  header: {
    sections: [
      { label: 'How it works', href: '#how-it-works' },
      { label: 'Fair teams', href: '#fair-teams' },
      { label: 'Stats', href: '#stats' },
    ],
    primary: startSquad('Start a squad'),
    secondary: { kind: 'ghost', label: 'Log in', href: '/login' },
  },
  hero: {
    overline: 'For weekly 5-a-side with your mates',
    headline: 'Fair teams. Every week.',
    headlineAccent: 'Every week.',
    subheadline:
      'PitchMate finds the day that suits most, balances the teams close to 50/50 and keeps score, so the group chat can go back to banter.',
    primaryCta: startSquad("Start a squad — it's free", 'primary', 'arrowRight'),
    secondaryLink: { label: 'See how it works', href: '#how-it-works' },
    footnote: 'From 5v5 to 8v8, uneven sides included',
    example: {
      when: 'Sunday 9 Nov · 10:00',
      state: 'Rolled',
      teamA: 'Galácticos (ish)',
      teamB: 'Sunday League Legends',
      winA: 0.47,
      draw: 0.07,
      winB: 0.46,
    },
  },
  benefits: [
    {
      id: 'fair-teams',
      icon: 'shuffle',
      heading: 'Fair teams',
      description:
        "PitchMate learns who's handy, balances the sides and shows the odds. Tweak, re-roll, then lock it in.",
    },
    {
      id: 'easy-organising',
      icon: 'calendar',
      heading: 'Easy organising',
      description:
        'Suggest a few days and everyone taps the ones they can make. You pick the winner. No more 40-message threads.',
    },
    {
      id: 'results-and-stats',
      icon: 'trophy',
      heading: 'Results and bragging rights',
      description:
        'Log the score in seconds and every result is saved. The leaderboard updates and does the talking.',
    },
  ],
  howItWorks: {
    id: 'how-it-works',
    heading: 'How it works',
    steps: [
      {
        heading: 'Start a squad',
        description: 'Invite your mates with a link. Add guests for the mate who turns up once a month.',
      },
      {
        heading: 'Pick a day',
        description: "Draft a match with a pitch and a few dates. See who's in at a glance.",
      },
      {
        heading: 'Roll the teams',
        description: "Watch the fairness meter land near 50/50. Name the teams, pick who's in bibs, lock it.",
      },
      {
        heading: 'Play, then brag',
        description: 'Record the result. Streaks, the leaderboard and the all-important bib count update.',
      },
    ],
    exampleCaption: 'An example team sheet: two teams of four, one in bibs.',
    teams: [
      {
        name: 'Galácticos (ish)',
        bibs: true,
        average: '1,222',
        players: [
          { name: 'Conor Doyle', score: '1,240' },
          { name: 'Aisha Bello', score: '1,262' },
          { name: 'Leo Martins', score: '1,205' },
          { name: 'Big Mike', guest: true, score: '1,180' },
        ],
      },
      {
        name: 'Sunday League Legends',
        average: '1,215',
        players: [
          { name: 'Jamie Okafor', score: '1,312' },
          { name: 'Tom Ellery', score: '1,201' },
          { name: 'Sam Reid', score: '1,190' },
          { name: 'Dan Whitfield', score: '1,156' },
        ],
      },
    ],
  },
  stats: {
    id: 'stats',
    heading: "Stats you'll",
    headingAccent: 'actually argue about',
    description:
      "Win rate, streaks, who you play best with, your bogey opponent — and how many times you've been stuck in a bib.",
    exampleCaption: 'An example squad leaderboard and three player stats.',
    leaderboardTitle: 'Thursday Ballers · Season',
    standings: [
      { rank: 1, name: 'Jamie Okafor', value: '1,312', record: '17W · 5D · 9L' },
      { rank: 2, name: 'Aisha Bello', value: '1,262', record: '10W · 3D · 5L' },
      { rank: 3, name: 'Conor Doyle', me: true, value: '1,240', record: '12W · 4D · 7L' },
      { rank: 4, name: 'Big Mike', guest: true, value: '1,180', record: '6W · 2D · 6L' },
    ],
    tiles: [
      { label: 'Win streak', value: '4', icon: 'flame' },
      { label: 'Best mate', value: 'Aisha', sub: '72% together', icon: 'users' },
      { label: 'Bibs', value: '9', sub: 'Fashion icon', icon: 'bib', tone: 'bib' },
    ],
  },
  closing: {
    heading: 'Sort Sunday out.',
    cta: startSquad('Start a squad — free', 'ink', 'arrowRight'),
  },
  footer: {
    brandName: 'PitchMate',
    links: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
    ],
  },
};
