import './style.css';
import './pitch-theme.css';
import catalogData from './catalog.json';
import { DIRECTIONS, CREATOR_BRIEFS, findDirection } from './presets';
import { BOARD_SIZE, NO_MATCH } from './decision';
import { DEFAULT_SEARCHES, SOURCE_KEYS, SOURCE_NAMES, SOURCE_METHODS, REFERENCES_PER_SOURCE, CREATOR_TARGET, searchUrl } from './sources';
import type { Reference, ResearchEvent, SourceKey, SourceProgress, Decision, Review } from './types';

const catalog = catalogData as Reference[];
const byId = new Map(catalog.map(ref => [ref.id, ref]));
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const brief = $<HTMLTextAreaElement>('brief');
brief.value = CREATOR_BRIEFS[DIRECTIONS[0].id];
let activeDirection = DIRECTIONS[0].id;
let batchRunning = false, batchStopped = false;
let pins: string[] = [], board: string[] = [];
let busy = false, configured = false, astraAvailable = false, stopped = false;
let activeStage = 'idle';
let runStart = 0;
let stageStart = 0;
let stageMessage = '';
let waitingForAstra = false;
let abort: AbortController | null = null;
let shownReference: string | null = null;
let expandedSource: SourceKey | null = null;
let renderedFrames = 0;
type RunState = { startedAt: string; mode: string; brief: string; status: string; totalMs: number; events: ResearchEvent[]; selected: string[]; pinned: string[] };
let latest: RunState | null = null;
const sourceStates = new Map<SourceKey, SourceProgress>();
const sourceStarted = new Map<SourceKey, number>();
const sourceRefs = new Map<SourceKey, string[]>(SOURCE_KEYS.map(key => [key, []]));
const frames = new Map<SourceKey, { image: string; url: string; atMs: number }>();
const frameCounts = new Map<SourceKey, number>();
const reviews: Review[] = [];
const decisions: Decision[] = [];
const jevPasses: Extract<ResearchEvent, { type: 'search-plan' | 'shortlist' }>[] = [];
const highlighted = new Set<string>();
const resultLimit = () => latest?.mode && latest.mode !== 'creator' ? REFERENCES_PER_SOURCE : CREATOR_TARGET;
const jevCallCount = () => decisions.length + jevPasses.length;
const candidateButtons = new Map<string, HTMLButtonElement>();
let firstResultMs: number | null = null;
let firstImageMs: number | null = null;
let retrievalMs: number | null = null;
type SavedExploration = {
  id: string; title: string; latest: RunState;
  firstImageMs: number | null; retrievalMs: number | null; renderedFrames: number;
  frames: [SourceKey, { image: string; url: string; atMs: number }][];
  frameCounts: [SourceKey, number][];
};
let explorations: SavedExploration[] = [];
try {
  const saved = JSON.parse(localStorage.getItem('jev-curator-explorations') || '[]');
  if (Array.isArray(saved)) explorations = saved.filter(item => typeof item?.title === 'string' && item?.latest?.events && Array.isArray(item.frames)).slice(0, 12);
} catch { /* The current run remains available when saved history is unavailable. */ }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
}
function seconds(ms: number) { return `${(ms / 1000).toFixed(2)} s`; }
function safeLink(value: string) { try { return new URL(value).protocol === 'https:' ? value : '#'; } catch { return '#'; } }
function setClock(ms: number) { $('stage-clock').replaceChildren(document.createTextNode((ms / 1000).toFixed(2)), el('span', undefined, 's')); }
function message(text: string, error = false) {
  $('feedback').textContent = text; $('feedback').classList.toggle('error', error);
  $('prompt-status').hidden = false; $('prompt-status').textContent = text; $('prompt-status').classList.toggle('error', error);
}

// Observe a stationary anchor so docking the clock cannot trigger layout oscillation.
const clockDock = new IntersectionObserver(([entry]) => {
  $('master-clock').classList.toggle('is-docked', entry.boundingClientRect.top < 16);
}, { threshold: [0, 1], rootMargin: '-16px 0px 0px 0px' });
clockDock.observe($('clock-anchor'));

function revealCandidate(button: HTMLButtonElement) {
  if (button.dataset.imageReady !== 'true' || button.dataset.inView !== 'true') return;
  button.classList.add('is-revealed');
  imageVisibility.unobserve(button);
  if (busy && button.dataset.run === latest?.startedAt && firstImageMs === null) {
    firstImageMs = Math.round(performance.now() - runStart); renderMetrics();
  }
}
const imageVisibility = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const button = entry.target as HTMLButtonElement;
    button.dataset.inView = String(entry.isIntersecting);
    if (entry.isIntersecting) revealCandidate(button);
  }
}, { threshold: .05 });

try {
  const saved = JSON.parse(localStorage.getItem('jev-curator-board') || 'null');
  if (Array.isArray(saved?.references)) for (const ref of saved.references) if (ref?.id && typeof ref.image === 'string' && typeof ref.title === 'string') byId.set(ref.id, ref);
  if (Array.isArray(saved?.pins)) pins = [...new Set(saved.pins.filter((id: unknown) => typeof id === 'string' && byId.has(id)))] .slice(0, BOARD_SIZE) as string[];
  if (Array.isArray(saved?.board)) board = [...new Set([...pins, ...saved.board.filter((id: unknown) => typeof id === 'string' && byId.has(id))])] .slice(0, BOARD_SIZE) as string[];
  if (typeof saved?.brief === 'string' && saved.brief.length <= 2000) brief.value = saved.brief;
} catch { /* Local storage is optional. */ }
const initialDirection = findDirection(brief.value);
activeDirection = initialDirection?.id || '';
if (initialDirection) brief.value = CREATOR_BRIEFS[initialDirection.id];
$('mission-title').textContent = initialDirection?.title || 'Your next visual';
$('mission-subtitle').textContent = initialDirection?.detail || 'Describe what you’re making. Find the assets to match.';
function save() { try { localStorage.setItem('jev-curator-board', JSON.stringify({ pins, board, brief: brief.value, references: board.map(id => byId.get(id)) })); } catch { /* The board still works without storage. */ } }
function savePreview() {
  if (!latest) return;
  try { sessionStorage.setItem('jev-curator-live-preview', JSON.stringify({ latest, frames: [...frames], frameCounts: [...frameCounts], renderedFrames, firstImageMs, retrievalMs })); } catch { /* A large capture may exceed browser storage. */ }
}

function saveExploration() {
  if (!latest || !latest.events.some(event => event.type === 'candidate')) return;
  const direction = findDirection(latest!.brief);
  const item: SavedExploration = structuredClone({ id: latest.startedAt, title: direction?.title || 'Custom exploration', latest, firstImageMs, retrievalMs, renderedFrames, frames: [...frames], frameCounts: [...frameCounts] });
  explorations = [item, ...explorations.filter(other => other.id !== item.id)].slice(0, 12);
  try { localStorage.setItem('jev-curator-explorations', JSON.stringify(explorations)); }
  catch {
    // Keep the references and measured run records even if captures exceed browser storage.
    try { localStorage.setItem('jev-curator-explorations', JSON.stringify(explorations.map(saved => ({ ...saved, frames: [] })))); } catch { /* Results remain in this tab. */ }
  }
  renderExplorations();
}
function renderExplorations() {
  $('explorations').hidden = !explorations.length;
  $('exploration-list').replaceChildren();
  for (const item of explorations) {
    const button = el('button', 'exploration-card'); button.type = 'button'; button.dataset.exploration = item.id;
    button.disabled = busy || batchRunning; button.setAttribute('aria-label', `View ${item.title} result`);
    button.setAttribute('aria-pressed', String(latest?.startedAt === item.id));
    const images = el('span', 'exploration-images');
    for (const key of SOURCE_KEYS) {
      const event = item.latest.events.find(event => event.type === 'candidate' && event.source === key);
      if (event?.type === 'candidate') { const img = el('img'); img.src = safeLink(event.reference.image); img.alt = `${SOURCE_NAMES[key]} reference`; img.loading = 'lazy'; images.append(img); }
    }
    const count = item.latest.events.filter(event => event.type === 'candidate').length;
    button.append(images, el('strong', undefined, item.title), el('span', 'exploration-meta', `${count} refs · ${seconds(item.latest.totalMs)} total · ${item.latest.status === 'error' ? 'incomplete' : item.latest.status === 'stopped' ? 'stopped' : 'saved'}`));
    button.addEventListener('click', () => { if (!busy && !batchRunning) { restoreExploration(item, true); renderExplorations(); savePreview(); } });
    $('exploration-list').append(button);
  }
}

function restoreExploration(saved: Omit<SavedExploration, 'id' | 'title'>, restorePrompt = false) {
  resetWindows(); latest = structuredClone(saved.latest);
  for (const event of latest.events) if (event.type === 'candidate') byId.set(event.reference.id, event.reference);
  board = [...new Set([...pins, ...latest.selected])].filter(id => byId.has(id)).slice(0, BOARD_SIZE);
  for (const event of latest.events) handleEvent(event, true);
  latest.totalMs = saved.latest.totalMs;
  for (const [key, frame] of saved.frames) if (SOURCE_KEYS.includes(key) && typeof frame.image === 'string' && frame.image.startsWith('data:image/jpeg;base64,')) applyFrame(key, frame);
  for (const [key, count] of saved.frameCounts || []) frameCounts.set(key, count);
  renderedFrames = saved.renderedFrames || 0; firstImageMs = saved.firstImageMs ?? null; retrievalMs = saved.retrievalMs ?? retrievalMs;
  if (restorePrompt) {
    brief.value = latest.brief;
    const direction = findDirection(latest!.brief);
    $('mission-title').textContent = direction?.title || 'Your exploration';
    $('mission-subtitle').textContent = direction?.detail || 'Your prompt. Three places to look.';
    document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.preset === direction?.id)));
  }
  activeStage = 'idle'; $('live-stage').dataset.active = 'idle'; $('live-stage').dataset.mode = latest.mode;
  setClock(latest.mode === 'sources' && retrievalMs !== null ? retrievalMs : latest.totalMs);
  $('clock-label').textContent = latest.mode === 'sources' && retrievalMs !== null ? 'Saved reference retrieval' : 'Saved run / recorded time';
  $('capture-label').textContent = `Saved result / ${seconds(latest.totalMs)} total`;
  if (latest.status !== 'error') message('Saved result. Press Find assets to search the sources again.');
  $('run-status').textContent = `${reviews.length} Astra stages / ${jevCallCount()} Jev calls / saved ${latest.status}`;
  for (const key of SOURCE_KEYS) {
    $(`${key}-browser-status`).textContent = frames.has(key) ? 'Previous browser capture' : 'Saved search / open source above';
    if (!frames.has(key)) $(`${key}-placeholder`).lastElementChild!.textContent = 'Saved search / open source above';
  }
  renderMetrics(); renderBoard(); updateCandidateStates(); updateButtons(); $('raw-record').textContent = JSON.stringify(record(), null, 2);
}

function showReference(ref: Reference) {
  shownReference = ref.id;
  const image = $<HTMLImageElement>('detail-image'); image.src = safeLink(ref.image); image.alt = ref.title;
  $('detail-title').textContent = ref.title; $('detail-description').textContent = ref.description;
  $('detail-collection').textContent = `${ref.sourceName} / ${ref.collection}`;
  $('detail-provenance').textContent = ref.descriptionOrigin;
  $('detail-credit').textContent = `${ref.credit} / ${ref.date}${ref.retrievedAt ? ` / Retrieved ${new Date(ref.retrievedAt).toLocaleTimeString()}` : ''}`;
  $<HTMLAnchorElement>('detail-source').href = safeLink(ref.source);
  const button = $<HTMLButtonElement>('detail-pin'); button.textContent = pins.includes(ref.id) ? 'Unpin reference' : 'Pin reference'; button.disabled = busy;
  $<HTMLDialogElement>('reference-dialog').showModal();
}
function pin(id: string) {
  if (busy) return;
  if (pins.includes(id)) { pins = pins.filter(value => value !== id); message('Unpinned. This reference can change on the next run.'); }
  else {
    if (pins.length >= BOARD_SIZE) return message('All six places are pinned. Unpin a reference first.');
    pins.push(id);
    if (!board.includes(id)) {
      if (board.length >= BOARD_SIZE) board = board.filter(value => value !== board.find(other => !pins.includes(other)));
      board.push(id);
    }
    message('Pinned by you. This reference will stay when the brief changes.');
  }
  if (shownReference === id) $('detail-pin').textContent = pins.includes(id) ? 'Unpin reference' : 'Pin reference';
  save(); renderBoard(); updateButtons(); updateCandidateStates();
}
function referenceCard(ref: Reference, selected = false) {
  const card = el('article', `board-card${selected ? ' just-selected' : ''}`); card.dataset.reference = ref.id;
  const picture = el('div', 'board-picture'); const open = el('button'); open.type = 'button'; open.setAttribute('aria-label', `Open reference: ${ref.title}`);
  const img = el('img'); img.src = safeLink(ref.image); img.alt = ref.title; img.loading = 'lazy'; open.append(img); open.addEventListener('click', () => showReference(ref));
  const toggle = el('button', 'pin-button', pins.includes(ref.id) ? 'Pinned' : '+ Pin'); toggle.type = 'button'; toggle.disabled = busy; toggle.setAttribute('aria-label', `${pins.includes(ref.id) ? 'Unpin' : 'Pin'} ${ref.title}`); toggle.setAttribute('aria-pressed', String(pins.includes(ref.id))); toggle.addEventListener('click', () => pin(ref.id));
  picture.append(open, toggle); card.append(picture, el('h3', undefined, ref.title), el('p', undefined, ref.sourceName)); return card;
}
function renderBoard(newId?: string) {
  const container = $('board'); container.replaceChildren();
  const roles = reviews.at(-1)?.roles || [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const ref = byId.get(board[i]);
    if (ref) container.append(referenceCard(ref, ref.id === newId));
    else { const slot = el('div', 'empty-slot'); slot.append(el('span', undefined, String(i + 1).padStart(2, '0')), el('strong', undefined, roles[i] || 'A reference goes here'), el('small', undefined, busy ? activeStage === 'astra' ? 'Astra is directing' : activeStage === 'sources' ? 'Collecting from sources' : 'Waiting for Jev' : 'Choose from the incoming images')); container.append(slot); }
  }
  $('board-count').textContent = `${board.length} / ${BOARD_SIZE}`;
  $('saved-count').textContent = `${board.length} saved`;
  $('pin-count').textContent = `${pins.length} pinned by you`;
  $<HTMLButtonElement>('clear-pins').disabled = busy || !pins.length;
  if ($('archive-gallery').children.length) $('archive-gallery').replaceChildren(...catalog.map(ref => referenceCard(ref)));
}
function updateButtons() {
  $<HTMLButtonElement>('run').disabled = busy || !configured;
  $('run-label').textContent = busy ? activeStage === 'jev' ? 'Jev is choosing…' : 'Finding assets…' : 'Find assets';
  $<HTMLButtonElement>('sources-only').disabled = busy;
  $<HTMLButtonElement>('connect-open').disabled = busy;
  $('sources-only').textContent = busy ? retrievalMs === null ? 'Searching…' : 'Images ready' : 'Search displayed queries ↗';
  $('stop').hidden = !busy; $('clock-stop').hidden = !busy;
  brief.disabled = false;
  $<HTMLButtonElement>('run-six').disabled = busy || batchRunning || !configured;
  const remaining = DIRECTIONS.filter(direction => !explorations.some(item => findDirection(item.latest.brief)?.id === direction.id && item.latest.mode === 'creator' && ['complete', 'no-match'].includes(item.latest.status))).length;
  $('run-six').textContent = remaining > 0 && remaining < DIRECTIONS.length ? `Run ${remaining} remaining directions` : 'Run all six directions';
  document.querySelectorAll<HTMLButtonElement>('[data-exploration]').forEach(button => { button.disabled = busy || batchRunning; });
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => { button.disabled = busy; });
  document.querySelectorAll<HTMLInputElement>('.query-input').forEach(input => { input.disabled = busy; });
  $<HTMLButtonElement>('export').disabled = busy || !latest;
}

function buildWindows() {
  for (const key of SOURCE_KEYS) {
    const window = el('article', 'source-window'); window.dataset.source = key; window.dataset.live = 'false'; window.id = `window-${key}`;
    const top = el('div', 'window-top'); top.append(el('span', 'source-logo', key === 'cosmos' ? '✳' : key === 'met' ? 'Met' : 'N'), el('h2', undefined, SOURCE_NAMES[key]));
    const clock = el('span', 'source-clock', '0.00 s'); clock.id = `${key}-clock`;
    const expand = el('button', undefined, '⤢'); expand.type = 'button'; expand.setAttribute('aria-label', `Enlarge ${SOURCE_NAMES[key]} browser view`); expand.addEventListener('click', () => expandBrowser(key)); top.append(clock, expand);
    const address = el('a', 'window-address', new URL(searchUrl(key, DEFAULT_SEARCHES[key])).hostname); address.href = searchUrl(key, DEFAULT_SEARCHES[key]); address.target = '_blank'; address.rel = 'noreferrer'; address.id = `${key}-address`;
    const query = el('div', 'query-line'); const queryText = el('input', 'query query-input'); queryText.value = DEFAULT_SEARCHES[key]; queryText.id = `${key}-query`; queryText.maxLength = 100; queryText.minLength = 2; queryText.setAttribute('aria-label', `${SOURCE_NAMES[key]} search`); query.append(el('span', undefined, '⌕'), queryText);
    const view = el('button', 'browser-viewport'); view.type = 'button'; view.setAttribute('aria-label', `Enlarge ${SOURCE_NAMES[key]} live browser`); view.addEventListener('click', () => expandBrowser(key));
    const image = el('img'); image.id = `${key}-frame`; image.alt = `Actual ${SOURCE_NAMES[key]} browser capture`; image.hidden = true;
    const placeholder = el('div', 'window-placeholder'); placeholder.id = `${key}-placeholder`; placeholder.append(el('span', 'placeholder-orbit'), el('strong', undefined, SOURCE_NAMES[key]), el('span', undefined, 'Ready to open a live search'));
    view.append(image, placeholder);
    const state = el('div', 'window-state'); const stateText = el('span', undefined, 'Browser has not opened'); stateText.id = `${key}-browser-status`; state.append(stateText);
    const incoming = el('div', 'incoming-label'); const count = el('span', undefined, `0 / ${resultLimit()}`); count.id = `${key}-count`; incoming.append(el('span', undefined, 'Assets'), count);
    const strip = el('div', 'incoming-strip'); strip.id = `${key}-incoming`; strip.append(el('span', 'empty-strip', 'Images appear as results arrive'));
    const footer = el('div', 'source-footer'); const first = el('span', undefined, 'First reference: —'); first.id = `${key}-first`; footer.append(first, el('span', undefined, key === 'cosmos' ? 'Public search page' : 'Public collection API'));
    window.append(top, address, query, view, state, incoming, strip, footer); $('source-windows').append(window);
  }
}
function expandBrowser(key: SourceKey) {
  const frame = frames.get(key);
  if (!frame) { message('The browser view appears when a live run opens this source.'); return; }
  expandedSource = key;
  $('browser-title').textContent = SOURCE_NAMES[key];
  $<HTMLImageElement>('browser-image').src = frame.image;
  $<HTMLAnchorElement>('browser-link').href = safeLink(frame.url);
  $('browser-capture-status').textContent = `${busy ? 'Live capture' : 'Last capture'} at ${seconds(frame.atMs)}`;
  $<HTMLDialogElement>('browser-dialog').showModal();
}
function applyFrame(key: SourceKey, frame: { image: string; url: string; atMs: number }) {
  frames.set(key, frame);
  const img = $<HTMLImageElement>(`${key}-frame`); img.src = frame.image; img.hidden = false; $(`${key}-placeholder`).hidden = true;
  const address = $<HTMLAnchorElement>(`${key}-address`); address.href = safeLink(frame.url); address.textContent = frame.url.replace(/^https:\/\//, ''); address.title = frame.url;
  $(`window-${key}`).dataset.live = String(busy);
  if (expandedSource === key && $<HTMLDialogElement>('browser-dialog').open) {
    $<HTMLImageElement>('browser-image').src = frame.image; $<HTMLAnchorElement>('browser-link').href = safeLink(frame.url);
    $('browser-capture-status').textContent = `${busy ? 'Live capture' : 'Last capture'} at ${seconds(frame.atMs)}`;
  }
}
function addCandidate(key: SourceKey, ref: Reference) {
  byId.set(ref.id, ref);
  if (sourceRefs.get(key)!.includes(ref.id)) return;
  sourceRefs.get(key)!.push(ref.id);
  const strip = $(`${key}-incoming`); strip.querySelector('.empty-strip')?.remove();
  const button = el('button', 'candidate'); button.type = 'button'; button.dataset.reference = ref.id; button.dataset.run = latest?.startedAt || ''; button.title = ref.title; button.setAttribute('aria-label', `Inspect ${SOURCE_NAMES[key]} reference: ${ref.title}`);
  const img = el('img'); img.alt = ref.title; img.decoding = 'async';
  img.addEventListener('load', () => {
    button.dataset.imageReady = 'true'; revealCandidate(button);
  }, { once: true });
  img.addEventListener('error', () => { img.hidden = true; button.classList.add('image-error'); button.append(el('span', 'image-unavailable', 'Image unavailable · open reference')); }, { once: true });
  img.src = safeLink(ref.image);
  const label = el('span', 'candidate-state', 'Kept'); button.append(img, label); button.addEventListener('click', () => showReference(ref)); strip.append(button); candidateButtons.set(ref.id, button);
  imageVisibility.observe(button);
}
function updateCandidateStates() {
  const finishedSelection = !busy && decisions.length > 0 && !['error', 'stopped'].includes(latest?.status || '');
  for (const [id, button] of candidateButtons) {
    button.dataset.state = highlighted.has(id) || board.includes(id) ? 'selected' : finishedSelection ? 'not-selected' : 'pending';
    button.querySelector('.candidate-state')!.textContent = highlighted.has(id) ? 'Jev pick' : pins.includes(id) ? 'Pinned' : 'Kept';
    button.style.order = latest?.mode === 'creator' && highlighted.has(id) ? '-1' : '';
  }
}
function log(atMs: number, actor: string, text: string) {
  $('event-log').querySelector('.empty-log')?.remove();
  const item = el('li'); item.append(el('time', undefined, seconds(atMs)), el('strong', undefined, actor), el('span', undefined, text)); $('event-log').prepend(item);
  while ($('event-log').children.length > 120) $('event-log').lastChild?.remove();
}
function renderMetrics() {
  const sorted = [...decisions, ...jevPasses].map(decision => decision.roundTripMs).sort((a, b) => a - b);
  const n = sorted.length; const median = n ? n % 2 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : null;
  $('latency').textContent = median === null ? '—' : `${Math.round(median)} ms`;
  $('first-result').textContent = firstResultMs === null ? '—' : seconds(firstResultMs);
  $('first-image').textContent = firstImageMs === null ? '—' : seconds(firstImageMs);
  $('frame-count').textContent = String(renderedFrames);
  const count = [...sourceRefs.values()].reduce((total, ids) => total + ids.length, 0); $('source-total').textContent = `${count} found`;
  $('clock-count').textContent = latest?.mode === 'creator' && highlighted.size ? `${count} assets / ${highlighted.size} Jev picks` : `${count} / ${latest?.mode === 'creator' ? CREATOR_TARGET : resultLimit() * SOURCE_KEYS.length} assets`;
}
function animateSelection(id: string) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const from = candidateButtons.get(id); const to = Array.from($('board').children).find(node => (node as HTMLElement).dataset.reference === id)?.querySelector('img');
  if (!from || !to) return;
  const start = from.getBoundingClientRect(), end = to.getBoundingClientRect();
  if (!end.width || !end.height) return;
  const strip = from.parentElement!.getBoundingClientRect();
  if (start.left < strip.left || start.right > strip.right) from.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' });
  const rect = from.getBoundingClientRect();
  const ghost = el('img', 'moving-reference'); ghost.src = safeLink(byId.get(id)!.image); ghost.alt = '';
  Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }); document.body.append(ghost);
  ghost.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${end.left - rect.left}px,${end.top - rect.top}px) scale(${end.width / rect.width},${end.height / rect.height})`, opacity: .85 }], { duration: 480, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished.finally(() => ghost.remove());
}

function handleEvent(event: ResearchEvent, restoring = false) {
  if (event.type === 'frame') {
    renderedFrames++; frameCounts.set(event.source, (frameCounts.get(event.source) || 0) + 1); applyFrame(event.source, event); renderMetrics(); return;
  }
  if (latest && !restoring) latest.events.push(event);
  if (event.type === 'stage') {
    stageStart = performance.now(); stageMessage = event.message;
    waitingForAstra = event.stage === 'astra' && (reviews.length === 0 || decisions.length >= 3);
    activeStage = event.stage; $('live-stage').dataset.active = event.stage; $('stage-status').textContent = event.message;
    message(event.message);
    if (busy) $('clock-label').textContent = event.stage === 'astra' ? 'Astra directing / real time' : event.stage === 'jev' ? 'Jev selecting / real time' : 'Searching / real time';
    if (event.stage === 'astra') $('astra-action').textContent = 'Directing';
    if (event.stage === 'jev') $('jev-action').textContent = 'Choosing from live results';
    if (event.stage === 'sources') $('sources-action').textContent = 'Live search';
    log(event.atMs, event.stage === 'astra' ? 'Astra' : event.stage === 'jev' ? 'Jev' : 'Sources', event.message);
    updateButtons(); renderBoard();
  } else if (event.type === 'review') {
    waitingForAstra = false;
    reviews.push(event.review); $('astra-time').textContent = seconds(event.review.durationMs); $('astra-action').textContent = event.review.stage === 'plan' ? 'Direction ready' : 'Board reviewed'; $('astra-summary').textContent = event.review.summary;
    log(event.atMs, 'Astra', event.review.summary); renderBoard();
  } else if (event.type === 'source') {
    const state = event.source; if (state.key === 'archive') return;
    const previous = sourceStates.get(state.key);
    sourceStates.set(state.key, state); sourceStarted.set(state.key, performance.now() - state.elapsedMs);
    $<HTMLInputElement>(`${state.key}-query`).value = state.query;
    $(`${state.key}-clock`).textContent = seconds(state.elapsedMs);
    $(`${state.key}-count`).textContent = `${state.found} / ${resultLimit()}`;
    $(`${state.key}-first`).textContent = state.firstResultMs === undefined ? 'First reference: —' : `First reference: ${seconds(state.firstResultMs)}`;
    if (!frames.has(state.key)) { const link = $<HTMLAnchorElement>(`${state.key}-address`); link.href = state.url; link.textContent = state.url.replace(/^https:\/\//, ''); }
    if (!previous) log(event.atMs, SOURCE_NAMES[state.key], `Search: ${state.query}`);
    if (state.status !== previous?.status && state.status === 'ready') log(event.atMs, SOURCE_NAMES[state.key], `${state.found} references collected in ${seconds(state.elapsedMs)}`);
    if (state.status === 'error') { log(event.atMs, SOURCE_NAMES[state.key], state.error || 'Source unavailable'); $(`${state.key}-first`).textContent = state.error || 'Source unavailable'; $(`${state.key}-first`).classList.add('source-error'); }
  } else if (event.type === 'candidate') {
    if (event.source === 'archive') return;
    addCandidate(event.source, event.reference); firstResultMs ??= event.atMs;
    log(event.atMs, SOURCE_NAMES[event.source], event.reference.title);
    renderMetrics();
  } else if (event.type === 'retrieval-complete') {
    retrievalMs = event.atMs;
    if (latest?.mode === 'sources') { setClock(retrievalMs); $('clock-label').textContent = 'References collected / page views loading'; $('stage-status').textContent = `${event.count} references found. Browse the images while the page views finish.`; }
    else if (waitingForAstra) {
      stageMessage = `${event.count} references loaded. Waiting for Astra’s direction before Jev selects.`;
      $('stage-status').textContent = stageMessage; message(stageMessage);
    }
    log(event.atMs, 'Sources', `${event.count} references retrieved; browser rendering continues separately.`);
    updateButtons();
  } else if (event.type === 'search-plan' || event.type === 'shortlist') {
    jevPasses.push(event); $('jev-time').textContent = `${event.roundTripMs} ms`;
    if (event.type === 'search-plan') {
      for (const key of SOURCE_KEYS) $<HTMLInputElement>(`${key}-query`).value = event.searches[key];
      $('jev-action').textContent = 'Search phrases chosen';
      log(event.atMs, 'Jev', `Three search phrases / ${event.roundTripMs} ms / one request`);
    } else {
      for (const id of event.ids) {
        if (!byId.has(id)) continue;
        highlighted.add(id);
        if (!board.includes(id) && board.length < BOARD_SIZE) board.push(id);
      }
      $('jev-action').textContent = `${event.ids.length} picks / one request`;
      log(event.atMs, 'Jev', `${event.ids.length} source picks / ${event.roundTripMs} ms / one request`);
      renderBoard(); updateCandidateStates(); save();
    }
    renderMetrics();
  } else if (event.type === 'browser') {
    $(`${event.source}-browser-status`).textContent = event.status;
    if (event.status.includes('could not') || event.status.includes('unavailable')) log(event.atMs, 'Browser', `${SOURCE_NAMES[event.source]}: ${event.status}`);
  } else if (event.type === 'decision') {
    decisions.push(event.decision); $('jev-time').textContent = `${event.decision.roundTripMs} ms`;
    const reference = byId.get(event.decision.id);
    $('jev-action').textContent = reference ? 'Reference selected' : 'No further match';
    log(event.atMs, 'Jev', `${reference?.title || 'No suitable reference'} / ${event.decision.roundTripMs} ms`);
    if (reference && !board.includes(reference.id) && board.length < BOARD_SIZE) { board.push(reference.id); renderBoard(reference.id); if (!restoring) animateSelection(reference.id); updateCandidateStates(); save(); }
    renderMetrics();
  } else if (event.type === 'notice') {
    stageMessage = event.message; $('stage-status').textContent = event.message; message(event.message);
    log(event.atMs, 'Notice', event.message);
  } else if (event.type === 'end' || event.type === 'error') {
    if (latest) { latest.status = event.type === 'error' ? 'error' : event.status; latest.totalMs = event.atMs; }
    message(event.message, event.type === 'error'); $('stage-status').textContent = event.message;
    log(event.atMs, 'Run', event.message);
  }
}

function resetWindows() {
  imageVisibility.disconnect();
  sourceStates.clear(); sourceStarted.clear(); frames.clear(); frameCounts.clear(); candidateButtons.clear(); reviews.length = 0; decisions.length = 0; renderedFrames = 0; firstResultMs = null; firstImageMs = null; retrievalMs = null;
  jevPasses.length = 0; highlighted.clear();
  for (const key of SOURCE_KEYS) {
    sourceRefs.set(key, []); $(`${key}-clock`).textContent = '0.00 s'; $(`${key}-count`).textContent = `0 / ${resultLimit()}`; $(`${key}-first`).textContent = 'First reference: —'; $(`${key}-first`).classList.remove('source-error');
    $(`${key}-incoming`).replaceChildren(el('span', 'empty-strip', 'Images appear as results arrive')); $(`${key}-placeholder`).hidden = false; $<HTMLImageElement>(`${key}-frame`).hidden = true; $(`${key}-browser-status`).textContent = 'Waiting to open'; $(`window-${key}`).dataset.live = 'false';
  }
  $('event-log').replaceChildren(); $('astra-time').textContent = '—'; $('jev-time').textContent = '—'; $('astra-action').textContent = 'Writes the direction'; $('jev-action').textContent = configured ? 'Waiting for references' : 'Key not connected'; $('sources-action').textContent = 'Search three sources';
  renderMetrics();
}
async function startRun(mode: 'creator' | 'sources') {
  if (busy || (mode === 'creator' && !configured)) return;
  if (brief.value.trim().length < 8) return message('Add at least eight characters to your brief.', true);
  const searches = Object.fromEntries(SOURCE_KEYS.map(key => [key, $<HTMLInputElement>(`${key}-query`).value.trim()]));
  if (mode === 'sources' && Object.values(searches).some(value => value.length < 2 || value.length > 100)) return message('Enter a search phrase for each source, between 2 and 100 characters.', true);
  busy = true; stopped = false; abort = new AbortController(); runStart = performance.now();
  stageStart = runStart; waitingForAstra = false;
  latest = { startedAt: new Date().toISOString(), mode, brief: brief.value.trim(), status: 'running', totalMs: 0, events: [], selected: [...board], pinned: [...pins] };
  resetWindows();
  $('live-stage').dataset.mode = mode;
  if (mode === 'creator') board = [...pins];
  $('clock-label').textContent = mode === 'sources' ? 'Collecting references' : 'Search + Jev / real time'; $('capture-label').textContent = mode === 'creator' ? 'Fresh source search' : 'Actual browser views loading'; $('run-status').textContent = 'Running';
  message(mode === 'creator' ? 'Finding assets for your brief with Jev.' : 'Searching the three displayed phrases. Images appear as they arrive.');
  updateButtons(); renderBoard();
  $('live-stage').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  const clock = setInterval(() => {
    if (mode === 'creator' || retrievalMs === null) setClock(performance.now() - runStart);
    $('capture-label').textContent = `${mode === 'creator' ? 'Live search' : 'Browser views'} / ${seconds(performance.now() - runStart)} elapsed`;
    if (waitingForAstra) {
      const elapsed = performance.now() - stageStart;
      $('astra-time').textContent = `${(elapsed / 1000).toFixed(1)} s`;
      if (elapsed > 8000 && !$('stage-status').textContent?.includes('Still waiting')) {
        const status = `${stageMessage} Still waiting on local Codex.`;
        $('stage-status').textContent = status; message(status);
      }
    }
    for (const key of SOURCE_KEYS) if (sourceStates.get(key)?.status === 'searching') $(`${key}-clock`).textContent = seconds(performance.now() - (sourceStarted.get(key) || performance.now()));
  }, 50);
  try {
    const response = await fetch('/api/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief: brief.value.trim(), selected: mode === 'creator' ? pins : [], mode, searches }), signal: abort.signal });
    if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'The research run could not start.'); }
    if (!response.body) throw new Error('This browser could not receive live events.');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, newline); pending = pending.slice(newline + 1); if (line) handleEvent(JSON.parse(line) as ResearchEvent); }
    }
    if (latest.status === 'running') throw new Error('The stream ended before completion. Collected references are kept.');
  } catch (error) {
    latest.status = stopped ? 'stopped' : 'error';
    const text = stopped ? 'Stopped. Collected references and your pins are kept.' : error instanceof Error ? error.message : 'The research stream was interrupted. Try again.';
    message(text, !stopped); $('stage-status').textContent = text; log(performance.now() - runStart, 'Run', text);
  } finally {
    clearInterval(clock); busy = false; waitingForAstra = false; activeStage = 'idle'; $('live-stage').dataset.active = 'idle';
    latest.totalMs = Math.round(performance.now() - runStart); latest.selected = [...board]; setClock(mode === 'sources' && retrievalMs !== null ? retrievalMs : latest.totalMs);
    $('clock-label').textContent = mode === 'sources' && retrievalMs !== null ? 'References collected' : 'Search + Jev / completed'; $('run-status').textContent = `${reviews.length} Astra stages / ${jevCallCount()} Jev calls / ${latest.status}`;
    if (latest.status === 'error') $('clock-label').textContent = 'Run stopped / error';
    $('capture-label').textContent = `${mode === 'creator' ? 'Assets found' : 'Page views finished'} / ${seconds(latest.totalMs)} total`;
    for (const key of SOURCE_KEYS) { $(`window-${key}`).dataset.live = 'false'; if (frames.has(key)) $(`${key}-browser-status`).textContent = `Last capture at ${seconds(frames.get(key)!.atMs)} / ${frameCounts.get(key)} frames`; }
    if (latest.status === 'awaiting-jev') { $('jev-action').textContent = 'Key not connected'; $('board-hint').textContent = 'Live references are ready. Jev has not selected any images; pin references to build a board manually.'; }
    else $('board-hint').textContent = jevCallCount() ? 'Jev’s picks are marked in the gallery. Open any asset to see its source or pin it.' : 'Open incoming references to inspect or pin them.';
    if (mode === 'creator') $('astra-summary').textContent = `${highlighted.size} picks from one Jev selection pass. Your pinned references stay saved.`;
    if (sourceStates.size && SOURCE_KEYS.every(key => sourceStates.get(key)?.status === 'error')) { latest.status = 'error'; $('run-status').textContent = 'All three sources failed'; }
    updateButtons(); renderBoard(); renderMetrics(); updateCandidateStates(); save(); savePreview();
    saveExploration();
    $('raw-record').textContent = JSON.stringify(record(), null, 2);
  }
}
function record() {
  return { ...latest, retrievalMs, firstImageMs, browserEngine: latest?.mode === 'creator' ? 'No browser captures in creator search' : 'Playwright / isolated Chromium', browserFrames: renderedFrames, frameCounts: Object.fromEntries(frameCounts), sources: Object.fromEntries(sourceStates), retrievalMethods: SOURCE_METHODS, boardNow: board.map(id => byId.get(id)), methodology: 'Creator search uses live source retrieval (targeting 100 images across three sources) and one batched Jev request choosing at most one asset per source. Custom prompts add a Jev choice of search phrases from bounded candidates, including prompt-derived phrases; exact samples use their authored searches. Creator search never calls Astra or launches Chromium. Each Find assets action searches fresh; saved results are separately labeled. Image caches may make repeated thumbnails load faster. Direct source search makes no model calls. Astra mode uses local Codex and Jev when configured. Exact sample briefs start authored searches alongside Astra; custom prompts await new search phrases. Notices record unavailable Astra stages and bounded Jev retries. Successful Jev roundTripMs excludes retry delay; decision.totalMs includes all attempts. Retrieval and browser startup run concurrently. In source mode the large clock measures retrieval completion; totalMs separately includes browser loading. firstImageMs measures the first loaded incoming image entering the visible gallery. NASA and Met use public APIs; Cosmos uses its public search response. Models consume metadata, not pixels. Jev timings are actual API round trips.' };
}

buildWindows();
for (const key of SOURCE_KEYS) $<HTMLInputElement>(`${key}-query`).value = (initialDirection?.searches || DEFAULT_SEARCHES)[key];
renderBoard(); updateButtons();
try {
  const saved = JSON.parse(sessionStorage.getItem('jev-curator-live-preview') || 'null');
  if (saved?.latest?.mode === 'creator' && saved.latest.events && Array.isArray(saved.frames)) {
    restoreExploration(saved);
  }
} catch { /* Old preview data is optional. */ }
renderExplorations();

$('brief-form').addEventListener('submit', event => { event.preventDefault(); void startRun('creator'); });
$('sources-only').addEventListener('click', () => { void startRun('sources'); });
for (const id of ['stop', 'clock-stop']) $(id).addEventListener('click', () => { stopped = true; batchStopped = true; abort?.abort(); });
$('clear-pins').addEventListener('click', () => { pins = []; save(); renderBoard(); updateButtons(); updateCandidateStates(); message('Pins cleared. The next live run can change every reference.'); });
$('detail-pin').addEventListener('click', () => { if (shownReference) pin(shownReference); });
brief.addEventListener('input', () => {
  const direction = findDirection(brief.value);
  activeDirection = direction?.id || '';
  $('mission-title').textContent = direction?.title || 'Your next visual';
  $('mission-subtitle').textContent = direction?.detail || 'Describe what you’re making. Find the assets to match.';
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.preset === activeDirection)));
  save();
});
function applyDirection(id: string) {
  const direction = DIRECTIONS.find(item => item.id === id)!;
  activeDirection = id; brief.value = CREATOR_BRIEFS[id];
  $('mission-title').textContent = direction.title;
  $('mission-subtitle').textContent = `${direction.detail}. Three places to look.`;
  for (const key of SOURCE_KEYS) $<HTMLInputElement>(`${key}-query`).value = direction.searches[key];
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.preset === id)));
  save();
}
for (const direction of DIRECTIONS) {
  const button = el('button', 'direction-choice'); button.type = 'button'; button.dataset.preset = direction.id;
  button.style.setProperty('--direction-color', direction.color);
  button.setAttribute('aria-pressed', String(direction.id === activeDirection));
  button.append(el('strong', undefined, direction.title), el('span', undefined, direction.detail));
  button.addEventListener('click', () => { applyDirection(direction.id); brief.focus(); message('Edit this prompt, then press Find assets.'); });
  $('direction-presets').append(button);
}
$('run-six').addEventListener('click', async () => {
  if (busy || batchRunning || !configured) return;
  batchRunning = true; batchStopped = false; $('batch-status').hidden = false;
  try {
    const pending = DIRECTIONS.filter(direction => !explorations.some(item => findDirection(item.latest.brief)?.id === direction.id && item.latest.mode === 'creator' && ['complete', 'no-match'].includes(item.latest.status)));
    const queue = pending.length ? pending : DIRECTIONS;
    for (let index = 0; index < queue.length; index++) {
      if (batchStopped) break;
      const direction = queue[index]; applyDirection(direction.id);
      $('batch-status').textContent = `${DIRECTIONS.indexOf(direction) + 1} / ${DIRECTIONS.length} · ${direction.title}. Each result is saved below.`;
      await startRun('creator');
      if (latest?.status === 'error') break;
    }
    const completed = DIRECTIONS.filter(direction => explorations.some(item => findDirection(item.latest.brief)?.id === direction.id && item.latest.mode === 'creator' && ['complete', 'no-match'].includes(item.latest.status))).length;
    $('batch-status').textContent = batchStopped ? 'Stopped. Completed explorations are saved below.' : completed === DIRECTIONS.length ? 'Six directions finished. Select a saved exploration to compare its references and timing.' : `${completed} / ${DIRECTIONS.length} directions completed. The run paused after an error; use Run remaining directions to resume.`;
  } finally { batchRunning = false; updateButtons(); }
});
$('test-open').addEventListener('click', () => $<HTMLDialogElement>('test-dialog').showModal());
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog')!.close()));
document.querySelector('details.archive')!.addEventListener('toggle', event => { if ((event.target as HTMLDetailsElement).open && !$('archive-gallery').children.length) $('archive-gallery').append(...catalog.map(ref => referenceCard(ref))); });
$('expand').addEventListener('click', () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => message('Expand the browser panel to see all three windows at full size.')); });
$('export').addEventListener('click', () => {
  if (!latest || busy) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(record(), null, 2)], { type: 'application/json' })); const link = el('a'); link.href = url; link.download = `jev-curator-${latest.startedAt.replace(/[:.]/g, '-')}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
async function connection() {
  try {
    const response = await fetch('/api/status', { signal: AbortSignal.timeout(5000) }); const data = await response.json();
    configured = data.configured === true; astraAvailable = data.astraAvailable === true;
    $('connection').textContent = configured ? 'Jev ready' : 'Connect Jev'; $('connection').classList.toggle('connected', configured);
    $('connection-detail').textContent = configured ? 'Jev is connected. Find assets uses Jev and the live source libraries.' : 'Connect a TypeSafe key to use Jev for creator search.';
    $('connect-open').textContent = configured ? 'Jev connection' : 'Connect Jev';
    if (!latest) { message('Describe what you’re making. Find assets searches live sources and asks Jev to pick the standouts.'); $('jev-action').textContent = configured ? 'Picks the standouts' : 'Key not connected'; }
  } catch { message('The local server could not be reached. Start bun run start and refresh.', true); $('connection').textContent = 'Server unavailable'; }
  updateButtons();
}
void connection();

$('connect-open').addEventListener('click', () => { $<HTMLInputElement>('jev-key').value = ''; $('connect-feedback').textContent = configured ? 'A key is configured. Submit a new key only to replace it.' : ''; $<HTMLDialogElement>('connect-dialog').showModal(); });
$('connect-dialog').addEventListener('close', () => { $<HTMLInputElement>('jev-key').value = ''; });
$('connect-form').addEventListener('submit', async event => {
  event.preventDefault();
  const field = $<HTMLInputElement>('jev-key'), button = $<HTMLButtonElement>('connect-submit');
  const key = field.value.trim(); field.value = ''; button.disabled = true; $('connect-feedback').textContent = 'Checking the key with TypeSafe…';
  try {
    const response = await fetch('/api/connect-jev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }), signal: AbortSignal.timeout(25_000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The connection could not be verified.');
    await connection();
    $('connect-feedback').textContent = `Jev is connected. Verification took ${data.roundTripMs} ms. Use Find assets to start.`;
  } catch (error) { $('connect-feedback').textContent = error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'The check timed out. Try again.'; }
  finally { button.disabled = false; }
});
