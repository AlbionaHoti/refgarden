type Preview = { start: () => void; stop: () => void };

/** Bound active decoders independently of how many posters are in the collection. */
export class VideoPreviews {
  private visible = new Map<string, Preview>();
  private playing = new Map<string, Preview>();
  private paused = false;
  constructor(private limit = 8) {}

  show(id: string, preview: Preview) { this.visible.set(id, preview); this.sync(); }
  hide(id: string) { this.visible.delete(id); this.sync(); }
  setPaused(value: boolean) { this.paused = value; this.sync(); }
  clear() { this.visible.clear(); this.sync(); }
  rotate() {
    if (this.paused || this.visible.size <= this.limit) return;
    const entries = [...this.visible];
    this.visible = new Map([...entries.slice(this.limit), ...entries.slice(0, this.limit)]);
    this.sync();
  }

  private sync() {
    const next = new Map(this.paused ? [] : [...this.visible].slice(0, this.limit));
    for (const [id, preview] of this.playing) if (!next.has(id)) preview.stop();
    for (const [id, preview] of next) if (!this.playing.has(id)) preview.start();
    this.playing = next;
  }
}
