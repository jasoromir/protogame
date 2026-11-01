// Ability and element icons as inline SVG: a glyph on an element-colored emblem.
import { CARDS } from '../sim/cards.js';

// 24×24 glyphs, drawn white on the emblem
const GLYPHS = {
  flame: '<path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 1.5 1 2 2.5 2 4 1-2 1.5-5 1-8z"/>',
  cone: '<path d="M4 12 20 4v16z" opacity=".55"/><path d="M4 12 20 6v12z"/><circle cx="4" cy="12" r="2"/>',
  meteor: '<circle cx="15" cy="15" r="5"/><path d="M3 3l9 7-2 2zM6 2l8 6-1 1zM2 7l7 6-1 1z" opacity=".75"/>',
  haste: '<path d="M4 5l7 7-7 7V5zm8 0 7 7-7 7V5z"/>',
  sun: '<circle cx="12" cy="12" r="5"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4M4 4l3 3M17 17l3 3M4 20l3-3M17 7l3-3" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
  charge: '<path d="M3 9h10V5l8 7-8 7v-4H3z"/>',
  wave: '<path d="M2 15c3-6 6-6 8-2 2 4 5 4 8-2l4 2c-3 7-8 8-12 3-2-3-4-3-6 1z"/><path d="M2 9c3-4 6-4 8-1" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>',
  shield: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/>',
  spring: '<path d="M12 3c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z"/><ellipse cx="12" cy="20" rx="9" ry="2" fill="none" stroke="#fff" stroke-width="1.5"/>',
  shard: '<path d="M12 2l5 7-5 13-5-13z"/><path d="M12 2v20" stroke="#0004" stroke-width="1"/>',
  claw: '<path d="M5 3c4 5 6 11 5 18M11 2c3 5 4 12 2 19M17 3c2 5 2 11-1 17" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>',
  wall: '<path d="M2 6h20v4H2zM2 11h9v4H2zM12 11h10v4H12zM2 16h20v4H2z"/>',
  snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><path d="M9 4l3 2 3-2M9 20l3-2 3 2" stroke="#fff" stroke-width="1.6" fill="none"/>',
  chain: '<path d="M3 13l5-6 3 5 4-7 3 6 3-3" stroke="#fff" stroke-width="2.2" fill="none" stroke-linejoin="round"/><circle cx="4" cy="18" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="20" cy="17" r="2"/>',
  bolt: '<path d="M14 1 4 14h6l-2 9 10-13h-6z"/>',
  dash: '<path d="M13 6l7 6-7 6v-4H8v-4h5z"/><path d="M2 9h5M1 12h6M2 15h5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>',
  storm: '<path d="M6 11a4 4 0 0 1 1-8 5 5 0 0 1 9 1 3.5 3.5 0 0 1 1 7z"/><path d="M12 11l-3 6h3l-1.5 5 5-7h-3l2-4z"/>',
  rock: '<path d="M4 18l2-8 5-5 6 2 3 7-3 5H6z"/><path d="M11 5l1 6 5 3" stroke="#0004" stroke-width="1.2" fill="none"/>',
  quake: '<path d="M2 20h20" stroke="#fff" stroke-width="2"/><path d="M12 19l-2-5 3-3-2-4 1-4" stroke="#fff" stroke-width="2" fill="none"/><path d="M4 17l3-6 3 2M20 17l-3-6-3 2" stroke="#fff" stroke-width="1.8" fill="none"/>',
  leaf: '<path d="M20 3C9 3 4 9 5 18c8 1 15-4 15-15z"/><path d="M5 19 15 9" stroke="#0004" stroke-width="1.5"/>',
  tree: '<path d="M12 2l7 9h-4l5 6H4l5-6H5z"/><rect x="11" y="17" width="2.5" height="5"/>',
  heart: '<path d="M12 21C6 16 2 13 2 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 10 2.5C22 13 18 16 12 21z"/>',
  banner: '<path d="M5 2v20" stroke="#fff" stroke-width="2"/><path d="M6 3h13l-3 4 3 4H6z"/>',
  phoenix: '<path d="M12 4c2 3 6 4 10 3-2 4-6 6-10 6S4 11 2 7c4 1 8 0 10-3z"/><path d="M12 13v8M9 21l3-3 3 3" stroke="#fff" stroke-width="1.8" fill="none"/>',
  orb: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18" stroke="#0006" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="#0006"/><circle cx="12" cy="12" r="1.6"/>',
  // element marks (synergies)
  el_fire: '<path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 1.5 1 2 2.5 2 4 1-2 1.5-5 1-8z"/>',
  el_water: '<path d="M12 2c4 6 6 9 6 12a6 6 0 0 1-12 0c0-3 2-6 6-12z"/>',
  el_ice: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>',
  el_electric: '<path d="M14 1 4 14h6l-2 9 10-13h-6z"/>',
  el_earth: '<path d="M2 19l6-10 4 5 3-4 7 9z"/>',
  duo: '<circle cx="8.5" cy="12" r="5.5" fill="none" stroke="#fff" stroke-width="2"/><circle cx="15.5" cy="12" r="5.5" fill="none" stroke="#fff" stroke-width="2"/>',
};

export const EL_COLORS = {
  fire: ['#ffb347', '#e0401f'], water: ['#7fe0ff', '#1f78c8'], ice: ['#e8fbff', '#58b8e8'],
  electric: ['#fff27a', '#e0a010'], earth: ['#e0c088', '#8a5a2a'], trainer: ['#e8d0ff', '#7a4ac8'], duo: ['#f0d0ff', '#9a5ad8'],
};

let uid = 0;
/** Emblem SVG: glyph on a colored disc (or hexagon for traits). */
export function emblem(glyph, palette, { size = 48, shape = 'circle', dim = false } = {}) {
  const [a, b] = EL_COLORS[palette] || EL_COLORS.trainer;
  const id = `g${uid++}`;
  const base = shape === 'hex'
    ? `<path d="M24 2 43 13v22L24 46 5 35V13z" fill="url(#${id})" stroke="#fff6" stroke-width="2"/>`
    : `<circle cx="24" cy="24" r="22" fill="url(#${id})" stroke="#fff8" stroke-width="2"/><circle cx="24" cy="24" r="18" fill="none" stroke="#0003" stroke-width="2"/>`;
  return `<svg class="emblem" width="${size}" height="${size}" viewBox="0 0 48 48" style="${dim ? 'filter:grayscale(.85) brightness(.7)' : ''}">
    <defs><radialGradient id="${id}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs>
    ${base}<g transform="translate(12 12)" fill="#fff" style="filter:drop-shadow(0 1px 1px #0008)">${GLYPHS[glyph] || GLYPHS.orb}</g></svg>`;
}

export const cardIcon = (cardId, opts) => { const c = CARDS[cardId]; return emblem(c.glyph, c.element, opts); };
export const elementIcon = (el, opts) => emblem(`el_${el}`, el, { shape: 'hex', ...opts });

export const SHAPE_LABEL = {
  circle: 'Area', cone: 'Cone', line: 'Line', single: 'Target', leap: 'Leap', wall: 'Wall', self: 'Around self', none: 'Instant',
};
