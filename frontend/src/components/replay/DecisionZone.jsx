import { decisionPick } from '../../lib/replayNav'

// The agent's most recent decision, as bars sorted by probability, in the deciding player's color.
// `step` is the decision_weights step; `age` is how many events ago it was (0 = this event, shown at full
// strength; older = dimmed, with a link back to it). A decision_weights step has exactly one deciding
// player (step.active_player_idx).
export default function DecisionZone({ step, age, onJump }) {
  if (!step) return <div className="decision-zone idle"><span className="row-tag">Agent decision</span><span className="hint">none yet</span></div>

  const { chosen, best, surprise } = decisionPick(step)
  const pct = c => `${(c.probability * 100).toFixed(c.probability < 0.01 && c.probability > 0 ? 2 : 0)}%`
  const rows = [...step.candidates].sort((a, b) => b.probability - a.probability)
  const value = step.value_estimate
  return (
    <div className={`decision-zone p${step.active_player_idx}${age > 0 ? ' stale' : ''}`}>
      <div className="decision-head">
        <span className="row-tag">Agent decision · <b>P{step.active_player_idx}</b></span>
        {age > 0
          ? <button className="decision-from" title="Jump to that decision" onClick={() => onJump(step.index)}>from event {step.index} · {age} ago ↩</button>
          : <span className="decision-from now">this event</span>}
        {surprise && (
          <span className="decision-flag" title="The agent samples from its weights; this pick was not its most likely option">
            ⚠ sampled {pct(chosen)} over {pct(best)}
          </span>
        )}
        {typeof value === 'number' && <span className="decision-v" title="Critic's value estimate for the deciding player">V {value > 0 ? '+' : ''}{value.toFixed(2)}</span>}
      </div>
      <div className="decision-bars">
        {rows.map(c => (
          <div key={c.index} className={`dbar${c.index === step.chosen_index ? ' chosen' : ''}`}>
            <span className="dbar-label" title={c.label}>{c.index === step.chosen_index ? '✓ ' : ''}{c.label}</span>
            <span className="dbar-track"><span className="dbar-fill" style={{ width: `${c.probability * 100}%` }} /></span>
            <span className="dbar-pct">{pct(c)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
