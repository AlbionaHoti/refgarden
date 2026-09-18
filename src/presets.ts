import type { SourceKey } from './types';

export const CREATOR_BRIEFS: Record<string, string> = {
  garden: 'I’m making a reel about Earth’s last garden aboard a spaceship. Find botanical cyanotypes, blue exhibition graphics and plants in space.',
  mars: 'Find visuals for a Mars architecture reel: brutalist concrete, rust-red terrain, monumental shapes and deep shadows.',
  abyss: 'I’m making a reel about glowing oceans. Find wave studies, bioluminescent installations and ocean currents. Electric blue, cyan, black.',
  rococo: 'I need references for a lunar fashion editorial: ornate silverwork, pearlescent interiors and detailed lunar surfaces. Ivory, silver and pearl.',
  solar: 'Find assets for a solar-inspired poster: geometric textiles, earthy exhibition graphics and solar flares. Ochre, terracotta and gold.',
  signals: 'I’m designing a music festival poster for another galaxy. Find abstract prints, experimental acid-color typography and nebulae.',
};

export function findDirection(brief: string) {
  return DIRECTIONS.find(direction => direction.brief === brief.trim() || CREATOR_BRIEFS[direction.id] === brief.trim());
}

export interface Direction {
  id: string;
  title: string;
  detail: string;
  color: string;
  brief: string;
  searches: Record<SourceKey, string>;
}

export const DIRECTIONS: Direction[] = [
  { id: 'garden', title: 'Last Garden', detail: 'Cyanotypes / living specimens', color: '#316d92', brief: 'Design a botanical exhibition aboard a spacecraft carrying Earth’s last living garden. Find historical botanical cyanotypes and specimen studies at The Met, contemporary botanical exhibition typography on Cosmos, and spacecraft habitats or plant research at NASA. Deep blue, silver, paper white. Delicate organic forms against precise engineering. Choose a varied six-reference board across all three sources.', searches: { met: 'Anna Atkins', cosmos: 'botanical exhibition typography', nasa: 'space plants' } },
  { id: 'mars', title: 'Martian Brutalism', detail: 'Concrete / rust / monumental forms', color: '#a8563e', brief: 'Design a severe architecture exhibition for a city on Mars. Combine monumental stone or architectural studies at The Met, brutalist concrete architecture and stark editorial grids on Cosmos, and Mars terrain or rover hardware at NASA. Rust red, raw gray, black. Heavy blocks, deep shadows, large empty spaces. Choose a varied six-reference board across all three sources.', searches: { met: 'architecture', cosmos: 'brutalist concrete architecture', nasa: 'Mars terrain' } },
  { id: 'abyss', title: 'Abyssal Light', detail: 'Black water / electric blue / fluid forms', color: '#258198', brief: 'Design an immersive exhibition where deep ocean life meets orbital science. Find jellyfish, sea life or wave studies at The Met, bioluminescent installations and translucent fluid design on Cosmos, and ocean currents or glowing Earth-at-night imagery at NASA. Near black, electric blue, luminous cyan. Suspended forms, ripples, thin glowing lines. Choose a varied six-reference board across all three sources.', searches: { met: 'waves', cosmos: 'bioluminescent installation', nasa: 'ocean currents' } },
  { id: 'rococo', title: 'Lunar Rococo', detail: 'Pearl / silver / ornate surfaces', color: '#a38b6d', brief: 'Design an extravagant salon on the Moon. Find ornate silverwork, porcelain or rococo ornament at The Met, pearlescent sculptural interiors and reflective material experiments on Cosmos, and lunar craters or lunar surface detail at NASA. Ivory, pale silver, pearl, touches of gold. Curved ornament against cratered mineral surfaces. Choose a varied six-reference board across all three sources.', searches: { met: 'rococo', cosmos: 'pearlescent sculptural interior', nasa: 'lunar surface' } },
  { id: 'solar', title: 'Solar Folklore', detail: 'Woven geometry / ochre / sun rituals', color: '#c07730', brief: 'Design a contemporary exhibition about imagined rituals around the Sun. Find woven geometric textiles, sun motifs or ceremonial objects at The Met, earthy textile graphics and craft-led exhibition design on Cosmos, and solar flares or desert patterns seen from orbit at NASA. Ochre, terracotta, gold, indigo. Tactile fibers and bold repeating geometry. Do not invent cultural attribution. Choose a varied six-reference board across all three sources.', searches: { met: 'geometric textile', cosmos: 'textile exhibition earthy', nasa: 'solar flare' } },
  { id: 'signals', title: 'Signals from Elsewhere', detail: 'Acid color / experimental type / nebulae', color: '#985ba7', brief: 'Design an experimental festival identity for signals arriving from another galaxy. Find vivid abstract prints or geometric studies at The Met, acid-color experimental typography and kinetic poster graphics on Cosmos, and nebulae or supernova imagery at NASA. Magenta, cobalt, acid green, ultraviolet. Flat graphic shapes collide with cosmic clouds. Choose a varied six-reference board across all three sources.', searches: { met: 'abstract print', cosmos: 'experimental typography acid color', nasa: 'nebula' } },
];
