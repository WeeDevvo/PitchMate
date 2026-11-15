# PitchMate brand imagery: shot list

Images for the photo slots in the signed-off mockups. You make them in the Higgsfield app, then drop the files into [`incoming/`](incoming/). After that, Claude optimises them for the web, records their prompts in a manifest and wires them into the pages.

**Status (2026-11-15):** shots 1–4 are shipped; [MANIFEST.md](MANIFEST.md) says how each came out. Shots 1 and 2 are take 2, with the swooshes retouched out. Shot 5, the loop, was dropped because both takes carried sportswear logos. Still to do: a reshoot or edit that brings women players into the landing band.

## How to run it (no code needed)

1. Open **higgsfield.ai** and sign in. You are on the Plus plan, with about 1,210 credits.
2. Choose **Image** (or **Video** for the optional clip) and pick the **model** named in the shot.
3. Paste the **Prompt** into the prompt box. If the model has a "negative prompt" or "avoid" box, paste the **Avoid** line into it. If it has none, add the Avoid line to the end of the prompt, starting with "Avoid:".
4. Set the **Aspect ratio** and **Resolution** to the values the shot gives.
5. Set the number of images to the **Variants** count, then press Generate. The app shows the exact credit cost before you press it.
6. Pick the best result and download it at full size.
7. Rename it to the **Filename** given, keeping whatever extension it downloads with (`.png`, `.jpg` or `.webp`), and save it into this repository's `apps/web/src/assets/brand/incoming/` folder.
8. If a second variant is also good, save it with `-alt` before the extension (for example `landing-band-wide-alt.png`), and Claude will show you both.

Make shots 1 to 3 first. Make the optional shots only once you're happy with those.

## Rules every image follows

- **The scene:** casual small-sided football between friends: evening five-a-side on an outdoor astroturf cage pitch, floodlights, bibs, ordinary people of mixed ages, builds and abilities.
- **The look:** dark first. Near-black shadows, like the app's Ink background (`#141414`), with the floodlit turf as the green (close to Pitch Green, `#5BBF36`). Bibs are hi-vis orange or plain green and white.
- **Never:** words, letters or numbers anywhere in the image; club badges, crests, sponsor logos or branded kits; recognisable real people or famous players; stadiums or crowds. Faces stay small, turned away or soft-focus.
- Higgsfield is for photos and motion only. Icons, logos and UI parts come from the app's own design system. The PitchMate logo is never generated; where it appears on an image (shot 4), Claude adds the real logo file.

## Credit estimate

The connector doesn't report per-image prices, so these figures are estimates. The Higgsfield app shows the real cost before each Generate. On Plus, **Nano Banana Pro** may be unlimited ("unlim"), in which case shots 1 to 4 cost nothing.

| Shot | Model | Variants | Est. credits |
|---|---|---|---|
| 1. Landing band, wide | Nano Banana Pro | 4 | ~8 |
| 2. Landing band, phone crop | Nano Banana Pro | 4 | ~8 |
| 3. Pro paywall art | Nano Banana Pro | 4 | ~8 |
| 4. Link-preview image (optional) | Nano Banana Pro | 2 | ~4 |
| 5. Landing loop clip (optional) | Cinema Studio Video 3.0 | 1 | ~30–60 |
| **Shots 1–3** | | | **~24** |
| **All five** | | | **~60–90** |

Even with a couple of reruns, that leaves well over 1,000 credits.

---

## Shot 1: Landing band, wide

- **Filename:** `landing-band-wide`
- **Where it's used:** the full-width photo band on the web landing page (mockup "Web · Landing page"), shown on tablets and desktops. The band is 21:8 and up to 1,440px wide.
- **Model:** Nano Banana Pro. If the look is too flat, try Soul Cinema as an alternative.
- **Aspect ratio:** 21:9. Claude trims it to 21:8.
- **Resolution:** 4k if offered, otherwise 2k.
- **Variants:** 4

**Prompt**

> Wide cinematic photograph of a casual evening five-a-side football game between friends on an outdoor artificial-grass cage pitch, shot from low on the touchline at dusk. Tall floodlights glow against a deep blue-black sky, and the turf is a rich, vivid green under the lights, with crisp white lines and a dark mesh fence around the pitch. Eight to ten ordinary adults, a mix of men and women of different ages and builds, in plain mismatched training tops and shorts; one side wears loose hi-vis orange mesh bibs over their tops. All clothing, bibs and boots are plain and completely unbranded, with no stripes, logos or print. Mid-play, relaxed and happy, the ball in motion near the centre. The players are small in the frame and slightly motion-blurred, with no faces in sharp focus. Moody, high-contrast night lighting with deep near-black shadows at the edges of the frame, natural film grain, 35mm lens, shallow depth of field.

**Avoid**

> text, letters, numbers, scoreboard, logos, club badges, crests, sponsor marks, branded kits, sports-brand logos, swoosh, three stripes, striped shorts, striped boots, printed text on bibs, chest logos, stadium, crowd, famous footballers, close-up faces, sharp faces, watermark, extra limbs, distorted hands, daylight, oversaturated neon colours

*Reshoot (2026-11-15):* the first version showed sportswear logos (swoosh, three stripes), print on a bib and only men, so the prompt now asks for unbranded kit and a mix of men and women.

*Change from the mockup:* the placeholder also showed a phone and a watch reading 3–2. That would put numbers in the image, and a generated phone wouldn't show the real app, so the band is just the pitch. The real app screens already appear further down the landing page.

### Fix by editing (take 2 → take 3)

The second take kept the right scene but added small Nike-style swooshes to shorts and shirts, and still showed only men. Rather than generating from scratch again, **edit** the take-2 picture:

1. In Higgsfield, choose **Nano Banana Pro** and add your take-2 `landing-band-wide` picture as the **reference image**.
2. Same ratio (21:9) and resolution (4k). Paste this as the prompt:

> Edit this photo. Remove every logo, tick, swoosh, stripe and printed mark from all shirts, shorts, bibs, socks and boots, so all kit is plain and completely unbranded. Change three of the players into women, keeping their poses, positions and bibs. Keep everything else exactly the same: the pitch, lighting, floodlights, fence, ball, framing and colours.

3. Do the same for `landing-band-phone` with its take-2 picture (4:3, 2k). In that prompt, change "three of the players" to "one of the players".
4. Make the loop (Shot 5) again from the edited wide picture.

## Shot 2: Landing band, phone crop

- **Filename:** `landing-band-phone`
- **Where it's used:** the same band on phones. A 21:8 strip is only about 130px tall at phone width, so phones get a taller, closer image.
- **Model:** Nano Banana Pro
- **Aspect ratio:** 4:3
- **Resolution:** 2k
- **Variants:** 4. Tip: if Higgsfield lets you add a reference image, add your chosen Shot 1 picture so the two match.

**Prompt**

> Cinematic photograph of a casual evening five-a-side football game between friends on an outdoor artificial-grass cage pitch under floodlights at dusk, closer framing on three or four players contesting the ball. One player wears a loose hi-vis orange mesh bib over a plain training top, the others plain mismatched tops; ordinary adults, men and women, of mixed ages and builds. All clothing and boots are plain and completely unbranded, with no stripes, logos or print. The turf is vivid green under the lights, the sky deep blue-black, a dark mesh fence behind. Framed from the chest down or from behind, so faces are out of frame, turned away or soft and motion-blurred. High-contrast night lighting, deep near-black shadows, natural film grain, 35mm lens, shallow depth of field.

**Avoid**

> text, letters, numbers, logos, club badges, crests, sponsor marks, branded kits, sports-brand logos, swoosh, three stripes, striped shorts, striped boots, printed text on bibs, stadium, crowd, famous footballers, faces in focus, close-up faces, watermark, extra limbs, distorted hands, daylight

*Reshoot (2026-11-15):* the first version had three-stripe shorts and three large, sharp faces.

## Shot 3: Pro paywall art

- **Filename:** `pro-balance-bibs`
- **Where it's used:** the art at the top of the "Squad Pro" sheet (mockup "Phone · Squad Pro paywall"), a strip about 358 × 150 on the phone. This is a phone-app screen: the web shows no paywall. The file is stored now so it's ready when the phone app is built; nothing on the web uses it yet.
- **Model:** Nano Banana Pro
- **Aspect ratio:** 21:9. Claude trims it to the strip.
- **Resolution:** 2k
- **Variants:** 4

**Prompt**

> Minimal product-style photograph at night on an artificial-grass football pitch: an old-fashioned brass balance scale stands on the turf, perfectly level and still. On the left pan sits a neatly folded vivid green mesh training bib, and on the right pan a neatly folded plain white mesh training bib. Behind, out-of-focus stadium-style floodlights make soft round bokeh against a near-black sky. Centred composition with lots of calm dark space on both sides, low camera angle, crisp detail on the mesh fabric, gentle rim light on the brass.

**Avoid**

> text, letters, numbers, logos, badges, people, hands, orange, tilted or unbalanced scale, cluttered background, daylight, watermark

*Why green and white, not orange:* in the app, orange always means bibs, and Team A (green) and Team B (white) are the two teams. A level scale with one of each says "fair teams".

## Shot 4 (optional): link-preview image

- **Filename:** `og-share`
- **Where it's used:** the picture shown when someone shares pitch-mate.co.uk in WhatsApp, iMessage or socials. It replaces `og-default.png` (1,200 × 630). Claude adds the real PitchMate logo afterwards.
- **Model:** Nano Banana Pro
- **Aspect ratio:** 16:9. Claude crops it to 1,200 × 630.
- **Resolution:** 2k
- **Variants:** 2

**Prompt**

> Cinematic photograph of an outdoor artificial-grass five-a-side cage pitch under floodlights at dusk, a casual game between friends in progress on the right side of the frame, one side in hi-vis orange mesh bibs, players small and motion-blurred. The left half of the frame is calm and dark: empty floodlit turf fading into near-black shadow. Vivid green turf, deep blue-black sky, high-contrast night lighting, natural film grain.

**Avoid**

> text, letters, numbers, logos, club badges, sponsor marks, branded kits, crowd, stadium, famous footballers, close-up faces, watermark

## Shot 5 (optional): landing loop clip

- **Filename:** `landing-band-loop`
- **Where it's used:** an optional gentle moving version of Shot 1 behind the landing band. It plays muted and loops, and only for visitors who haven't asked their device to reduce motion; everyone else sees the still.
- **Model:** Cinema Studio Video 3.0. Seedance 2.0 is an alternative.
- **How:** image to video, with your chosen **Shot 1 image as the start frame**.
- **Aspect ratio:** 21:9
- **Duration:** 5 seconds
- **Resolution:** 1080p
- **Sound:** off
- **Variants:** 1

**Prompt**

> Subtle cinemagraph-style shot. The players continue the passing move slowly and naturally, floodlight haze drifts gently, and the camera pushes in very slightly. One continuous shot, no cuts, no new people entering the frame, calm and smooth.

**Avoid**

> text, logos, cuts, fast camera moves, shaking, morphing bodies, extra players

*Reshoot (2026-11-15):* make this again from the **new** Shot 1 picture. The first loop came from the rejected still, so it carried the same logos.

Another route: a short clip made with Claude Motion can be brought into Higgsfield through its import, if you'd rather animate it that way.

---

## Not on this list, on purpose

- **Empty-state illustrations:** the app's empty states use its own icon set (`src/ui`), and the brand rules keep Higgsfield away from icons and UI.
- **Onboarding art and app-store screenshot backgrounds:** no signed-off mockup has a slot for them yet. They belong with the phone app's store listing.
- **The web app today:** `main` has no image slots yet. The landing band (shots 1, 2 and 5) is new on the web and will be added when these files land, from `src/ui` pieces and `--pm-*` tokens.
