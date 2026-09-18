import type { Reference, SourceKey } from './types';

export function sourceQuotas(capacity: number, previous: Record<SourceKey, number> = { met: 0, nasa: 0, cosmos: 0 }): Record<SourceKey, number> {
  const keys: SourceKey[] = ['met', 'nasa', 'cosmos'];
  const quota = { met: 0, nasa: 0, cosmos: 0 };
  for (let slot = 0; slot < capacity; slot++) {
    const source = keys.reduce((least, key) => previous[key] + quota[key] < previous[least] + quota[least] ? key : least);
    quota[source]++;
  }
  return quota;
}

export function referenceSource(ref: Reference): SourceKey | undefined {
  if (ref.sourceKey) return ref.sourceKey;
  // Older saved references predate sourceKey.
  return ({ 'The Met': 'met', NASA: 'nasa', Cosmos: 'cosmos' } as const)[ref.sourceName as 'The Met' | 'NASA' | 'Cosmos'];
}
