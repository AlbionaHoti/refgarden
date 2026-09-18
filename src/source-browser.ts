import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { SourceKey } from './types';

type Emit = (event: { type: 'frame'; source: SourceKey; image: string; url: string } | { type: 'browser'; source: SourceKey; status: string; url: string }) => void;

/** App-owned, ephemeral Chromium. It never connects to the user's browser/profile. */
export class SourceBrowser {
  private browser?: Browser;
  private context?: BrowserContext;
  private pages = new Map<SourceKey, Page>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private stopped = false;
  private navigation = new Map<SourceKey, Promise<void>>();
  constructor(private emit: Emit) {}

  async start() {
    this.browser = await chromium.launch({ headless: true, timeout: 15_000 });
    if (this.stopped) { await this.close(); return; }
    this.context = await this.browser.newContext({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    this.context.setDefaultTimeout(8000);
  }

  open(source: SourceKey, url: string, warm = false) {
    const task = (this.navigation.get(source) || Promise.resolve()).then(() => this.openPage(source, url, warm));
    this.navigation.set(source, task);
    return task;
  }
  private async openPage(source: SourceKey, url: string, warm: boolean) {
    if (this.stopped || !this.context) return;
    let page = this.pages.get(source);
    if (!page) {
      page = await this.context.newPage();
      this.pages.set(source, page);
      page.on('dialog', dialog => { void dialog.dismiss(); });
      page.on('popup', popup => { void popup.close(); });
      this.capture(source, page);
    }
    this.emit({ type: 'browser', source, status: warm ? 'Opening source while Astra plans' : 'Opening search', url });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      this.emit({ type: 'browser', source, status: warm ? 'Source open / waiting for Astra’s search' : 'Live page', url: page.url() });
      if (warm) return;
      if (source === 'nasa') await page.locator('main a[href^="/details/"] img').first().waitFor({ state: 'visible', timeout: 18_000 });
      await page.waitForFunction(key => {
        const images = key === 'nasa' ? Array.from(document.querySelectorAll<HTMLImageElement>('main a[href^="/details/"] img')) : Array.from(document.images);
        const candidates = images.filter(img => /(?:cdn\.cosmos\.so|images-assets\.nasa\.gov|images\.metmuseum\.org|collectionapi\.metmuseum\.org)/.test(img.currentSrc || img.src)).slice(0, 3);
        return candidates.length > 0 && candidates.every(img => {
          if (!img.complete || img.naturalWidth <= 100) return false;
          let node: Element | null = img;
          while (node) { if (Number(getComputedStyle(node).opacity) < .98) return false; node = node.parentElement; }
          return true;
        });
      }, source, { timeout: 18_000 });
      // This is deterministic browsing, not a claimed Jev click decision.
      const top = await page.evaluate(key => {
        const image = key === 'nasa' ? document.querySelector('main a[href^="/details/"] img') : Array.from(document.images).find(img => img.getBoundingClientRect().width > 120 && img.getBoundingClientRect().height > 120);
        return image ? Math.max(0, image.getBoundingClientRect().top + window.scrollY - (key === 'nasa' ? 70 : 160)) : 0;
      }, source);
      if (top > 250) await page.mouse.wheel(0, Math.min(top, 1000));
      // Ensure any scroll-triggered fade-in has reached its real visible state.
      if (source === 'nasa') await page.waitForFunction(() => {
        const first = document.querySelector('main a[href^="/details/"] img');
        return first && first.getBoundingClientRect().top <= 180 && Array.from(document.querySelectorAll('main .media-asset')).slice(0, 3).every(node => Number(getComputedStyle(node).opacity) >= .98);
      }, undefined, { timeout: 4000 });
    } catch {
      if (!this.stopped) this.emit({ type: 'browser', source, status: 'Page slow or unavailable; source retrieval continues', url });
    }
  }

  inspect(source: SourceKey, url: string) {
    const task = (this.navigation.get(source) || Promise.resolve()).then(() => this.inspectPage(source, url));
    this.navigation.set(source, task);
    return task;
  }
  private async inspectPage(source: SourceKey, url: string) {
    const page = this.pages.get(source);
    const allowed = { met: 'www.metmuseum.org', cosmos: 'www.cosmos.so', nasa: 'images.nasa.gov' };
    if (!page || this.stopped || new URL(url).hostname !== allowed[source]) return;
    this.emit({ type: 'browser', source, status: 'Opening Jev’s selected reference', url });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
    await page.waitForFunction(() => Array.from(document.images).some(img => img.complete && img.naturalWidth > 200), undefined, { timeout: 8000 }).catch(() => {});
  }

  private capture(source: SourceKey, page: Page) {
    const tick = async () => {
      if (this.stopped || page.isClosed()) return;
      try {
        if (page.url() !== 'about:blank') {
          const bytes = await page.screenshot({ type: 'jpeg', quality: 50, timeout: 2200 });
          if (!this.stopped) this.emit({ type: 'frame', source, image: `data:image/jpeg;base64,${bytes.toString('base64')}`, url: page.url() });
        }
      } catch { /* A navigation can interrupt a capture. The next frame resumes it. */ }
      if (!this.stopped) {
        const timer = setTimeout(() => { this.timers.delete(timer); void tick(); }, 500);
        this.timers.add(timer);
      }
    };
    void tick();
  }

  async finish() {
    // Take a final actual frame, rather than fabricating a completed browser state.
    await Promise.allSettled([...this.pages].map(async ([source, page]) => {
      if (this.stopped || page.isClosed() || page.url() === 'about:blank') return;
      const bytes = await page.screenshot({ type: 'jpeg', quality: 65, timeout: 2500 });
      this.emit({ type: 'frame', source, image: `data:image/jpeg;base64,${bytes.toString('base64')}`, url: page.url() });
    }));
    await this.close();
  }
  async close() {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    const browser = this.browser;
    this.browser = undefined;
    if (!browser) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        browser.close().catch(() => {}),
        new Promise<void>(resolve => { timeout = setTimeout(resolve, 3000); }),
      ]);
    } finally { if (timeout) clearTimeout(timeout); }
  }
}
