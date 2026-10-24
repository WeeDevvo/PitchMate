---
paths:
  - "apps/web/**"
  - "apps/mobile/**"
  - "apps/watch/**"
---

# Brand

The source of truth is the **PitchMate design system** (a Design System artifact on claude.ai: tokens, components, screen mockups for web, mobile and watch, and a README of rules). Its token export is committed at `apps/web/src/design/tokens.json`. When the design system changes, replace that file, run `npm run tokens --workspace @pitchmate/web`, and update this summary if a rule changed.

**Dark mode is the primary design target.** Design dark first, then verify light. Every token has both values.

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
| Draw / Provisional | `#E0A82E` | |
| Info | `#4C8DD6` | gathering states, syncing, tips |
| Bibs | `#FF6B00` dark / `#E8600A` light | hi-vis orange, always with the bib icon and the word BIBS |

Each meaning has `-text` (text on surfaces) and `-subtle` (tinted ground) variants; use those rather than the fill for text.

## Type

- **Barlow Condensed** (600/700/800, 800 italic): headlines, team names, scores, clocks, stat values, state chips, BIBS. Display sizes are UPPERCASE.
- **Barlow** (400–700): everything you read. Body copy never below 14px; 12px caption is for timestamps and chart axes only.
- Numbers use tabular figures (`.pm-num`) and thousands separators ("1,240").

## Rules that hold everywhere

- **Never rely on colour alone.** Win/loss/draw show W/L/D plus ✓ / ✗ / –. Provisional shows the "~" band or "~ Provisional" label (it shares amber with draw). Teams show their names. Sync states show a word and an icon.
- Text meets WCAG 2.1 AA (4.5:1) in both themes; focus rings, control borders and icons meet 3:1. Focus is a solid 2px ring at 2px offset.
- Voice: friendly and a bit cheeky, sentence case, verbs on buttons. No cheek in errors, deletions or privacy copy, and no emoji in UI chrome.

## In the web app

- `src/index.css` loads `src/design/fonts.css` and `src/design/tokens.css` globally. Tokens are CSS custom properties prefixed `--pm-` (`--pm-surface`, `--pm-accent-text`, `--pm-type-headline`, `--pm-space-4`, `--pm-radius-lg`) on `:root, [data-theme='dark']` and `[data-theme='light']`, the attribute the pre-paint bootstrap in `src/theme/themeBootstrap.ts` sets.
- `tokens.css` is generated and drift-tested (`tokens.drift.test.ts`); `tokens.contrast.test.ts` checks every documented pairing in both themes. Don't hand-edit it, and don't use raw hex in components.
- Components come from `src/ui` (Button, IconButton, TextField, Select, Toggle, Chip, the badges, MatchStateChip, ResultBadge, Rating, BibFlag, Avatar, Tabs, SegmentedControl, Dialog, Toast, Banner, EmptyState/ErrorState/NotFoundState, Skeleton, Card, Icon, Logo, TopBar, Sidebar/NavItem, NotificationList/NotificationItem, SquadCard/SquadCrest, PlayerRow, MatchCard, DayPicker, FairnessMeter, TeamColumn, Scoreboard). Use them rather than restyling native elements.
- **Migration in progress.** Moved: the app shell, squads, matches. Still on their own token tables: landing, auth, player stats. Inside the shell, player stats reads the unprefixed names (`--text`, `--control-border`...) that `features/app-shell/styles/legacyTokens.css` aliases to `--pm-*` tokens; delete each alias once nothing reads it. As each feature moves across, its table and contrast test go. New UI uses `--pm-*` tokens only.
- Logos are in `src/design/logos/`: the mark in green (dark grounds), ink (light grounds and on Pitch Green) or white (photos only); the app icon only for app-icon contexts. Never recolour or outline the mark.
