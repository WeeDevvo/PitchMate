import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Photo, type PhotoSet } from './Photo';

const wide: PhotoSet = { avif: 'w.avif 1440w', webp: 'w.webp 1440w', fallback: 'w.jpg', width: 1440, height: 549 };
const narrow: PhotoSet = { avif: 'n.avif 960w', webp: 'n.webp 960w', fallback: 'n.jpg', width: 960, height: 720 };

describe('Photo', () => {
  it('offers AVIF, then WebP, then the JPEG fallback, with its alt text and intrinsic size', () => {
    const { container } = render(<Photo image={wide} alt="A floodlit pitch" />);
    const types = [...container.querySelectorAll('source')].map((source) => source.getAttribute('type'));
    expect(types).toEqual(['image/avif', 'image/webp']);
    const img = screen.getByRole('img', { name: 'A floodlit pitch' });
    expect(img).toHaveAttribute('src', 'w.jpg');
    expect(img).toHaveAttribute('width', '1440');
    expect(img).toHaveAttribute('height', '549');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('puts the narrow crop first, behind a max-width media query, so phones get it', () => {
    const { container } = render(<Photo image={wide} narrow={narrow} narrowMaxWidth={767} alt="" />);
    const sources = [...container.querySelectorAll('source')];
    expect(sources).toHaveLength(5);
    for (const source of sources.slice(0, 3)) {
      expect(source).toHaveAttribute('media', '(max-width: 767px)');
      expect(source).toHaveAttribute('width', '960');
    }
    expect(sources[0]).toHaveAttribute('srcset', 'n.avif 960w');
    expect(sources[3]).not.toHaveAttribute('media');
  });
});
