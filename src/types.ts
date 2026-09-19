export interface Reference {
  id: string;
  title: string;
  description: string;
  credit: string;
  date: string;
  image: string;
  source: string;
  collection: string;
  sourceName: string;
  descriptionOrigin: string;
  sourceKey?: MediaSourceKey;
  video?: { url: string; durationSeconds: number };
  retrievedAt?: string;
}

export interface Decision {
  id: string;
  model: string;
  roundTripMs: number;
  attempts?: number;
  totalMs?: number;
  probabilities: Record<string, number>;
  confidence: number;
  usage: { input_tokens: number; output_tokens: number };
}

export interface Run {
  startedAt: string;
  brief: string;
  pinned: string[];
  decisions: Decision[];
  selected: string[];
  totalMs: number;
  status: 'running' | 'complete' | 'stopped' | 'no-match' | 'error' | 'awaiting-jev';
  reviews: Review[];
  selectionMs: number;
  error?: string;
  inputMode: 'Prepared reference descriptions' | 'Live source metadata';
}

export interface Review {
  model: string;
  stage: 'plan' | 'review';
  durationMs: number;
  summary: string;
  selectionBrief: string;
  roles: string[];
  missing: string[];
  searches?: Record<SourceKey, string>;
}

export type SourceKey = 'met' | 'cosmos' | 'nasa';
export type MediaSourceKey = SourceKey | 'archive';
export type MediaMode = 'images' | 'videos' | 'both';
export type CreatorInput = { brief: string; selected: string[]; styles?: string[]; media?: MediaMode };
export type SourceStatus = 'waiting' | 'searching' | 'ready' | 'error';
export interface SourceProgress {
  key: MediaSourceKey;
  query: string;
  url: string;
  status: SourceStatus;
  found: number;
  elapsedMs: number;
  firstResultMs?: number;
  error?: string;
}
export type ResearchEvent =
  | { type: 'continuation'; atMs: number; cursor: DiscoveryCursor }
  | { type: 'curation'; atMs: number; ids: string[]; summary: string; model: string; durationMs: number }
  | { type: 'start'; atMs: number; startedAt: string; mode: 'research' | 'sources' | 'creator' }
  | { type: 'stage'; atMs: number; stage: 'astra' | 'sources' | 'jev'; message: string }
  | { type: 'review'; atMs: number; review: Review }
  | { type: 'source'; atMs: number; source: SourceProgress }
  | { type: 'candidate'; atMs: number; source: MediaSourceKey; reference: Reference }
  | { type: 'archive-plan'; atMs: number; query: string; model: string; roundTripMs: number }
  | { type: 'retrieval-complete'; atMs: number; count: number }
  | { type: 'discovery'; atMs: number; round: number; phase: 'searching' | 'complete'; total: number; added: number }
  | { type: 'browser'; atMs: number; source: SourceKey; status: string; url: string }
  | { type: 'frame'; atMs: number; source: SourceKey; image: string; url: string }
  | { type: 'decision'; atMs: number; decision: Decision }
  | { type: 'notice'; atMs: number; message: string }
  | { type: 'search-plan'; atMs: number; searches: Record<SourceKey, string>; model: string; roundTripMs: number; attempts: number; totalMs: number }
  | { type: 'shortlist'; atMs: number; ids: string[]; model: string; roundTripMs: number; attempts: number; totalMs: number; choices: Record<string, Decision> }
  | { type: 'end'; atMs: number; status: 'complete' | 'sources-only' | 'awaiting-jev' | 'no-match' | 'stopped' | 'error'; message: string }
  | { type: 'error'; atMs: number; message: string };

export interface DiscoveryCursor {
  round: number;
  emptyRounds: number;
  seenIds: string[];
  seenImages: string[];
  seenKeys?: string[];
  queries: Record<SourceKey, string[]>;
  pages: [string, number][];
}
