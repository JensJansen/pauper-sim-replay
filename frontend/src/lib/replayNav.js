// Navigation over a reduced game's steps (array of step objects, step.index === array position).
//
// "Phase" = a maximal run of steps sharing (turn, phase); "turn" = a run sharing step.turn (the engine
// counts each player's turn separately, so the next turn is always the other player's). Pre-game steps
// (mulligans, before any turn_start) have no phase and form one "pregame" group.

// The phase each step belongs to. A step with phase null inherits the previous one, and a turn_start
// begins its turn in untap.
export function effectivePhases(steps) {
  let cur = 'pregame'
  return steps.map(s => {
    if (s.kind === 'turn_start') cur = 'untap'
    else if (s.phase) cur = s.phase
    return cur
  })
}

const groupStarts = keys => keys.flatMap((k, i) => (i === 0 || k !== keys[i - 1] ? [i] : []))

export function buildNav(steps) {
  const phase = effectivePhases(steps)
  // First step of each phase within each turn, keyed "turn:phase" -- what a clickable phase pill jumps to.
  const phaseFirst = new Map()
  steps.forEach((s, i) => { const k = `${s.turn}:${phase[i]}`; if (!phaseFirst.has(k)) phaseFirst.set(k, i) })
  // For each step, the index of the most recent decision_weights step at or before it (null before the first):
  // lets the UI keep showing the last decision, dimmed, on events that aren't one.
  let lastDecisionSeen = null
  const lastDecision = steps.map((s, i) => {
    if (s.kind === 'decision_weights' && s.candidates?.length) lastDecisionSeen = i
    return lastDecisionSeen
  })
  return {
    phase,
    phaseFirst,
    lastDecision,
    phaseStarts: groupStarts(steps.map((s, i) => `${s.turn}:${phase[i]}`)),
    turnStarts: groupStarts(steps.map(s => s.turn)),
  }
}

// First group start after i, or null at the last group.
export const nextStart = (starts, i) => starts.find(s => s > i) ?? null
// Largest group start before i: the current group's start when i is mid-group, the previous group's when i is a start.
export const prevStart = (starts, i) => [...starts].reverse().find(s => s < i) ?? null

// The first step of `phase` in `turn`, or null if that turn never entered it (e.g. no combat).
export const phaseIndex = (nav, turn, phase) => nav.phaseFirst.get(`${turn}:${phase}`) ?? null

// How the agent's pick compares with its own most likely option: {chosen, best} candidates, `surprise` when it
// sampled something other than the argmax (a lower-probability option).
export function decisionPick(step) {
  const chosen = step.candidates.find(c => c.index === step.chosen_index)
  const best = step.candidates.reduce((a, c) => (c.probability > a.probability ? c : a))
  return { chosen, best, surprise: !!chosen && chosen.probability < best.probability - 1e-9 }
}

export const clampIndex = (n, last) => Math.min(Math.max(n, 0), last)
