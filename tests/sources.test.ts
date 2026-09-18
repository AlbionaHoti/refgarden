import { describe, expect, test } from 'bun:test';
import { cosmosReferences, publicSearchResults, safeImage, searchUrl } from '../src/sources';
import { buildQuestion, validateInput } from '../src/decision';

const element = { id: 123, contentAccessibility: 'ACCESSIBLE', generatedCaption: { text: '<n>Botanical</n> poster' }, media: { __typename: 'StaticImage', url: 'https://cdn.cosmos.so/abc', notSafeForWorkStatus: 'SAFE' }, owner: { username: 'collector' }, createdAt: '2026-09-17' };
const page = (elements: unknown[]) => `<script>unrelated()</script><script>window.transport({"data":undefined,"searchElements":${JSON.stringify({ results: elements.map(element => ({ element })) })}})</script>`;

describe('live source boundaries', () => {
  test('reads the public search result JSON without evaluating surrounding JavaScript', () => {
    expect(publicSearchResults(page([element]))).toHaveLength(1);
    const refs = cosmosReferences(page([element]));
    expect(refs[0].title).toBe('Botanical poster');
    expect(refs[0].source).toBe('https://www.cosmos.so/e/123');
    expect(refs[0].descriptionOrigin).toContain('not been independently verified');
    expect(publicSearchResults('<p>No public results</p>')).toEqual([]);
  });
  test('ignores private, unsafe, video and untrusted image records', () => {
    const refs = cosmosReferences(page([element, { ...element, id: 124, contentAccessibility: 'INACCESSIBLE' }, { ...element, id: 125, media: { ...element.media, url: 'http://127.0.0.1/private' } }, { ...element, id: 126, media: { ...element.media, notSafeForWorkStatus: 'UNSAFE' } }, { ...element, id: 127, media: { ...element.media, __typename: 'Video' } }]));
    expect(refs.map(ref => ref.id)).toEqual(['cosmos-123']);
    expect(safeImage('javascript:alert(1)')).toBe('');
    expect(safeImage('https://cdn.cosmos.so.attacker.example/x')).toBe('');
    expect(new URL(searchUrl('cosmos', 'hello/?next=https://evil.example')).host).toBe('www.cosmos.so');
  });
  test('only collected IDs can reach the Jev question and selected pins are excluded', () => {
    const refs = cosmosReferences(page([element, { ...element, id: 999 }]));
    expect(() => validateInput({ brief: 'A botanical exhibition', selected: ['fake-id'] }, refs)).toThrow();
    const payload = buildQuestion('A botanical exhibition', ['cosmos-123'], refs);
    expect(payload.questions.next_reference.criteria).toHaveProperty('cosmos-999');
    expect(payload.questions.next_reference.criteria).not.toHaveProperty('cosmos-123');
  });
});
