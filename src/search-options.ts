import { RequestError } from './decision';
import { DIRECTIONS } from './presets';
import { VISUAL_STYLES } from './visual-styles';
import type { SourceKey } from './types';

const stopWords = new Set('i im am a an the for of to and or with on in at from my me need want find get give some assets asset images image visuals visual references reference create creating making make reel video post about please show design exhibition choose varied six across all three sources museum nasa cosmos met resource resources producing produce building build would like looking'.split(' '));

/** Build bounded text options; Jev chooses options rather than inventing search strings. */
export function searchOptions(brief: string, key: SourceKey, styles: string[] = []) {
  const words = brief.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(word => word.length > 2 && !stopWords.has(word)).slice(0, 36) || [];
  const phrases: string[] = [];
  for (const size of [3, 2, 1]) for (let i = 0; i < 12 && i + size <= words.length; i++) phrases.push(words.slice(i, i + size).join(' '));
  const authored = DIRECTIONS.map(direction => direction.searches[key]).filter(phrase => words.some(word => phrase.toLowerCase().includes(word)));
  const stylePhrases = VISUAL_STYLES.filter(style => styles.includes(style.id)).flatMap(style => [`${words[0] || ''} ${style.searches[key]}`.trim(), style.searches[key]]);
  const values = [...new Set([...stylePhrases, ...phrases, ...authored])].filter(value => value.length >= 2 && value.length <= 100);
  if (!words.length) throw new RequestError('Add a subject or visual style, such as jellyfish, lunar craters or silver typography.');
  return Object.fromEntries(values.map((value, i) => [`query_${i}`, value]));
}
