---
paths:
  - "apps/web/**"
  - "apps/mobile/**"
  - "apps/watch/**"
---

# Brand

**Dark mode is the primary design target.** Design dark first, then verify light.

## Palette

| Token | Hex | Use |
|---|---|---|
| Pitch Green | `#5BBF36` | Fills and dark-mode accents |
| Green Dark | `#3E8F24` | Green **text or icons on light backgrounds** (contrast) |
| Green Light | `#8FD96F` | Highlights, subtle accents |
| Ink | `#141414` | Dark background; text on light |

Reserve bright Pitch Green for fills and dark-mode accents. Green text or icons on a light background use Green Dark.

| Meaning | Hex |
|---|---|
| Win | `#5BBF36` |
| Loss | `#E5484D` |
| Draw / Provisional | `#E0A82E` |
| Info | `#4C8DD6` |

## In the web app

- Components use semantic custom properties, never raw hex. Each feature declares its tokens in `src/features/<feature>/styles/theme.css` (for example `--accent-fill`, `--accent-text`, `--focus-ring`), with dark and light values, and pins them with a `theme.contrast.test.ts`. Copy that pattern for a new feature rather than inventing token names.
- **Never rely on colour alone.** Win/loss/draw show W/L/D text plus an icon (✓ / ✗ / –). Provisional shows a badge and label, not just amber, which it shares with draw to signal "unsettled".
- Text contrast meets WCAG 2.1 AA in both themes. The theme is applied before first paint by the bootstrap in `src/theme/themeBootstrap.ts`.
