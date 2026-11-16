// Chart colors. The app is dark-only, so these are the dark-surface steps of the validated categorical palette
// (checked with the dataviz skill's validate_palette.js: every gate passes on adjacent pairs).
//
// Color follows the ENTITY, never its rank: a deck keeps its slot on every tab and whatever else is filtered in
// or out. Unknown decks get the neutral "other" gray instead of a cycled hue.

const SLOTS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
export const OTHER = '#8a909b'

// The 4-deck league's roster order (training_configs/small_league.json); append a deck here to give it a slot.
const DECKS = ['rakdos_madness', 'dmir_terror', 'elves', 'mono_red_rally']
export const deckColor = name => SLOTS[DECKS.indexOf(name)] ?? OTHER

// Training arms (leagues) in the Compare tab: one more entity type, one fixed order.
const ARMS = ['small_baseline', 'small_control50k', 'small_gamma1', 'small_lrdecay50k']
export const armColor = name => SLOTS[ARMS.indexOf(name)] ?? OTHER

// Status colors are fixed and reserved: always shown with an icon and a word, never color alone.
export const STATUS = {
  good: { color: '#0ca30c', icon: '✓' },
  warning: { color: '#fab219', icon: '⚠' },
  serious: { color: '#ec835a', icon: '▲' },
  critical: { color: '#d03b3b', icon: '✕' },
  neutral: { color: '#8a909b', icon: '•' },
}

export const SURFACE = '#1b1e24'
// A single-series line that isn't a deck or an arm (a verdict score, a schedule): a neutral light gray, so it can't be mistaken for an entity.
export const NEUTRAL = '#c3c8d2'
export const MUTED = '#6b717c'

// Sequential scale for a distance (0 = identical): one blue hue, light to dark. `max` is the value that saturates it.
export function sequentialColor(v, max) {
  return `rgba(57,135,229,${(0.08 + 0.62 * Math.min(1, v / max)).toFixed(2)})`
}

// Diverging scale for a score where 50% means "no difference": red below, blue above, gray at the midpoint.
export function divergingColor(p) {
  const d = Math.max(-1, Math.min(1, (p - 0.5) / 0.5))
  const [r, g, b] = d >= 0 ? [57, 135, 229] : [230, 103, 103]
  return `rgba(${r},${g},${b},${(Math.abs(d) * 0.7).toFixed(2)})`
}
