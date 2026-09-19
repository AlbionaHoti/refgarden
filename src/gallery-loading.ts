import { referenceSource } from './source-balance';
import type { Reference } from './types';
import { ReferenceIdentity } from './reference-identity';

export const PRIORITY_IMAGES = 100;
export type GalleryEntry = { ref: Reference; slot: number; priority: boolean };

/** Stable places keep earlier images and pins intact as the space grows. */
export class GalleryCollection {
  private ids = new Set<string>();
  private identity = new ReferenceIdentity();
  readonly sources = { met: 0, nasa: 0, cosmos: 0, archive: 0 };
  get size() { return this.ids.size; }

  add(ref: Reference): GalleryEntry | undefined {
    if (!this.identity.add(ref)) return;
    const slot = this.size;
    this.ids.add(ref.id);
    const source = referenceSource(ref);
    if (source) this.sources[source]++;
    return { ref, slot, priority: slot < PRIORITY_IMAGES };
  }

  clear() {
    this.ids.clear(); this.identity.clear();
    this.sources.met = this.sources.nasa = this.sources.cosmos = this.sources.archive = 0;
  }
}

type LoadJob = { priority: boolean; start: (done: () => void) => () => void; cancel?: () => void };

/** Background thumbnails never take a slot while priority images are waiting/loading. */
export class ImageLoadQueue {
  private waiting: LoadJob[] = [];
  private active = new Set<LoadJob>();
  private paused = false;
  private pumping = false;

  constructor(private foregroundLimit = 8, private backgroundLimit = 2) {}

  add(priority: boolean, start: LoadJob['start']) {
    this.waiting.push({ priority, start }); this.pump();
  }

  setPaused(paused: boolean) { this.paused = paused; this.pump(); }

  clear() {
    this.waiting = [];
    const old = [...this.active]; this.active.clear();
    for (const job of old) job.cancel?.();
  }

  private pump() {
    if (this.paused || this.pumping) return;
    this.pumping = true;
    try {
      while (this.waiting.length && !this.paused) {
        const priorityIndex = this.waiting.findIndex(job => job.priority);
        const foreground = priorityIndex >= 0;
        if (!foreground && [...this.active].some(job => job.priority)) break;
        if (this.active.size >= (foreground ? this.foregroundLimit : this.backgroundLimit)) break;
        const [job] = this.waiting.splice(foreground ? priorityIndex : 0, 1);
        this.active.add(job);
        const done = () => { if (this.active.delete(job)) this.pump(); };
        try { job.cancel = job.start(done); } catch { done(); }
      }
    } finally { this.pumping = false; }
  }
}
