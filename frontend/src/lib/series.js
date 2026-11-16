// Small helpers for turning metric records into chart series. Pure, so they are easy to check.

// Group records by a key, preserving record order within each group.
export function groupBy(records, key) {
  const m = new Map()
  for (const r of records) {
    const k = typeof key === 'function' ? key(r) : r[key]
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}

// The last record per deck (records arrive sorted by cumulative_games).
export const latestByDeck = records => new Map([...groupBy(records, 'deck')].map(([d, rs]) => [d, rs[rs.length - 1]]))

// Rows for a multi-series line chart: {x, [seriesKey]: y} sorted by x, with a series simply absent where it has
// no point. `byKey` is {seriesKey: [{x, y}]}.
export function pivot(byKey) {
  const rows = new Map()
  for (const [key, points] of Object.entries(byKey)) {
    for (const { x, y, band } of points) {
      if (!rows.has(x)) rows.set(x, { x })
      rows.get(x)[key] = y
      if (band) rows.get(x)[`${key}__band`] = band // [lo, hi], drawn as a wash behind the line
    }
  }
  return [...rows.values()].sort((a, b) => a.x - b.x)
}

// Mean y per fixed-width x bin, placed at the bin's centre. Noisy per-update points (each deck logs at its own x)
// land on one shared grid, so a chart's hover can read every deck at the same x.
export function binSeries(points, size) {
  const bins = new Map()
  for (const { x, y } of points) {
    if (y == null || Number.isNaN(y)) continue
    const b = Math.floor(x / size)
    if (!bins.has(b)) bins.set(b, [0, 0])
    bins.get(b)[0] += y; bins.get(b)[1] += 1
  }
  return [...bins].sort((a, b) => a[0] - b[0]).map(([b, [sum, n]]) => ({ x: (b + 0.5) * size, y: sum / n }))
}

// All decks' games at each tick pooled into one rate: [{x: cumulative_games, y: sum(wins) / sum(games)}].
export function pooledByTick(records, wins = 'wins', games = 'games') {
  const t = new Map()
  for (const r of records) {
    if (!t.has(r.cumulative_games)) t.set(r.cumulative_games, [0, 0])
    t.get(r.cumulative_games)[0] += r[wins]; t.get(r.cumulative_games)[1] += r[games]
  }
  return [...t].sort((a, b) => a[0] - b[0]).filter(([, [, g]]) => g > 0).map(([x, [w, g]]) => ({ x, y: w / g }))
}

// The records of the newest tick (all that share the largest cumulative_games).
export function newestTick(records) {
  if (!records.length) return []
  const t = Math.max(...records.map(r => r.cumulative_games))
  return records.filter(r => r.cumulative_games === t)
}

export const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

// Games axis: 52800 -> "52.8k"
export const fmtGames = n => (n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n))
// Axis bounds rounded out to multiples of 5% so ticks land on clean numbers: yDomain={PCT_DOMAIN}
export const PCT_DOMAIN = [d => Math.floor(d * 20) / 20, d => Math.ceil(d * 20) / 20]
export const fmtPct = (v, digits = 0) => `${(v * 100).toFixed(digits)}%`

// Wilson score interval for wins out of n games (95%), the same interval the evaluation code reports.
export function wilson(wins, n, z = 1.96) {
  if (!n) return [0, 1]
  const p = wins / n, d = 1 + z * z / n
  const centre = (p + z * z / (2 * n)) / d
  const half = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d
  return [centre - half, centre + half]
}

// The reference "past self" the progress indicator uses (evaluation/verdicts.py): the largest ladder age that is no
// newer than REF_FRACTION x the current age and at least MIN_REF_GAMES old; null if there is none yet.
const REF_FRACTION = 0.6, MIN_REF_GAMES = 10000
export function referenceAnchor(anchors, currentGames) {
  const ok = anchors.filter(a => a >= MIN_REF_GAMES && a <= REF_FRACTION * currentGames)
  return ok.length ? Math.max(...ok) : null
}
