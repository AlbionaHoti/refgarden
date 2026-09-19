import './spatial.css';
import { OrbitScene } from './orbit-scene';
import { VISUAL_STYLES, validateStyles, styledBrief } from './visual-styles';
import { CREATOR_BRIEFS } from './presets';
import { BOARD_SIZE } from './decision';
import type { Reference, ResearchEvent, DiscoveryCursor } from './types';
import { providerKey } from './provider-keys';
import { curateWithAstra } from './astra-api';
import { validateMedia, safeArchiveVideo, durationLabel } from './media';
import type { MediaMode } from './types';
import { imageSourceShares } from './source-balance';

type SpaceRun = { startedAt: string; mode: string; continuous?: boolean; brief: string; styles?: string[]; media?: MediaMode; status: string; totalMs: number; retrievalMs?: number | null; firstImageMs?: number | null; firstBatchMs?: number; events: ResearchEvent[]; selected: string[]; pinned: string[] };
type History = { id: string; title: string; latest: SpaceRun; firstImageMs?: number | null; retrievalMs?: number | null; frames: unknown[]; frameCounts: unknown[]; renderedFrames: number };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const prompt = $<HTMLTextAreaElement>('brief');
const panel = $('prompt-panel');
const form = $<HTMLFormElement>('prompt-form');
const refs = new Map<string, Reference>();
let pins: string[] = [];
let styles: string[] = [];
let media: MediaMode = 'images';
let history: History[] = [];
let latest: SpaceRun | null = null;
let busy = false, configured = false, stopped = false, savedView = false;
let hosted = true, localMode = false, localConfigured = false;
let openaiKey = '';
let astraPicks: string[] = [];
let recordedBrowserFrames = 0;
let abort: AbortController | null = null;
let started = 0;
let picks: string[] = [];
let detail: Reference | null = null;
let timingLabel = '';
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
const isReference = (ref: any): ref is Reference => Boolean(ref?.id && typeof ref.title === 'string' && /^https:\/\//.test(ref.image) && /^https:\/\//.test(ref.source) && (!ref.video || safeArchiveVideo(ref.video)));
const read = (storage: Storage, key: string) => { try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; } };

const scene = new OrbitScene($('space'), $('world'), inspect, id => {
  if (!busy || !latest || latest.firstImageMs != null || !latest.events.some(event => event.type === 'candidate' && event.reference.id === id)) return;
  latest.firstImageMs = Math.round(performance.now() - started);
  $('empty-message').hidden = true;
}, updateSourceCounts);

function saveDraft() {
  try {
    localStorage.setItem('jev-curator-space', JSON.stringify({ brief: prompt.value, styles, media, pins, references: pins.map(id => refs.get(id)).filter(Boolean) }));
    localStorage.setItem('jev-curator-board', JSON.stringify({ brief: prompt.value, pins, board: [...new Set([...pins, ...picks])].slice(0, BOARD_SIZE), references: [...new Set([...pins, ...picks])].map(id => refs.get(id)).filter(Boolean) }));
  } catch { /* The current exploration remains usable when local storage is full. */ }
}

function panelOpen(open: boolean, focus = false) {
  panel.hidden = false;
  if (!open) { $<HTMLDetailsElement>('style-options').open = false; $<HTMLDetailsElement>('tools').open = false; }
  if (open && focus) prompt.focus();
}

function showMessage(text: string, error = false, outside = false) {
  $('panel-message').textContent = text; $('panel-message').hidden = !text; $('panel-message').classList.toggle('error', error);
  if (outside) {
    clearTimeout(toastTimer); $('status-toast').textContent = text; $('status-toast').classList.toggle('error', error); $('status-toast').hidden = false;
    if (!error) toastTimer = setTimeout(() => { $('status-toast').hidden = true; }, 4500);
  }
}

function updateControls() {
  panel.dataset.running = String(busy);
  document.body.dataset.running = String(busy);
  const exploreButton = $<HTMLButtonElement>('explore');
  exploreButton.disabled = false;
  exploreButton.formNoValidate = busy;
  exploreButton.setAttribute('aria-label', busy ? 'Stop search' : 'Explore');
  $('explore-label').textContent = busy ? 'Stop' : 'Explore';
  $('style-summary').textContent = styles.length ? `Styles · ${styles.length}` : 'Styles';
  $<HTMLButtonElement>('export-run').disabled = busy || !latest;
  $<HTMLSelectElement>('saved-searches').disabled = busy;
  $<HTMLButtonElement>('pin-asset').disabled = busy;
  document.querySelectorAll<HTMLInputElement>('[name=visual-style]').forEach(input => { input.disabled = busy; input.checked = styles.includes(input.value); });
  $<HTMLInputElement>('media-images').checked = media !== 'videos';
  $<HTMLInputElement>('media-videos').checked = media !== 'images';
  $<HTMLInputElement>('media-images').disabled = busy;
  $<HTMLInputElement>('media-videos').disabled = busy;
  $('video-hint').hidden = media === 'images';
  $('connection-status').textContent = hosted ? 'Models · optional' : configured ? 'Connections · Jev ready' : 'Connections · add your key';
  $('key-form').hidden = !localMode;
  $('jev-local-note').hidden = localMode;
  $<HTMLInputElement>('jev-key').disabled = busy || !localMode;
  $<HTMLButtonElement>('connect-key').disabled = busy || !localMode;
  $<HTMLButtonElement>('connect-openai').disabled = busy;
  $<HTMLButtonElement>('clear-keys').disabled = busy;
  $<HTMLInputElement>('use-astra').disabled = busy || !openaiKey;
  $('hud').dataset.state = busy ? 'running' : latest?.status === 'error' ? 'error' : savedView ? 'saved' : 'complete';
}

function showTiming(ms: number, label?: string) {
  $('hud').hidden = false; $('elapsed').textContent = seconds(ms);
  if (label) { timingLabel = label; updateSourceCounts(); }
}

function updateSourceCounts() {
  const counts = scene.sourceCounts;
  $('timing-label').textContent = scene.collectedCount ? `${scene.collectedCount} collected · ${scene.loadedCount} ${counts.archive ? 'thumbnails' : 'loaded'}` : '';
  $('timing-state').textContent = timingLabel;
  const shares = imageSourceShares(counts);
  for (const source of ['met', 'nasa', 'cosmos', 'archive'] as const) {
    $(`count-${source}`).textContent = String(counts[source]);
    if (source !== 'archive') $(`share-${source}`).textContent = `${shares[source]}%`;
  }
  $('archive-count').hidden = !counts.archive && media === 'images';
  $('source-mix').hidden = false;
}

function updateRecord() {
  if (!latest) return;
  const calls = latest.events.filter(event => ['search-plan', 'archive-plan', 'shortlist', 'decision'].includes(event.type));
  $('run-summary').textContent = `${latest.events.filter(event => event.type === 'candidate').length} assets. ${calls.length} Jev requests. ${latest.firstImageMs == null ? '' : `First thumbnail ${seconds(latest.firstImageMs)}.`}`;
  if ($('raw-record').closest('details')?.open) $('raw-record').textContent = JSON.stringify({ ...latest, browserFrames: recordedBrowserFrames, inputMode: 'Source metadata; no image pixels', savedView }, null, 2);
}

function drawHistory() {
  const select = $<HTMLSelectElement>('saved-searches'); select.replaceChildren();
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Revisit a saved search'; select.append(placeholder);
  for (const run of history) {
    const option = document.createElement('option'); option.value = run.id;
    option.textContent = `${run.title} · ${seconds(run.latest.totalMs)}`;
    select.append(option);
  }
}

function remember() {
  if (!latest) return;
  const references = latest.events.filter(event => event.type === 'candidate');
  if (references.length) {
    const title = latest.brief.replace(/^[Ii][’']?m (making|designing) (a |an )?/, '').slice(0, 55);
    const record: History = { id: latest.startedAt, title, latest: structuredClone(latest), firstImageMs: latest.firstImageMs, retrievalMs: latest.retrievalMs, frames: [], frameCounts: [], renderedFrames: 0 };
    history = [record, ...history.filter(item => item.id !== record.id)].slice(0, 12);
    try {
      localStorage.setItem('jev-curator-explorations', JSON.stringify(history));
      sessionStorage.setItem('jev-curator-live-preview', JSON.stringify(record));
    } catch { /* In-memory results remain available. */ }
  }
  saveDraft(); drawHistory(); updateRecord();
}

function restore(run: SpaceRun, restorePrompt = true, browserFrames = 0) {
  if (busy) return;
  latest = structuredClone(run); picks = []; astraPicks = []; $('curation-summary').hidden = true; savedView = true; recordedBrowserFrames = browserFrames; scene.clear(); scene.reset();
  if (restorePrompt) { prompt.value = run.brief; styles = validateStyles(run.styles); media = validateMedia(run.media); }
  for (const event of run.events) {
    if (event.type === 'candidate' && isReference(event.reference)) { refs.set(event.reference.id, event.reference); scene.add(event.reference); scene.highlight([], pins); }
    if (event.type === 'shortlist') picks.push(...event.ids);
    if (event.type === 'curation') { astraPicks = event.ids; $('curation-summary').textContent = `Astra: ${event.summary}`; $('curation-summary').hidden = false; }
    if (event.type === 'decision' && refs.has(event.decision.id)) picks.push(event.decision.id);
  }
  scene.highlight([...picks, ...astraPicks], pins); $('empty-message').hidden = run.events.some(event => event.type === 'candidate');
  showTiming(run.totalMs, 'saved search'); showMessage('Saved result. Explore searches the sources again.');
  updateSourceCounts(); updateControls(); updateRecord(); saveDraft();
}

function inspect(ref: Reference) {
  detail = ref;
  const image = $<HTMLImageElement>('asset-image'); image.src = ref.image; image.alt = ref.title;
  const video = $<HTMLVideoElement>('asset-video');
  const hasVideo = safeArchiveVideo(ref.video);
  image.hidden = hasVideo; video.hidden = !hasVideo;
  scene.setInspecting(true);
  if (hasVideo) { video.src = ref.video!.url; video.poster = ref.image; video.muted = true; void video.play().catch(() => {}); }
  $('asset-title').textContent = ref.title; $('asset-source').textContent = ref.sourceName;
  $('asset-description').textContent = ref.description; $('asset-credit').textContent = hasVideo ? `${ref.credit} · ${durationLabel(ref.video!.durationSeconds)}. Check the original item for reuse terms.` : ref.credit;
  $<HTMLAnchorElement>('asset-link').href = ref.source;
  $('pin-asset').textContent = pins.includes(ref.id) ? 'Unpin' : 'Keep';
  $('asset-dialog').dataset.reference = ref.id;
  $<HTMLDialogElement>('asset-dialog').showModal(); updateControls();
}

function eventReceived(event: ResearchEvent) {
  if (!latest) return;
  latest.events.push(event);
  if (event.type === 'stage') {
    timingLabel = event.stage === 'jev' ? 'Jev' : 'searching'; updateSourceCounts();
  } else if (event.type === 'candidate' && isReference(event.reference)) {
    refs.set(event.reference.id, event.reference); scene.add(event.reference);
    updateSourceCounts();
    timingLabel = 'live';
    scene.highlight([...picks, ...astraPicks], pins);
  } else if (event.type === 'retrieval-complete') latest.retrievalMs ??= event.atMs;
  else if (event.type === 'discovery') {
    timingLabel = 'live'; updateSourceCounts();
    if (event.phase === 'complete' && event.round === 1) latest.firstBatchMs = event.atMs;
    if (event.phase === 'complete') { latest.totalMs = Math.round(performance.now() - started); updateRecord(); }
  }
  else if (event.type === 'shortlist') { picks = event.ids; scene.highlight([...picks, ...astraPicks], pins); latest.selected = [...new Set([...pins, ...picks, ...astraPicks])]; }
  else if (event.type === 'curation') { astraPicks = event.ids; scene.highlight([...picks, ...astraPicks], pins); latest.selected = [...new Set([...pins, ...picks, ...astraPicks])]; $('curation-summary').textContent = `Astra: ${event.summary}`; $('curation-summary').hidden = false; }
  else if (event.type === 'notice') showMessage(event.message, false, true);
  else if (event.type === 'end' || event.type === 'error') {
    latest.status = event.type === 'error' ? 'error' : event.status;
    if (event.type === 'error') showMessage(event.message, true, true);
    else if (latest.continuous) showMessage(event.message, false, true);
  }
}

async function explore() {
  if (busy || !form.reportValidity()) return;
  if (!configured) {
    if (localMode) { $<HTMLDetailsElement>('connections').open = true; $('jev-key').focus(); showMessage('Add your Jev API key to start.'); }
    else showMessage('The image search is not connected yet. Refresh to try again.', true);
    return;
  }
  const brief = prompt.value.trim();
  if (brief.length < 8) { showMessage('Add a subject to your prompt.', true); return; }
  saveDraft(); busy = true; stopped = false; savedView = false; recordedBrowserFrames = 0;
  showMessage('');
  scene.clear(); scene.reset(); picks = []; astraPicks = []; $('curation-summary').hidden = true;
  updateSourceCounts();
  $('empty-message').hidden = false; $('empty-message').textContent = media === 'videos' ? 'Finding short films in the archive…' : media === 'both' ? 'Finding images and short films…' : 'Collecting a mix from all three sources…';
  abort = new AbortController(); started = performance.now();
  latest = { startedAt: new Date().toISOString(), mode: 'creator', continuous: true, brief, styles: [...styles], media, status: 'running', totalMs: 0, firstImageMs: null, retrievalMs: null, events: [], selected: [...pins], pinned: [...pins] };
  const run = latest, runStyles = [...styles], runPins = [...pins];
  const signal = abort.signal;
  const runOpenaiKey = $<HTMLInputElement>('use-astra').checked ? openaiKey : '';
  let curationTask: Promise<void> | undefined;
  const receive = (event: ResearchEvent) => {
    eventReceived(event);
    if (event.type === 'retrieval-complete' && runOpenaiKey && !curationTask) {
      const references = run.events.filter((item): item is Extract<ResearchEvent, { type: 'candidate' }> => item.type === 'candidate').slice(0, 100).map(({ reference: ref }) => ({ id: ref.id, title: ref.title.slice(0, 200), description: ref.description.slice(0, 600), sourceName: ref.sourceName }));
      if (!references.length) return;
      $('curation-summary').hidden = false; $('curation-summary').textContent = 'Astra is curating the first batch…';
      curationTask = (async () => {
        try {
          const result = await curateWithAstra(styledBrief(brief, runStyles), references, runOpenaiKey, signal);
          if (!signal.aborted && latest === run) eventReceived({ type: 'curation', atMs: Math.round(performance.now() - started), ...result });
        } catch (error) {
          if (!signal.aborted && latest === run) $('curation-summary').textContent = error instanceof Error ? error.message : 'Astra could not finish. Your images are kept.';
        }
      })();
    }
  };
  panelOpen(false); $('status-toast').hidden = true;
  updateControls(); showTiming(0, 'searching');
  const clock = setInterval(() => showTiming(performance.now() - started), 40);
  try {
    let cursor: DiscoveryCursor | undefined;
    do {
    const response = await fetch('/api/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'creator', continuous: true, brief, styles: runStyles, media: run.media, selected: runPins, ...(hosted ? { cursor } : {}) }), signal });
    cursor = undefined;
    if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'The search could not start.'); }
    if (!response.body) throw new Error('Live results are unavailable. Try refreshing the page.');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      pending += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, at); pending = pending.slice(at + 1);
        if (line) {
          const event = JSON.parse(line) as ResearchEvent;
          if (event.type === 'continuation') cursor = event.cursor;
          else receive(hosted ? { ...event, atMs: Math.round(performance.now() - started) } : event);
        }
      }
    }
    if (hosted && cursor && !signal.aborted && latest.status === 'running') await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 1200);
      signal.addEventListener('abort', cancel, { once: true });
    });
    } while (hosted && cursor && !signal.aborted && latest.status === 'running');
    await curationTask;
    if (latest.status === 'running') throw new Error('The search ended early. Images already found are kept.');
  } catch (error) {
    latest.status = stopped ? 'stopped' : 'error';
    showMessage(stopped ? 'Search stopped. Your references are kept.' : error instanceof Error ? error.message : 'The search could not finish.', !stopped, true);
  } finally {
    clearInterval(clock); busy = false; latest.totalMs = Math.round(performance.now() - started);
    if (signal.aborted && curationTask && !astraPicks.length) $('curation-summary').textContent = 'Astra review stopped.';
    const count = latest.events.filter(event => event.type === 'candidate').length;
    showTiming(latest.totalMs, latest.status === 'error' ? 'search interrupted' : latest.status === 'stopped' ? 'stopped' : 'complete');
    if (latest.status !== 'error' && latest.status !== 'stopped') showMessage('Try another style with the same prompt.');
    if (!count) { $('empty-message').hidden = false; $('empty-message').textContent = 'Try another direction.'; }
    else $('empty-message').hidden = true;
    scene.highlight([...picks, ...astraPicks], pins); updateControls(); remember();
  }
}

for (const style of VISUAL_STYLES) {
  const label = document.createElement('label'); label.className = 'style-option'; label.title = style.description;
  const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'visual-style'; input.value = style.id;
  const text = document.createElement('span'); text.textContent = style.label;
  input.addEventListener('change', () => { styles = [...document.querySelectorAll<HTMLInputElement>('[name=visual-style]:checked')].map(item => item.value); saveDraft(); updateControls(); });
  label.append(input, text); $('styles').append(label);
}

const previous = read(localStorage, 'jev-curator-space') || read(localStorage, 'jev-curator-board');
prompt.value = typeof previous?.brief === 'string' ? previous.brief : CREATOR_BRIEFS.garden;
try { styles = validateStyles(previous?.styles); } catch { styles = []; }
try { media = validateMedia(previous?.media); } catch { media = 'images'; }
if (Array.isArray(previous?.references)) for (const ref of previous.references) if (isReference(ref)) refs.set(ref.id, ref);
if (Array.isArray(previous?.pins)) pins = [...new Set<string>(previous.pins.filter((id: unknown) => typeof id === 'string' && refs.has(id)))].slice(0, BOARD_SIZE);
const savedHistory = read(localStorage, 'jev-curator-explorations');
if (Array.isArray(savedHistory)) history = savedHistory.filter(item => typeof item?.id === 'string' && Array.isArray(item.latest?.events)).slice(0, 12);
const preview = read(sessionStorage, 'jev-curator-live-preview');
if (preview?.latest?.mode === 'creator' && Array.isArray(preview.latest.events)) restore({ ...preview.latest, firstImageMs: preview.firstImageMs ?? preview.latest.firstImageMs, retrievalMs: preview.retrievalMs ?? preview.latest.retrievalMs }, false);
else { $('empty-message').hidden = false; panelOpen(true); }
drawHistory(); updateControls();

form.addEventListener('submit', event => {
  event.preventDefault();
  if (busy) { stopped = true; abort?.abort(); return; }
  void explore();
});
prompt.addEventListener('input', saveDraft);
for (const id of ['media-images', 'media-videos']) $(id).addEventListener('change', () => {
  const images = $<HTMLInputElement>('media-images').checked, videos = $<HTMLInputElement>('media-videos').checked;
  if (!images && !videos) { updateControls(); return; }
  media = images && videos ? 'both' : videos ? 'videos' : 'images';
  updateControls(); updateSourceCounts(); saveDraft();
});
window.addEventListener('pagehide', () => abort?.abort());
prompt.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); form.requestSubmit(); } });
$('space').addEventListener('pointerdown', () => panelOpen(false));
document.addEventListener('keydown', event => { if (event.key === 'Escape') panelOpen(false); });
$('close-asset').addEventListener('click', () => $<HTMLDialogElement>('asset-dialog').close());
$('asset-dialog').addEventListener('close', () => {
  const video = $<HTMLVideoElement>('asset-video'); video.pause(); video.removeAttribute('src'); video.load();
  scene.setInspecting(false);
});
$('asset-dialog').addEventListener('click', event => { if (event.target === $('asset-dialog')) $<HTMLDialogElement>('asset-dialog').close(); });
$('pin-asset').addEventListener('click', () => {
  if (!detail || busy) return;
  if (pins.includes(detail.id)) pins = pins.filter(id => id !== detail!.id);
  else if (pins.length < BOARD_SIZE) pins.push(detail.id);
  else { showMessage('You have six kept assets. Unpin one before keeping another.', true, true); return; }
  $('pin-asset').textContent = pins.includes(detail.id) ? 'Unpin' : 'Keep'; scene.highlight(picks, pins); saveDraft();
});
$('saved-searches').addEventListener('change', () => { const item = history.find(run => run.id === $<HTMLSelectElement>('saved-searches').value); if (item) { restore({ ...item.latest, firstImageMs: item.firstImageMs, retrievalMs: item.retrievalMs }, true, item.renderedFrames || 0); panelOpen(false); } });
$('raw-record').closest('details')!.addEventListener('toggle', updateRecord);
$('export-run').addEventListener('click', () => {
  if (!latest) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(latest, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `jev-space-${latest.startedAt.replace(/[:.]/g, '-')}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function connectStatus() {
  try {
    const response = await fetch('/api/status', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error();
    const result = await response.json();
    localMode = ['localhost', '127.0.0.1'].includes(location.hostname) && result.hosted !== true;
    hosted = !localMode;
    localConfigured = localMode && result.configured === true;
    configured = localConfigured || (hosted && result.searchAvailable === true);
    $('legacy-link').hidden = hosted;
    if (!hosted) $('key-privacy').textContent = 'This local app saves your Jev key on this Mac. Your optional OpenAI key stays in this tab and is sent directly to OpenAI. API usage is billed to your accounts.';
    if (!configured && localMode) { panelOpen(true); $<HTMLDetailsElement>('connections').open = true; showMessage('Connect Jev to search for assets.'); }
    if (hosted) $('search-method').textContent = 'Explore searches public collections using phrases from your prompt and styles. Jev is available in the local app. Saved searches replay their recorded results and time.';
  } catch { showMessage('The server is unavailable. Refresh to try again.', true, true); }
  updateControls();
}

$('key-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !localMode) return; const field = $<HTMLInputElement>('jev-key'); const key = field.value.trim(); field.value = '';
  const button = $<HTMLButtonElement>('connect-key'); button.disabled = true; $('key-status').textContent = 'Checking…';
  try {
    const response = await fetch('/api/connect-jev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }), signal: AbortSignal.timeout(25000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'The key could not be connected.');
    localConfigured = true;
    configured = true; $('key-status').textContent = 'Jev connected on this Mac'; showMessage('Ready. Explore your prompt.'); updateControls();
  } catch (error) { $('key-status').textContent = error instanceof Error ? error.message : 'The connection failed.'; }
  finally { button.disabled = false; }
});
$('openai-form').addEventListener('submit', event => {
  event.preventDefault(); if (busy) return;
  const field = $<HTMLInputElement>('openai-key');
  try {
    openaiKey = providerKey(field.value, 'OpenAI'); field.value = '';
    $<HTMLInputElement>('use-astra').checked = true;
    $('openai-status').textContent = 'Key set for this tab. Access is checked on your next review.'; updateControls();
  } catch (error) { $('openai-status').textContent = error instanceof Error ? error.message : 'The key could not be read.'; }
});
$('clear-keys').addEventListener('click', () => {
  if (busy) return;
  openaiKey = '';
  $<HTMLInputElement>('use-astra').checked = false;
  $<HTMLInputElement>('jev-key').value = ''; $<HTMLInputElement>('openai-key').value = '';
  $('key-status').textContent = 'Tab keys cleared.'; $('openai-status').textContent = ''; updateControls();
});
void connectStatus();
