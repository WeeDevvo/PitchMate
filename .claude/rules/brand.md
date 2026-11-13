---
paths:
  - "apps/web/**"
  - "apps/mobile/**"
  - "apps/watch/**"
  - "packages/design-tokens/**"
---

# Brand

The source of truth for tokens is **`packages/design-tokens`** in this repository. Its DTCG source files (`tokens/*.tokens.json`) build into `dist/`: `tokens.css` for the web, `tokens.ts` for the React Native phone app, `PitchMateTokens.swift` for the watch, and `tokens.json`, the export the claude.ai design system reads. Change a token in `tokens/`, run `npm run tokens --workspace @pitchmate/web`, commit the rebuilt `dist/`, and update this summary if a rule changed. `dist/` is never hand-edited.

Two artifacts on claude.ai hold the designs. Neither is the source of truth for token values; both copy from the repo.

- **App mockups** (the build targets for phone, watch and the screens the master spec adds): https://claude.ai/artifact/DNgnBCgu5jS2RnFaMa2WP4. One artboard per screen at `project/<Name>.dc.html`; list them with `scope: "files"`.
- **The PitchMate design system** (components and the earlier web screens): https://claude.ai/artifact/5Av9GdUNy7LkZLQtFMdqJZ. A component's notes are at `project/components/<Name>/README.md`, a web screen at `project/components/ScreenWeb<Name>/preview.html`. Its `project/tokens.json` should match `packages/design-tokens/dist/tokens.json`; when they differ, the repo wins.

Before building or reworking a screen or component, read the matching mockup or component file (Artifact tool, `action: "read"` with `path`).

**Dark mode is the primary design target.** Design dark first, then verify light. Every token has both values. The watch is always dark.

## Palette

| Token | Hex | Use |
|---|---|---|
| Pitch Green | `#5BBF36` | Fills (primary buttons, selected chips, Team A) and dark-mode accents, always with Ink text on top |
| Green Dark | `#3E8F24` | Icons, focus rings and bold display text (19px+) on light grounds. **Not** body text: 4.07:1 on white |
| Accent text (light) | `#357A1F` | Green text on light grounds, a deepened Green Dark that passes AA |
| Green Light | `#8FD96F` | Delight only: "Dead even", first place, the dark focus ring |
| Ink | `#141414` | Dark background; text on light and on every green, amber or red fill |

Never put Pitch Green text on a light ground.

| Meaning | Fill | Notes |
|---|---|---|
| Win | `#5BBF36` | |
| Loss / danger | `#E5484D` | |
| Draw | `#E0A82E` | Also a score that is not final yet ("Provisional") |
| Info | `#4C8DD6` | gathering states, syncing, tips |
| Bibs | `#FF6B00` dark / `#E8600A` light | hi-vis orange, always with the bib icon and the word BIBS. Never a team colour |
| Settling | none | A rating that has not settled has no colour of its own (see below) |
| Pro | inverse chip | `pro-fill` / `on-pro`: the inverse surface with a star, so it never reads as a result or a state |

Each meaning has `-text` (text on surfaces) and `-subtle` (tinted ground) variants; use those rather than the fill for text. Team A is green and Team B is the white-kit neutral: told apart by lightness, never by bib orange.

## Type

- **Barlow Condensed** (600/700/800, 800 italic): headlines, team names, scores, clocks, stat values, state chips, BIBS. Display sizes are UPPERCASE.
- **Barlow** (400–700): everything you read. Body copy never below 14px; 12px caption is for timestamps and chart axes only.
- Numbers use tabular figures (`.pm-num`) and thousands separators ("1,240").

## Shape

- Buttons, chips and segmented controls are pills (`radius-pill`).
- Cards and team columns are `radius-lg` (16px); sheets and dialogs are `radius-xl` (24px); inputs and badges `radius-sm` (8px); menus and rows `radius-md` (12px).
- Spacing is the 4px scale (`space-*`). Where a stylesheet needs a value the scale lacks (6px, 10px, 14px), it stays a literal.

## Rules that hold everywhere

- **Never rely on colour alone.** Win/loss/draw show W/L/D plus ✓ / ✗ / –. Teams show their names. Sync states show a word and an icon. A locked Pro feature shows a lock and sits in a dashed list.
- **A settling rating looks like every other rating.** Every player shows a number. While it settles, the wave mark and the words ("Settling · 3 of 5 matches") sit beside the player's name, never on the number, and the chart draws those readings hollow on a dashed line. No amber, no "~", no underline.
- **Locked is not off.** A Pro feature the squad does not have is a `LockedFeature` row (dashed list, lock, a way to upgrade), shown to admins only. A feature an admin has switched off keeps its ordinary toggle.
- Text meets WCAG 2.1 AA (4.5:1) in both themes; focus rings, control borders and icons meet 3:1. Focus is a solid 2px ring at 2px offset.
- Looping motion (the live dot's pulse, the skeleton shimmer) runs only under `prefers-reduced-motion: no-preference`.
- Voice: friendly and a bit cheeky, sentence case, verbs on buttons. No cheek in errors, deletions or privacy copy, and no emoji in UI chrome.

## In the web app

- `src/index.css` loads `src/design/fonts.css` and `@pitchmate/design-tokens/dist/tokens.css` globally. Tokens are CSS custom properties prefixed `--pm-` (`--pm-surface`, `--pm-accent-text`, `--pm-type-headline`, `--pm-space-4`, `--pm-radius-lg`) on `:root, [data-theme='dark']` and `[data-theme='light']`, the attribute the pre-paint bootstrap in `src/theme/themeBootstrap.ts` sets.
- `src/design/tokens.drift.test.ts` fails while any file in the package's `dist/` differs from what the source renders; `tokens.contrast.test.ts` checks every documented pairing in both themes. Don't use raw hex in components.
- Components come from `src/ui` (Button, IconButton, TextField, Select, Checkbox, Toggle, Chip, OptionCard, ActionsMenu, the badges including SettlingMark and ProBadge, LockedFeature/LockedFeatureList, MatchStateChip, ResultBadge, Rating, BibFlag, Avatar, Tabs, SegmentedControl, TabNav, Steps, Dialog, Toast, Banner, EmptyState/ErrorState/NotFoundState, Skeleton, Card, Icon, Logo, StatTile, LeaderboardRow, RatingChart, TopBar, Sidebar/NavItem, NotificationList/NotificationItem, SquadCard/SquadCrest, PlayerRow, MatchCard, DayPicker, AvailabilityGrid, FairnessMeter, TeamColumn, Scoreboard, TeamSheet, EventTimeline). Use them rather than restyling native elements.
- Every feature (landing, auth, the app shell, squads, matches, player stats) reads `--pm-*` tokens and composes `src/ui`; no feature declares its own colour table. A feature stylesheet may declare layout custom properties of its own (spacing, measures), never colours. A link that reads as a button takes `buttonClasses()` from `src/ui`.
- Logos are in `src/design/logos/`: the mark in green (dark grounds), ink (light grounds and on Pitch Green) or white (photos only); the app icon only for app-icon contexts. Never recolour or outline the mark.
- **Today:** the server sends no number for a provisional rating, so the squads and player-stats screens still show the "~" band through their own rating components. `SettlingMark` and the chart's settling marks are ready in `src/ui` for when it does. Nothing is locked yet either: the server has no notion of a Pro squad.

## In the phone and watch apps

- Import the built values, never copy hex codes: `packages/design-tokens/dist/tokens.ts` (colours per theme, spacing, radii, sizes, type styles, springs, haptics) and `PitchMateTokens.swift`.
- Each app builds its own components with the same names as `src/ui`; tokens are shared, components are not.
- Haptics follow the tokens: a goal is `success`, an undo `warning`, a selection `selection`, a lock `impactMedium`.
- Icons are PitchMate's own set (`src/ui/icons.tsx`: a 24px grid, 2px round-capped strokes). The watch uses SF Symbols only for system glyphs.
