// Run: node --test src/lib/replayNav.test.mjs   (from frontend/)
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNav, clampIndex, decisionPick, nextStart, phaseIndex, prevStart } from './replayNav.js'

const st = (turn, phase, kind = 'x') => ({ turn, phase, kind })
const steps = [
  st(0, null), st(0, null),                       // 0,1 pregame
  st(1, null, 'turn_start'), st(1, 'main1'), st(1, 'main1'), st(1, null), // 2 untap; 3,4 main1; 5 inherits main1
  st(1, 'end'),                                   // 6
  st(2, null, 'turn_start'), st(2, 'upkeep'),     // 7 untap; 8 upkeep
]

test('phase and turn groups', () => {
  const nav = buildNav(steps)
  assert.deepEqual(nav.phase, ['pregame', 'pregame', 'untap', 'main1', 'main1', 'main1', 'end', 'untap', 'upkeep'])
  assert.deepEqual(nav.phaseStarts, [0, 2, 3, 6, 7, 8])
  assert.deepEqual(nav.turnStarts, [0, 2, 7])
})

test('next/prev: mid-group prev goes to the group start, a start goes to the previous group', () => {
  const { phaseStarts, turnStarts } = buildNav(steps)
  assert.equal(nextStart(turnStarts, 4), 7)          // skips the rest of turn 1 -> start of the other player's turn
  assert.equal(prevStart(turnStarts, 4), 2)          // back to the start of this turn
  assert.equal(prevStart(turnStarts, 2), 0)          // already at a start -> previous turn
  assert.equal(nextStart(phaseStarts, 4), 6)
  assert.equal(nextStart(phaseStarts, 8), null)      // last group
  assert.equal(prevStart(phaseStarts, 0), null)      // first group
})

test('phaseIndex: first step of a phase within a turn, null if the turn never had it', () => {
  const nav = buildNav(steps)
  assert.equal(phaseIndex(nav, 1, 'main1'), 3)
  assert.equal(phaseIndex(nav, 1, 'untap'), 2)
  assert.equal(phaseIndex(nav, 2, 'untap'), 7)
  assert.equal(phaseIndex(nav, 2, 'main1'), null)
  assert.equal(phaseIndex(nav, 0, 'pregame'), 0)
})

test('lastDecision carries the latest decision_weights step forward', () => {
  const dec = { turn: 1, phase: 'main1', kind: 'decision_weights', candidates: [{ index: 0, probability: 1 }] }
  const nav = buildNav([st(0, null), dec, st(1, 'main1'), st(1, 'main1'), { ...dec }, st(1, 'end')])
  assert.deepEqual(nav.lastDecision, [null, 1, 1, 1, 4, 4])
})

test('decisionPick flags a sampled non-argmax choice', () => {
  const cands = [{ index: 7, probability: 0.8 }, { index: 9, probability: 0.2 }]
  assert.equal(decisionPick({ candidates: cands, chosen_index: 7 }).surprise, false)
  const p = decisionPick({ candidates: cands, chosen_index: 9 })
  assert.equal(p.surprise, true)
  assert.equal(p.best.index, 7)
  assert.equal(decisionPick({ candidates: [{ index: 1, probability: 0.5 }, { index: 2, probability: 0.5 }], chosen_index: 2 }).surprise, false) // tie is not a surprise
})

test('clampIndex', () => {
  assert.equal(clampIndex(-5, 8), 0)
  assert.equal(clampIndex(99, 8), 8)
  assert.equal(clampIndex(4, 8), 4)
})
