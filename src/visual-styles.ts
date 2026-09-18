import { RequestError } from './decision';
import type { SourceKey } from './types';

export const VISUAL_STYLES: { id: string; label: string; description: string; searches: Record<SourceKey, string> }[] = [
  { id: 'cinematic', label: 'Cinematic', description: 'Atmospheric photography, dramatic light and wide compositions', searches: { met: 'photograph', cosmos: 'cinematic photography', nasa: 'Earth from space' } },
  { id: 'typography', label: 'Typography', description: 'Posters, expressive lettering and editorial graphics', searches: { met: 'poster', cosmos: 'experimental typography', nasa: 'mission poster' } },
  { id: 'chrome', label: 'Chrome', description: 'Reflective metal, silver objects and polished surfaces', searches: { met: 'silver', cosmos: 'chrome sculpture', nasa: 'spacecraft hardware' } },
  { id: 'botanical', label: 'Botanical', description: 'Plants, organic forms and botanical studies', searches: { met: 'Anna Atkins', cosmos: 'botanical art', nasa: 'space plants' } },
  { id: 'analog', label: 'Analog', description: 'Film photography, grain, archival paper and tactile print', searches: { met: 'photograph', cosmos: 'analog photography', nasa: 'Apollo photograph' } },
  { id: 'minimal', label: 'Minimal', description: 'Simple shapes, restrained color and negative space', searches: { met: 'geometric print', cosmos: 'minimal graphic design', nasa: 'moon surface' } },
  { id: 'surreal', label: 'Surreal', description: 'Unexpected scale, dreamlike forms and strange juxtapositions', searches: { met: 'surrealism', cosmos: 'surreal collage', nasa: 'nebula' } },
  { id: 'scientific', label: 'Scientific', description: 'Diagrams, specimens, technical drawings and instrument imagery', searches: { met: 'scientific drawing', cosmos: 'scientific diagram', nasa: 'scientific illustration' } },
];

export function validateStyles(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > VISUAL_STYLES.length || !value.every(id => typeof id === 'string' && VISUAL_STYLES.some(style => style.id === id))) {
    throw new RequestError('Choose styles from the available checkboxes.');
  }
  return [...new Set(value)] as string[];
}

export function styledBrief(brief: string, styles: string[]) {
  const selected = VISUAL_STYLES.filter(style => styles.includes(style.id));
  if (!selected.length) return brief;
  return `${brief}\n\nVisual direction: ${selected.map(style => `${style.label}: ${style.description}`).join('; ')}. Keep the original subject. Seek references that express these styles; do not substitute unrelated subjects.`;
}
