import type { Reference, SourceKey, MediaSourceKey } from './types';

/** Round displayed shares together so the three labels always total 100%. */
export function imageSourceShares(counts: Record<SourceKey, number>): Record<SourceKey, number> {
  const keys: SourceKey[] = ['met', 'nasa', 'cosmos'];
  const total = keys.reduce((sum, key) => sum + counts[key], 0);
  const shares = { met: 0, nasa: 0, cosmos: 0 };
  if (!total) return shares;
  for (const key of keys) shares[key] = Math.floor(counts[key] / total * 100);
  const remainder = 100 - keys.reduce((sum, key) => sum + shares[key], 0);
  const ranked = [...keys].sort((a, b) => (counts[b] / total * 100 - shares[b]) - (counts[a] / total * 100 - shares[a]));
  for (const key of ranked.slice(0, remainder)) shares[key]++;
  return shares;
}

export function sourceQuotas(capacity: number, previous: Record<SourceKey, number> = { met: 0, nasa: 0, cosmos: 0 }): Record<SourceKey, number> {
  const keys: SourceKey[] = ['met', 'nasa', 'cosmos'];
  const quota = { met: 0, nasa: 0, cosmos: 0 };
  for (let slot = 0; slot < capacity; slot++) {
    const source = keys.reduce((least, key) => previous[key] + quota[key] < previous[least] + quota[least] ? key : least);
    quota[source]++;
  }
  return quota;
}

export function referenceSource(ref: Reference): MediaSourceKey | undefined {
  if (ref.sourceKey) return ref.sourceKey;
  // Older saved references predate sourceKey.
  return ({ 'The Met': 'met', NASA: 'nasa', Cosmos: 'cosmos' } as const)[ref.sourceName as 'The Met' | 'NASA' | 'Cosmos'];
}
