// Run: node --test src/lib/series.test.mjs   (from frontend/)
import test from 'node:test'
import assert from 'node:assert/strict'
import { binSeries, fmtGames, newestTick, pivot, pooledByTick, referenceAnchor, wilson } from './series.js'

test('pivot merges series on x and leaves gaps where a series has no point', () => {
  const rows = pivot({ a: [{ x: 2, y: 20 }, { x: 1, y: 10 }], b: [{ x: 2, y: 5 }, { x: 3, y: 7 }] })
  assert.deepEqual(rows, [{ x: 1, a: 10 }, { x: 2, a: 20, b: 5 }, { x: 3, b: 7 }])
})

test('fmtGames', () => {
  assert.equal(fmtGames(900), '900')
  assert.equal(fmtGames(52800), '52.8k')
  assert.equal(fmtGames(10000), '10k')
})

test('wilson interval brackets the estimate and narrows with n', () => {
  const [lo, hi] = wilson(55, 100)
  assert.ok(lo < 0.55 && hi > 0.55)
  const [lo2, hi2] = wilson(550, 1000)
  assert.ok(hi2 - lo2 < hi - lo)
  assert.deepEqual(wilson(0, 0), [0, 1])
})

test('referenceAnchor follows the indicator rule (<= 0.6x current, >= 10k)', () => {
  const ladder = [1000, 5000, 10000, 20000, 30000, 40000]
  assert.equal(referenceAnchor(ladder, 50000), 30000)   // 0.6 * 50000 = 30000
  assert.equal(referenceAnchor(ladder, 20000), 10000)   // 0.6 * 20000 = 12000 -> the 10k anchor qualifies
  assert.equal(referenceAnchor(ladder, 15000), null)    // 0.6 * 15000 = 9000: nothing is old enough AND recent enough
  assert.equal(referenceAnchor([1000, 5000], 50000), null)
})

test('pivot carries a band alongside the value', () => {
  assert.deepEqual(pivot({ a: [{ x: 1, y: 0.5, band: [0.4, 0.6] }] }), [{ x: 1, a: 0.5, a__band: [0.4, 0.6] }])
})

test('binSeries averages per fixed bin and centres it', () => {
  const out = binSeries([{ x: 10, y: 1 }, { x: 40, y: 3 }, { x: 120, y: 5 }, { x: 130, y: null }], 100)
  assert.deepEqual(out, [{ x: 50, y: 2 }, { x: 150, y: 5 }])
})

test('pooledByTick weights decks by their games, not equally', () => {
  const recs = [
    { cumulative_games: 10, wins: 9, games: 10 }, { cumulative_games: 10, wins: 0, games: 90 },
    { cumulative_games: 20, wins: 5, games: 10 },
  ]
  assert.deepEqual(pooledByTick(recs), [{ x: 10, y: 0.09 }, { x: 20, y: 0.5 }])
})

test('newestTick keeps only the latest tick', () => {
  assert.deepEqual(newestTick([{ cumulative_games: 1, v: 'a' }, { cumulative_games: 2, v: 'b' }, { cumulative_games: 2, v: 'c' }]).map(r => r.v), ['b', 'c'])
  assert.deepEqual(newestTick([]), [])
})
