# @pitchmate/design-tokens

PitchMate's design tokens: one source, built for every client.

```bash
npm run tokens --workspace @pitchmate/web     # or: npm run build --workspace @pitchmate/design-tokens
```

## Source: `tokens/`

[DTCG](https://www.designtokens.org/) JSON, in tiers.

| File | Holds |
|---|---|
| `primitive.tokens.json` | The raw palette: `color.ink.*`, `color.green.*`, `color.red.*`, `color.amber.*`, `color.blue.*`, `color.orange.*`. Nothing uses these directly. |
| `semantic.tokens.json` | What a colour or shadow means: `color.surface`, `color.accent-text`, `color.result-win`, `color.settling-text`, `color.pro-fill`. `$value` is the dark theme; the light value sits in `$extensions["pitchmate.modes"].light`. |
| `scale.tokens.json` | Spacing, radii, durations, easings, z-index and font families. |
| `component.tokens.json` | Fixed component sizes and touch targets. |
| `type.tokens.json` | The type styles, grouped as display, numerals, text and watch. |
| `native.tokens.json` | Springs and haptics. Only the phone and watch outputs carry them. |

A semantic colour points at a primitive (`{color.green.500}`) or at another semantic colour (`{color.result-draw}`).

## Outputs: `dist/`

Committed, and never edited by hand. `apps/web/src/design/tokens.drift.test.ts` fails while any of them differs from what the source renders.

| File | For |
|---|---|
| `tokens.css` | The web: `--pm-*` custom properties, dark on `:root`, light on `[data-theme='light']`. |
| `tokens.ts` | The React Native phone app: colours per theme, lengths in points, type styles as numbers. |
| `PitchMateTokens.swift` | The watch: SwiftUI constants. `Palette` is the dark theme, the one the watch always uses. Not yet compiled by any target. |
| `tokens.json` | The export shape the claude.ai design system reads, for keeping that artifact level with the repository. |

## Changing a token

1. Edit the file in `tokens/`.
2. Rebuild, and commit `dist/` with the change.
3. If it is a colour used as text or as a control's edge, add its pairing to `apps/web/src/design/tokens.contrast.test.ts`.
4. Update `.claude/rules/brand.md` if a rule changed.
