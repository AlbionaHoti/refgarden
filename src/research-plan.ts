import { DIRECTIONS } from './presets';
import { RequestError } from './decision';
import type { Review, SourceKey } from './types';

/** Only exact sample briefs can reuse their authored searches. Edited prompts must be replanned. */
export async function prepareResearch(
  brief: string,
  plan: (searches?: Record<SourceKey, string>) => Promise<Review>,
  collect: (searches: Record<SourceKey, string>) => Promise<void>,
  fallback: (error: unknown) => void,
) {
  const sample = DIRECTIONS.find(direction => direction.brief === brief.trim());
  // Attach the rejection handler immediately while retrieval runs independently.
  const planning = plan(sample?.searches).then(review => ({ review }), error => ({ error }));
  if (sample) await collect(sample.searches);
  const result = await planning;
  if ('error' in result) {
    if (!sample) throw result.error;
    fallback(result.error);
    return brief;
  }
  if (!sample) {
    if (!result.review.searches) throw new RequestError('Astra did not return search phrases. Try again.', 502);
    await collect(result.review.searches);
  }
  return result.review.selectionBrief;
}
