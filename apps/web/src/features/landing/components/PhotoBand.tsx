/**
 * PhotoBand — the brand photo between the hero and the benefit cards: an
 * evening five-a-side game under floodlights.
 *
 * Wide screens get a 21:8 crop; phones get a closer 4:3 shot, because a 21:8
 * strip is only about 130px tall at phone width. Both come in AVIF, WebP and a
 * JPEG fallback through the design system's `Photo`. The images, their prompts
 * and how they were made are recorded in `src/assets/brand/MANIFEST.md`.
 */
import { landingContent, type LandingContent } from '../content/landingContent'
import { Photo, type PhotoSet } from '../../../ui'
import wide1440Avif from '../../../assets/brand/landing-band-wide-1440.avif'
import wide2160Avif from '../../../assets/brand/landing-band-wide-2160.avif'
import wide2880Avif from '../../../assets/brand/landing-band-wide-2880.avif'
import wide1440Webp from '../../../assets/brand/landing-band-wide-1440.webp'
import wide2160Webp from '../../../assets/brand/landing-band-wide-2160.webp'
import wide2880Webp from '../../../assets/brand/landing-band-wide-2880.webp'
import wide1440Jpg from '../../../assets/brand/landing-band-wide-1440.jpg'
import phone640Avif from '../../../assets/brand/landing-band-phone-640.avif'
import phone960Avif from '../../../assets/brand/landing-band-phone-960.avif'
import phone1440Avif from '../../../assets/brand/landing-band-phone-1440.avif'
import phone640Webp from '../../../assets/brand/landing-band-phone-640.webp'
import phone960Webp from '../../../assets/brand/landing-band-phone-960.webp'
import phone1440Webp from '../../../assets/brand/landing-band-phone-1440.webp'
import phone960Jpg from '../../../assets/brand/landing-band-phone-960.jpg'

const wide: PhotoSet = {
  avif: `${wide1440Avif} 1440w, ${wide2160Avif} 2160w, ${wide2880Avif} 2880w`,
  webp: `${wide1440Webp} 1440w, ${wide2160Webp} 2160w, ${wide2880Webp} 2880w`,
  fallback: wide1440Jpg,
  width: 1440,
  height: 549,
}

const phone: PhotoSet = {
  avif: `${phone640Avif} 640w, ${phone960Avif} 960w, ${phone1440Avif} 1440w`,
  webp: `${phone640Webp} 640w, ${phone960Webp} 960w, ${phone1440Webp} 1440w`,
  fallback: phone960Jpg,
  width: 960,
  height: 720,
}

export interface PhotoBandProps {
  /** The content model supplying the photo's description. */
  content?: LandingContent
}

export function PhotoBand({ content = landingContent }: PhotoBandProps) {
  return (
    <div className="landing-photo">
      <Photo
        image={wide}
        narrow={phone}
        alt={content.photo.alt}
        sizes="(min-width: 80rem) 80rem, 100vw"
      />
    </div>
  )
}

export default PhotoBand
