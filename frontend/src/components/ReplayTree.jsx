import { useState } from 'react'

// Expandable League -> replay file -> game tree. Any number of nodes can be open at once.
// All state (open nodes, fetched game lists) is owned by the caller's useReplayTree(), so the tree
// survives the drawer closing; it resets only when the owning page unmounts.

const getJson = async url => {
  const res = await fetch(url)
  const body = await res.json()
  if (!res.ok) throw new Error(body.error || res.statusText)
  return body
}

export function useReplayTree() {
  const [runs, setRuns] = useState({ status: 'loading' }) // {status, data|error}
  const [open, setOpen] = useState(() => new Set())       // node keys: "league:<name>" / "run:<file>"
  const [games, setGames] = useState({})                  // run name -> {status, data|error}

  const loadRuns = () => getJson('/api/replay/runs')
    .then(data => setRuns({ status: 'ok', data }))
    .catch(error => setRuns({ status: 'error', error }))

  const loadGames = name => {
    setGames(g => ({ ...g, [name]: { status: 'loading' } }))
    return getJson(`/api/replay/runs/${name}/games`)
      .then(data => setGames(g => ({ ...g, [name]: { status: 'ok', data: data.games } })))
      .catch(error => setGames(g => ({ ...g, [name]: { status: 'error', error } })))
  }

  const toggle = (key, runName) => {
    setOpen(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
    if (runName && !games[runName]) loadGames(runName) // first expand only; retry via the error row
  }
  return { runs, loadRuns, open, toggle, games, loadGames }
}

const Chevron = ({ open }) => <span className="chev">{open ? '▾' : '▸'}</span>

const runTitle = r => r.league && r.cumulative_games != null
  ? `Round-robin review — ${r.cumulative_games.toLocaleString()} games/deck` : r.name

function Games({ state, onRetry, selected, onSelect, run }) {
  if (!state || state.status === 'loading') return <p className="hint tree-note">loading games…</p>
  if (state.status === 'error')
    return <p className="hint tree-note">failed: {state.error.message} <button className="link" onClick={onRetry}>retry</button></p>
  if (!state.data.length) return <p className="hint tree-note">0 games in this file</p>
  return state.data.map(g => {
    const isSel = selected && selected.run === run && selected.gameIndex === g.game_index
    return (
      <button key={g.game_index} className={`tree-row game${isSel ? ' selected' : ''}`} onClick={() => onSelect(run, g)}>
        <div className="tree-title">{g.header}</div>
        <div className="tree-detail">{g.detail}</div>
      </button>
    )
  })
}

export default function ReplayTree({ tree, selected, onSelect }) {
  const { runs, open, toggle, games, loadGames } = tree
  if (runs.status === 'loading') return <p className="hint">loading…</p>
  if (runs.status === 'error') return <p className="hint">failed to list: {runs.error.message}</p>
  if (!runs.data.length) return <p className="hint">no server logs yet</p>

  // The API already orders leagues by name, newest game count first; files outside any league go last.
  const groups = new Map()
  for (const r of runs.data) {
    const g = r.league || 'Other'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(r)
  }
  return [...groups].map(([league, files]) => {
    const lKey = `league:${league}`
    const lOpen = open.has(lKey)
    return (
      <div key={league}>
        <button className="tree-row league" aria-expanded={lOpen} onClick={() => toggle(lKey)}>
          <Chevron open={lOpen} /><span className="tree-title">{league}</span><span className="hint">{files.length}</span>
        </button>
        {lOpen && (
          <div className="tree-children">
            {files.map(r => {
              const rKey = `run:${r.name}`
              const rOpen = open.has(rKey)
              return (
                <div key={r.name}>
                  <button className="tree-row run" aria-expanded={rOpen} onClick={() => toggle(rKey, r.name)}>
                    <Chevron open={rOpen} />
                    <span>
                      <div className="tree-title">{runTitle(r)}</div>
                    </span>
                  </button>
                  {rOpen && (
                    <div className="tree-children">
                      <Games state={games[r.name]} run={r.name} selected={selected} onSelect={onSelect} onRetry={() => loadGames(r.name)} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  })
}
