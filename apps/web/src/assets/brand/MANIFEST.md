# Brand imagery manifest

Every generated image PitchMate ships, with the model and prompt that made it. The prompts were run by hand in the Higgsfield app on 2026-11-14, following [SHOT-LIST.md](SHOT-LIST.md).

The full-size originals sit in `incoming/`, which is git-ignored: they stay on the machine that made them and are never committed. To re-export, put the original back in `incoming/` and crop and resize as each entry says.

| Asset | Status | Shipped as |
|---|---|---|
| og-share | Shipped | `apps/web/public/og-share.jpg` |
| pro-balance-bibs | Shipped (phone app; unused on the web) | `apps/mobile/assets/brand/pro-balance-bibs{,@2x,@3x}.{webp,jpg}` |
| landing-band-wide | Shipped (take 2, retouched) | `apps/web/src/assets/brand/landing-band-wide-{1440,2160,2880}.{avif,webp}`, plus a 1440 JPEG |
| landing-band-phone | Shipped (take 2, retouched) | `apps/web/src/assets/brand/landing-band-phone-{640,960,1440}.{avif,webp}`, plus a 960 JPEG |
| landing-band-loop | **Dropped**: both takes carry sportswear logos, and video can't be retouched here | nothing; every visitor sees the still |

## og-share

- **Used for:** the link preview (`og:image`) for pitch-mate.co.uk, set in `apps/web/index.html` and `features/landing/content/landingMetadata.ts`.
- **Model:** Nano Banana Pro, 16:9, 2k. Original 2752 × 1536 PNG.
- **Export:** sky trimmed from the top to 1.905:1, resized to 1200 × 630, JPEG at quality 84 (82 KB). Link-preview scrapers (WhatsApp, iMessage, Facebook) don't reliably read AVIF or WebP, so this asset is a single JPEG.
- **Logo:** added after generation, not generated: the white mark from `src/design/logos/pitchmate-mark-white.png` (the variant the brand rules give for photos) at 76px, with the "PitchMate" wordmark set in Barlow Condensed 800 in the dark-theme colours (`#f4f5f2`, with "Mate" in `#5bbf36`).
- **Prompt:**
  > Cinematic photograph of an outdoor artificial-grass five-a-side cage pitch under floodlights at dusk, a casual game between friends in progress on the right side of the frame, one side in hi-vis orange mesh bibs, players small and motion-blurred. The left half of the frame is calm and dark: empty floodlit turf fading into near-black shadow. Vivid green turf, deep blue-black sky, high-contrast night lighting, natural film grain.
- **Avoid:** text, letters, numbers, logos, club badges, sponsor marks, branded kits, crowd, stadium, famous footballers, close-up faces, watermark

## pro-balance-bibs

- **Used for:** the art strip at the top of the Squad Pro paywall in the phone app (358 × 150 pt). The web shows no paywall, so nothing on the web uses it.
- **Model:** Nano Banana Pro, 21:9, 2k. Original 3168 × 1344 PNG.
- **Export:** centre-cropped to 12:5 and resized to 358 × 150, 716 × 300 and 1074 × 450 (`@2x`, `@3x`), each as WebP (quality 80) and JPEG (quality 82). React Native picks the density from the suffix.
- **Prompt:**
  > Minimal product-style photograph at night on an artificial-grass football pitch: an old-fashioned brass balance scale stands on the turf, perfectly level and still. On the left pan sits a neatly folded vivid green mesh training bib, and on the right pan a neatly folded plain white mesh training bib. Behind, out-of-focus stadium-style floodlights make soft round bokeh against a near-black sky. Centred composition with lots of calm dark space on both sides, low camera angle, crisp detail on the mesh fabric, gentle rim light on the brass.
- **Avoid:** text, letters, numbers, logos, badges, people, hands, orange, tilted or unbalanced scale, cluttered background, daylight, watermark

## landing-band-wide and landing-band-phone

- **Used for:** the brand photo band under the hero on the landing page (`features/landing/components/PhotoBand.tsx`, through `Photo` in `src/ui`). Screens up to 767px wide get the 4:3 phone crop; wider screens get the 21:8 wide crop.
- **Model:** Nano Banana Pro. Wide at 21:9, 4k (original 6336 × 2688); phone at 4:3, 2k (original 2400 × 1792).
- **Take 2 prompts:** as in SHOT-LIST.md, shots 1 and 2 (with the reshoot wording asking for unbranded kit, a mix of men and women, and soft faces).
- **Retouched by Claude:** take 2 still showed small Nike-style swooshes, so each mark was painted out with a scripted, reviewed fill (surrounding pixels, or the kit's own colour, plus a little grain). Wide: 5 swooshes on shorts, 1 on a shirt chest and 2 on boots. Phone: 2 swooshes on shorts, 3 on boots and a waistband, and a printed label on the back of a bib. Floodlights, the goal and the net were left alone. At display size, one fill on the phone crop leaves a slight notch, about 3px, where a pair of shorts meets a knee.
- **Not fixed:** every player in both pictures is a man, despite the prompt. A future reshoot or edit should bring in women players.
- **Export:** the wide shot was cropped from 21:9 to 21:8 (equal trim top and bottom) and saved at 1440, 2160 and 2880 wide; the phone shot was kept at 4:3 and saved at 640, 960 and 1440 wide. Each is AVIF (quality 55) and WebP (quality 78), with one JPEG fallback per crop (quality 80). The wide AVIF at 1440 is 40 KB, and the phone AVIF at 960 is 27 KB.

## Rejected (take 1)

Checked against the rules in SHOT-LIST.md: no text or numbers, no badges or logos, no recognisable faces.

- **landing-band-wide** (Nano Banana Pro, 21:9): the centre player's shorts carry a Nike-style swoosh, and the right-hand player's shorts carry an Adidas-style logo with three stripes. A grey shirt has a small chest logo, the boots have three-stripe panels, and the centre bib has small printed text. The laughing centre face is also sharp.
- **landing-band-phone** (Nano Banana Pro, 4:3): three-stripe shorts, and all three faces are large and in focus.
- **landing-band-loop** (Cinema Studio Video 3.0, from landing-band-wide): it inherits every mark in the still it was made from. Take 2's loop came from take 2's still, so it has the same swooshes. Video can't be retouched here, so the loop was dropped.

Take 1 and take 2 originals are kept locally, under `incoming/rejected-take1/` and `incoming/rejected-take2/`.
