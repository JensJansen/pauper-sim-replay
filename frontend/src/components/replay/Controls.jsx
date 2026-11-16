import { useEffect, useState } from 'react'
import { clampIndex, nextStart, phaseIndex, prevStart } from '../../lib/replayNav'

// game.turn.Phase order; main2 only occurs for combat-enabled decks, so it simply never lights for the rest.
const PHASES = [
  ['untap', 'Untap'], ['upkeep', 'Upkeep'], ['draw', 'Draw'], ['main1', 'Main'],
  ['declare_attackers', 'Attack'], ['declare_blockers', 'Block'], ['combat_damage', 'Damage'],
  ['main2', 'Main 2'], ['end', 'End'],
]

// One row: whose turn it is, the phase pills, what just happened, then the transport (children).
// Tinted in the turn player's seat color. Each phase pill jumps to that phase in the current turn (disabled
// if this turn never entered it, e.g. no combat).
export function TurnBanner({ step, phase, nav, go, children }) {
  const p = step.turn_player_idx
  const pill = (key, label) => {
    const to = phaseIndex(nav, step.turn, key)
    return (
      <button key={key} className={`phase-pill${key === phase ? ' current' : ''}`} disabled={to === null}
              title={to === null ? 'This turn never reached this phase' : `Jump to ${label} of this turn`} onClick={() => go(to)}>
        {label}
      </button>
    )
  }
  return (
    <div className={`turn-banner p${p}`}>
      <div className="turn-who">
        {phase === 'pregame' ? 'Pre-game' : <>Turn {step.turn} · <b>P{p}</b></>}
      </div>
      <div className="phase-track">
        {step.turn === 0 ? pill('pregame', 'Mulligans') : PHASES.map(([key, label]) => pill(key, label))}
      </div>
      <div className="turn-desc" title={step.description}>{step.description}</div>
      {children}
    </div>
  )
}

// Step / phase / turn arrows (icon-only; tooltips carry the names and shortcuts), a scrubber, and an
// event-number box clamped to the game's first..last event.
export function Transport({ i, last, nav, go }) {
  const [draft, setDraft] = useState(String(i))
  useEffect(() => setDraft(String(i)), [i])

  const commit = () => {
    const n = parseInt(draft, 10)
    const to = Number.isNaN(n) ? i : clampIndex(n, last)
    setDraft(String(to)) // show the clamped value right away; the effect above only covers changes from the arrows/scrubber
    go(to)
  }
  const Btn = ({ label, title, to, disabled }) => (
    <button className="tbtn" title={title} aria-label={title} disabled={disabled} onClick={() => go(to)}>{label}</button>
  )
  const nextTurn = nextStart(nav.turnStarts, i), prevTurn = prevStart(nav.turnStarts, i)
  const nextPhase = nextStart(nav.phaseStarts, i), prevPhase = prevStart(nav.phaseStarts, i)
  return (
    <div className="transport">
      <Btn label="|◀" title="Start of this turn (again: the previous turn) — Alt+←" to={prevTurn} disabled={prevTurn === null} />
      <Btn label="◀◀" title="Start of this phase (again: the previous phase) — Shift+←" to={prevPhase} disabled={prevPhase === null} />
      <Btn label="◀" title="Previous event — ←" to={i - 1} disabled={i <= 0} />
      <Btn label="▶" title="Next event — →" to={i + 1} disabled={i >= last} />
      <Btn label="▶▶" title="Next phase / step — Shift+→" to={nextPhase} disabled={nextPhase === null} />
      <Btn label="▶|" title="Start of the next player's turn (their untap) — Alt+→" to={nextTurn} disabled={nextTurn === null} />
      <input type="range" className="scrubber" min={0} max={last} value={i} onChange={e => go(Number(e.target.value))} aria-label="Scrub" />
      <label className="event-box">
        <input value={draft} inputMode="numeric" aria-label="Event number"
               onChange={e => setDraft(e.target.value)} onBlur={commit}
               onKeyDown={e => e.key === 'Enter' && (commit(), e.target.blur())} />
        <span className="hint">/ {last}</span>
      </label>
    </div>
  )
}
