import { STATUS } from '../lib/palette'

// Pieces shared across the stats tabs.

// Renders children(data) once a useAsync state has loaded; a loading hint or the error otherwise.
export function LoadGate({ state, children }) {
  if (state.status === 'error') return <p className="hint">Couldn't load this league: {state.error.message}</p>
  if (state.status === 'loading' || !state.data) return <p className="hint">loading…</p>
  return children(state.data)
}

export function StatTile({ label, value, sub }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}{sub && <span className="tile-sub"> {sub}</span>}</div>
    </div>
  )
}

// A status is always an icon AND a word, never just a color. status: good | warning | serious | critical | neutral.
export function StatusMark({ status, children, compact }) {
  const s = STATUS[status] ?? STATUS.neutral
  return (
    <span className={`status-mark${compact ? ' compact' : ''}`} style={{ color: s.color, borderColor: s.color }}>
      <span aria-hidden="true">{s.icon}</span> {children}
    </span>
  )
}
