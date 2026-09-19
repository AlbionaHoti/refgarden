import type { Reference } from './types';
import { GalleryCollection, ImageLoadQueue, PRIORITY_IMAGES, type GalleryEntry } from './gallery-loading';
import { durationLabel, safeArchiveVideo } from './media';
import { VideoPreviews } from './video-previews';

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const radians = (degrees: number) => degrees * Math.PI / 180;

type Card = GalleryEntry & { element: HTMLAnchorElement; image: HTMLImageElement; queued: boolean };

/** Native image elements in a perspective scene keep loading and source links intact. */
export class OrbitScene {
  private cards = new Map<string, Card>();
  private collection = new GalleryCollection();
  private loads = new ImageLoadQueue();
  private background: GalleryEntry[] = [];
  private near = new Set<Card>();
  private observer: IntersectionObserver;
  private videoObserver: IntersectionObserver;
  private videos = new VideoPreviews();
  private inspecting = false;
  private videoCards = new Map<string, { start: () => void; stop: () => void }>();
  private cancelIdle?: () => void;
  private progressFrame = 0;
  private loaded = 0;
  private generation = 0;
  private interactionUntil = 0;
  private picked = new Set<string>();
  private pinned = new Set<string>();
  private radius = 400;
  private camera = { yaw: -8, pitch: -6, zoom: -64, panX: 0, panY: 0 };
  private target = { ...this.camera };
  private frame = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private origin = { x: 0, y: 0, yaw: 0, pitch: 0, distance: 0, zoom: 0, panX: 0, panY: 0 };
  private panning = false;
  private dragging = false;
  private suppressClickUntil = 0;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private viewport: HTMLElement, private world: HTMLElement, private inspect: (ref: Reference) => void, private imageShown: (id: string) => void, private progress: () => void) {
    this.videoObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.reference!;
        const preview = this.videoCards.get(id);
        if (!preview) continue;
        if (entry.isIntersecting && entry.intersectionRatio >= .5) this.videos.show(id, preview);
        else this.videos.hide(id);
      }
    }, { root: viewport, threshold: [0, .5] });
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const card = this.cards.get((entry.target as HTMLElement).dataset.reference!);
        if (!card) continue;
        card.element.dataset.near = String(entry.isIntersecting);
        if (entry.isIntersecting) {
          this.near.add(card);
          if (!card.queued) this.load(card);
        } else this.near.delete(card);
      }
      this.wake();
    }, { root: viewport, rootMargin: '160px' });
    document.addEventListener('visibilitychange', () => {
      this.world.dataset.paused = String(document.hidden);
      this.loads.setPaused(document.hidden);
      this.videos.setPaused(document.hidden || this.inspecting);
      if (!document.hidden) this.scheduleBackground();
    });
    this.loads.setPaused(document.hidden);
    this.videos.setPaused(document.hidden);
    window.setInterval(() => this.videos.rotate(), 12_000);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(viewport);
    viewport.addEventListener('pointerdown', event => this.down(event));
    viewport.addEventListener('pointermove', event => this.move(event));
    viewport.addEventListener('pointerup', event => this.up(event));
    viewport.addEventListener('pointercancel', event => this.up(event));
    viewport.addEventListener('lostpointercapture', event => this.up(event));
    viewport.addEventListener('wheel', event => {
      event.preventDefault();
      this.target.yaw += event.deltaX * .09;
      this.target.zoom = clamp(this.target.zoom - event.deltaY * .85, this.minimumZoom, 850);
      this.wake(); this.used();
    }, { passive: false });
    viewport.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') this.target.yaw -= 20;
      else if (event.key === 'ArrowRight') this.target.yaw += 20;
      else if (event.key === 'ArrowUp') this.target.pitch = clamp(this.target.pitch - 6, -32, 32);
      else if (event.key === 'ArrowDown') this.target.pitch = clamp(this.target.pitch + 6, -32, 32);
      else if (event.key === '+' || event.key === '=') this.target.zoom = Math.min(850, this.target.zoom + 70);
      else if (event.key === '-') this.target.zoom = Math.max(this.minimumZoom, this.target.zoom - 70);
      else if (event.key === 'Home') this.reset();
      else return;
      event.preventDefault(); this.wake(); this.used();
    });
  }

  private get minimumZoom() { return -this.radius * 2.2 * Math.max(1, Math.sqrt(this.collection.size / PRIORITY_IMAGES)); }
  private used() { this.viewport.dataset.explored = 'true'; this.interactionUntil = performance.now() + 180; }
  private notify() {
    if (!this.progressFrame) this.progressFrame = requestAnimationFrame(() => { this.progressFrame = 0; this.progress(); });
  }

  private scheduleBackground() {
    if (this.cancelIdle || !this.background.length || document.hidden) return;
    const flush = (deadline?: IdleDeadline) => {
      this.cancelIdle = undefined;
      if (document.hidden) return;
      if (this.pointers.size || performance.now() < this.interactionUntil) {
        const timer = window.setTimeout(() => { this.cancelIdle = undefined; this.scheduleBackground(); }, 180);
        this.cancelIdle = () => clearTimeout(timer);
        return;
      }
      const start = performance.now();
      for (let count = 0; count < 4 && this.background.length; count++) {
        if (count && (performance.now() - start >= 4 || (deadline && deadline.timeRemaining() < 1))) break;
        this.mount(this.background.shift()!);
      }
      this.scheduleBackground();
    };
    if ('requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(flush, { timeout: 300 });
      this.cancelIdle = () => window.cancelIdleCallback(handle);
    } else {
      const timer = setTimeout(() => flush(), 32);
      this.cancelIdle = () => clearTimeout(timer);
    }
  }
  private resize() {
    const previous = this.radius;
    this.radius = clamp(this.viewport.clientWidth * .415, 145, 670);
    this.camera.zoom *= this.radius / previous; this.target.zoom *= this.radius / previous;
    this.world.style.setProperty('--radius', `${this.radius}px`);
    const density = Math.sqrt(18 / PRIORITY_IMAGES) * 1.13;
    this.world.style.setProperty('--card-width', `${clamp(Math.min(this.viewport.clientWidth * .14, this.viewport.clientHeight * .15) * density, 24, 180)}px`);
    for (const card of this.cards.values()) this.position(card.element, card.slot);
    this.wake();
  }

  private coordinates(slot: number) {
    const angle = slot * Math.PI * (3 - Math.sqrt(5));
    // The denominator stays fixed: new images expand outward without shrinking the first 100.
    const spread = Math.sqrt((slot + .65) / PRIORITY_IMAGES);
    return {
      x: Math.cos(angle) * this.radius * spread,
      y: Math.sin(angle) * Math.min(this.viewport.clientHeight * .365, this.radius * 1.5) * spread,
      z: Math.sin(angle * 2) * 22,
    };
  }

  private position(element: HTMLElement, slot: number) {
    const { x, y, z } = this.coordinates(slot);
    element.style.setProperty('--x', `${x}px`);
    element.style.setProperty('--y', `${y}px`);
    element.style.setProperty('--z', `${z}px`);
  }

  add(ref: Reference) {
    const entry = this.collection.add(ref);
    if (!entry) return;
    if (entry.priority) this.mount(entry);
    else { this.background.push(entry); this.scheduleBackground(); }
    this.notify();
  }

  private mount(entry: GalleryEntry) {
    const { ref, slot, priority } = entry;
    const card = document.createElement('a'); card.className = 'orbit-card'; card.href = ref.source; card.target = '_blank'; card.rel = 'noreferrer';
    card.dataset.reference = ref.id; card.setAttribute('aria-label', `Inspect ${ref.sourceName}: ${ref.title}`);
    const face = document.createElement('span'); face.className = 'orbit-face';
    face.style.setProperty('--float-duration', `${6.8 + slot % 7 * .4}s`);
    face.style.setProperty('--float-delay', `${-(slot % 13) * .47}s`);
    const image = document.createElement('img'); image.alt = ref.title; image.draggable = false; image.decoding = 'async';
    image.fetchPriority = priority ? 'high' : 'low';
    const caption = document.createElement('span'); caption.className = 'orbit-caption'; caption.textContent = ref.sourceName;
    const mark = document.createElement('span'); mark.className = 'orbit-pick'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = '✳';
    face.append(image, mark); card.append(face, caption);
    if (safeArchiveVideo(ref.video)) {
      const video = document.createElement('video');
      video.className = 'orbit-video'; video.muted = true; video.defaultMuted = true;
      video.autoplay = true; video.loop = true; video.playsInline = true; video.preload = 'none';
      video.setAttribute('aria-hidden', 'true'); video.tabIndex = -1;
      const badge = document.createElement('span'); badge.className = 'video-badge';
      badge.setAttribute('aria-hidden', 'true');
      const symbol = document.createElement('span'); symbol.className = 'video-symbol';
      const duration = document.createElement('span'); duration.className = 'video-duration';
      duration.textContent = durationLabel(ref.video!.durationSeconds);
      badge.append(symbol, duration);
      card.setAttribute('aria-label', `Inspect video: ${ref.title}, ${duration.textContent}, ${ref.sourceName}`);
      face.append(video, badge); card.dataset.media = 'video';
      video.addEventListener('playing', () => { card.dataset.playing = 'true'; });
      video.addEventListener('pause', () => { card.dataset.playing = 'false'; });
      video.addEventListener('error', () => { card.dataset.playing = 'false'; duration.textContent = 'Open'; });
      const preview = {
        start: () => {
          video.src = ref.video!.url;
          void video.play().catch(() => { card.dataset.playing = 'false'; });
        },
        stop: () => { video.pause(); video.removeAttribute('src'); video.load(); card.dataset.playing = 'false'; },
      };
      this.videoCards.set(ref.id, preview);
      this.videoObserver.observe(card);
    }
    card.addEventListener('dragstart', event => event.preventDefault());
    card.addEventListener('click', event => { event.preventDefault(); if (performance.now() >= this.suppressClickUntil) this.inspect(ref); });
    const item = { ...entry, element: card, image, queued: false };
    card.dataset.priority = priority ? 'foreground' : 'background';
    card.dataset.near = 'false';
    this.position(card, slot); this.cards.set(ref.id, item); this.world.append(card);
    this.mark(item); this.observer.observe(card);
    if (priority) this.load(item);
    this.wake();
  }

  private load(card: Card) {
    card.queued = true;
    const generation = this.generation;
    this.loads.add(card.priority, done => {
      if (!card.priority && !this.near.has(card)) {
        card.queued = false; done(); return () => {};
      }
      const { image, element, ref } = card;
      element.dataset.loading = 'true';
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        image.removeEventListener('load', onLoad); image.removeEventListener('error', onError);
        element.dataset.loading = 'false';
      };
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true; cleanup();
        if (generation === this.generation && element.isConnected) {
          if (ok) {
            element.style.setProperty('--aspect', String(clamp(image.naturalWidth / image.naturalHeight, .72, 1.38)));
            this.loaded++;
            requestAnimationFrame(() => {
              if (generation !== this.generation || !element.isConnected) return;
              const rect = element.getBoundingClientRect();
              if (rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight) this.imageShown(ref.id);
            });
          } else {
            element.classList.add('is-unavailable'); image.hidden = true; image.removeAttribute('src');
            const text = document.createElement('span'); text.textContent = 'Open source'; element.firstElementChild!.append(text);
          }
          element.classList.add('is-ready'); this.notify();
        }
        done();
      };
      const onLoad = () => finish(true), onError = () => finish(false);
      const timeout = setTimeout(onError, 15000);
      image.addEventListener('load', onLoad); image.addEventListener('error', onError);
      image.src = ref.image;
      return () => { settled = true; cleanup(); image.removeAttribute('src'); };
    });
  }

  get sourceCounts() { return this.collection.sources; }
  get collectedCount() { return this.collection.size; }
  get loadedCount() { return this.loaded; }
  setInspecting(value: boolean) { this.inspecting = value; this.videos.setPaused(document.hidden || value); }

  clear() {
    this.generation++;
    this.cancelIdle?.(); this.cancelIdle = undefined; this.background = [];
    this.loads.clear(); this.observer.disconnect(); this.near.clear();
    this.videoObserver.disconnect(); this.videos.clear(); this.videoCards.clear();
    for (const card of this.cards.values()) { card.image.removeAttribute('src'); card.element.remove(); }
    this.cards.clear(); this.collection.clear(); this.loaded = 0;
    this.picked.clear(); this.pinned.clear(); this.notify();
  }

  reset() {
    this.target = { yaw: -8, pitch: -6, zoom: -this.radius * .16, panX: 0, panY: 0 };
    this.viewport.dataset.explored = 'false';
    this.wake();
  }

  highlight(ids: string[], pins: string[]) {
    const changed = new Set([...this.picked, ...this.pinned, ...ids, ...pins]);
    const picked = new Set(ids), pinned = new Set(pins);
    for (const id of changed) {
      if (this.picked.has(id) === picked.has(id) && this.pinned.has(id) === pinned.has(id)) changed.delete(id);
    }
    this.picked = picked; this.pinned = pinned;
    for (const id of changed) { const card = this.cards.get(id); if (card) this.mark(card); }
  }

  private mark(card: Card) {
    card.element.dataset.picked = String(this.picked.has(card.ref.id));
    card.element.dataset.pinned = String(this.pinned.has(card.ref.id));
  }

  private down(event: PointerEvent) {
    if (event.button !== 0) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.origin = { x: event.clientX, y: event.clientY, ...this.target, distance: this.distance() };
    this.panning = event.shiftKey || this.target.zoom > this.radius * .4;
    this.dragging = false;
  }

  private distance() {
    const points = [...this.pointers.values()];
    return points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
  }

  private move(event: PointerEvent) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const dx = event.clientX - this.origin.x, dy = event.clientY - this.origin.y;
    if (!this.dragging && Math.hypot(dx, dy) < 5) return;
    this.dragging = true; this.viewport.dataset.dragging = 'true';
    if (!this.viewport.hasPointerCapture(event.pointerId)) this.viewport.setPointerCapture(event.pointerId);
    if (this.pointers.size > 1) this.target.zoom = clamp(this.origin.zoom + (this.distance() - this.origin.distance) * 1.6, this.minimumZoom, 850);
    else if (this.panning) {
      const scale = (1150 - this.target.zoom) / 1150;
      this.target.panX = this.origin.panX + dx * scale;
      this.target.panY = this.origin.panY + dy * scale;
    }
    else {
      this.target.yaw = this.origin.yaw + dx * .19;
      this.target.pitch = clamp(this.origin.pitch - dy * .11, -32, 32);
    }
    this.wake(); this.used();
  }

  private up(event: PointerEvent) {
    if (this.dragging) this.suppressClickUntil = performance.now() + 180;
    this.pointers.delete(event.pointerId);
    if (this.viewport.hasPointerCapture(event.pointerId)) this.viewport.releasePointerCapture(event.pointerId);
    this.viewport.dataset.dragging = 'false';
    if (!this.pointers.size) this.dragging = false;
    else { const point = [...this.pointers.values()][0]; this.origin = { ...point, ...this.target, distance: this.distance() }; }
  }

  private wake() { if (!this.frame) this.frame = requestAnimationFrame(() => this.paint()); }
  private paint() {
    this.frame = 0;
    const rate = this.reducedMotion ? 1 : .17;
    const axes = ['yaw', 'pitch', 'zoom', 'panX', 'panY'] as const;
    for (const key of axes) this.camera[key] += (this.target[key] - this.camera[key]) * rate;
    this.world.style.setProperty('--yaw', `${this.camera.yaw}deg`);
    this.world.style.setProperty('--pitch', `${this.camera.pitch}deg`);
    this.world.style.setProperty('--dolly', `${this.camera.zoom}px`);
    this.world.style.setProperty('--pan-x', `${this.camera.panX}px`);
    this.world.style.setProperty('--pan-y', `${this.camera.panY}px`);
    const yaw = radians(this.camera.yaw), pitch = radians(this.camera.pitch);
    for (const card of this.near) {
      const depth = Math.cos(card.slot * Math.PI * 2 / 18 + radians(this.camera.yaw));
      card.element.style.setProperty('--depth-opacity', String(.76 + (depth + 1) * .12));
      if (card.element.dataset.media === 'video') {
        const { x, y, z } = this.coordinates(card.slot);
        const cameraDepth = this.camera.zoom + Math.sin(pitch) * y + Math.cos(pitch) * (Math.cos(yaw) * z - Math.sin(yaw) * x);
        // Cancel the perspective enlargement of badges without measuring layout each frame.
        card.element.style.setProperty('--overlay-scale', String(clamp((1150 - cameraDepth) / 1150, .025, 1)));
      }
    }
    if (axes.some(key => Math.abs(this.camera[key] - this.target[key]) > .01)) this.wake();
  }
}
