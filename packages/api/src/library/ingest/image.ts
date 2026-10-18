import type { SafeFetchOptions } from '../net/safeFetch';
import { safeFetch } from '../net/safeFetch';

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

const ASCII = (bytes: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...bytes.subarray(from, to));

/** The kind of raster image these bytes are, from the bytes alone; what a sender claims is ignored. */
export function sniffImage(b: Uint8Array): ImageMediaType | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
    return 'image/gif';
  if (b.length > 12 && ASCII(b, 0, 4) === 'RIFF' && ASCII(b, 8, 12) === 'WEBP') return 'image/webp';
  return null; // SVG is deliberately excluded: it can carry script.
}

export interface FetchedImage {
  mediaType: ImageMediaType;
  bytes: Uint8Array;
}

/** Largest picture kept for a list. Bigger ones are skipped rather than shrunk, as nothing here decodes images. */
export const MAX_THUMBNAIL_BYTES: number = 300 * 1024;

/**
 * Fetches the lead image of a page for a list, through the same guarded fetch as pages. Nothing is
 * decoded: the bytes are typed by their first few bytes and kept as they are. `null` when the picture
 * is missing, too large or not a raster image, since a list works as well without one.
 */
export async function fetchThumbnail(
  url: string,
  options: SafeFetchOptions = {},
): Promise<FetchedImage | null> {
  try {
    const res = await safeFetch(url, {
      maxBytes: MAX_THUMBNAIL_BYTES,
      timeoutMs: 5_000,
      ...options,
      accept: ['image/'],
    });
    const mediaType = sniffImage(res.bytes);
    return mediaType ? { mediaType, bytes: res.bytes } : null;
  } catch {
    return null;
  }
}
