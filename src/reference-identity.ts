import type { Reference } from './types';

/** Only strip presentation variants on the image hosts we understand. */
export function imageIdentity(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    if (url.hostname === 'cdn.cosmos.so') {
      for (const key of ['w', 'h', 'width', 'height', 'format', 'quality', 'q', 'fit', 'dpr']) url.searchParams.delete(key);
    } else if (url.hostname === 'images.metmuseum.org') {
      url.pathname = url.pathname.replace(/\/(web-large|web-additional|original)\//, '/asset/');
    } else if (url.hostname === 'images-assets.nasa.gov') {
      url.pathname = url.pathname.replace(/~(thumb|small|medium|large|orig)\.(jpe?g|png|webp)$/i, '~image');
    }
    url.searchParams.sort();
    return url.href;
  } catch { return value; }
}

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function referenceKeys(ref: Reference): string[] {
  const keys = [`id:${ref.id}`, `${ref.video ? 'video' : 'image'}:${ref.video?.url || imageIdentity(ref.image)}`];
  // Catalog editions of the same named print can have separate IDs and photographs.
  // Generic titles such as "Dress" or "Untitled" do not identify an artwork.
  if (!ref.video && (ref.sourceKey === 'met' || ref.sourceName === 'The Met')) {
    const title = normalize(ref.title), date = normalize(ref.date), artist = normalize(ref.credit.split('. ')[0]);
    if (title.length >= 32 && date && artist && !artist.startsWith('artist not identified')) {
      keys.push(`work:met:${JSON.stringify([title, artist, date])}`);
    }
  }
  return keys;
}

export class ReferenceIdentity {
  private keys: Set<string>;
  constructor(previous: Iterable<string> = []) { this.keys = new Set(previous); }
  add(ref: Reference): boolean {
    const keys = referenceKeys(ref);
    const duplicate = keys.some(key => this.keys.has(key));
    // Remember aliases too, so a repeated catalog record cannot reappear under another URL.
    for (const key of keys) this.keys.add(key);
    return !duplicate;
  }
  clear() { this.keys.clear(); }
}
