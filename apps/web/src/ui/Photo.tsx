import { cx } from './cx';
import './Photo.css';

/** One crop of a photo, encoded for the web. `avif` and `webp` are `srcset` strings. */
export interface PhotoSet {
  avif: string;
  webp: string;
  /** A JPEG for browsers that read neither AVIF nor WebP. */
  fallback: string;
  /** Intrinsic size of the crop, so the browser reserves its space before it loads. */
  width: number;
  height: number;
}

export interface PhotoProps {
  image: PhotoSet;
  /** A different crop for narrow screens (art direction), used up to `narrowMaxWidth`. */
  narrow?: PhotoSet;
  narrowMaxWidth?: number;
  /** Describe what the photo shows; pass `''` only when it is pure decoration. */
  alt: string;
  /** The `sizes` hint for both crops. Defaults to the full viewport width. */
  sizes?: string;
  loading?: 'lazy' | 'eager';
  className?: string;
}

/** A brand photo: AVIF, then WebP, then JPEG, with an optional narrow-screen crop. */
export function Photo({
  image,
  narrow,
  narrowMaxWidth = 767,
  alt,
  sizes = '100vw',
  loading = 'lazy',
  className,
}: PhotoProps) {
  const media = narrow ? `(max-width: ${narrowMaxWidth}px)` : undefined;
  return (
    <picture className={cx('pm-photo', className)}>
      {narrow && (
        <>
          <source media={media} type="image/avif" srcSet={narrow.avif} sizes={sizes} width={narrow.width} height={narrow.height} />
          <source media={media} type="image/webp" srcSet={narrow.webp} sizes={sizes} width={narrow.width} height={narrow.height} />
          <source media={media} srcSet={narrow.fallback} width={narrow.width} height={narrow.height} />
        </>
      )}
      <source type="image/avif" srcSet={image.avif} sizes={sizes} />
      <source type="image/webp" srcSet={image.webp} sizes={sizes} />
      <img
        src={image.fallback}
        width={image.width}
        height={image.height}
        alt={alt}
        loading={loading}
        decoding="async"
      />
    </picture>
  );
}
