import { useState } from 'react'
import Term from '../components/Term'
import { divergingColor } from '../lib/palette'
import { fmtPct } from '../lib/series'
import { loadCheck, useAsync } from '../lib/statsApi'

// The pairing matrix of one round-robin snapshot: the row deck's win rate against the column deck. Cells run
// red (< 50%) to blue (> 50%) through gray at 50%, and the number is always printed. Column headers sort the rows.
const FIELDS = {
  primary_vs_training_round_robin: { a: 'primary_deck', b: 'training_deck', aWins: 'primary_wins', bWins: 'training_wins', mirrored: false },
  primary_vs_primary_round_robin: { a: 'deck_a', b: 'deck_b', aWins: 'a_wins', bWins: 'b_wins', mirrored: true },
}

const wrapName = s => s.split('_').flatMap((w, i, all) => (i < all.length - 1 ? [w + '_', <wbr key={i} />] : [w]))

export default function MatchupMatrix({ league, checks, check }) {
  const snapshots = checks.filter(c => c.check === check && c.deck === null).sort((a, b) => b.cumulative_games - a.cumulative_games)
  const [pick, setPick] = useState(null)       // chosen snapshot's cumulative_games; null = the newest
  const [showRecord, setShowRecord] = useState(false)
  const [sort, setSort] = useState({ col: null, dir: 'desc' })
  const snap = snapshots.find(s => s.cumulative_games === pick) ?? snapshots[0]
  const detail = useAsync(() => (snap ? loadCheck(league, snap.path) : Promise.resolve(null)), [league, snap?.path])

  if (!snapshots.length) return <p className="hint">No round-robin snapshots for this check yet.</p>
  const f = FIELDS[check]

  const body = () => {
    if (detail.status === 'error') return <p className="hint">Couldn't load this snapshot: {detail.error.message}</p>
    if (detail.status !== 'ok' || detail.data?.cumulative_games !== snap.cumulative_games) return <p className="hint">loading…</p> // not a stale snapshot's data
    const pairings = detail.data.pairings
    const rowDecks = [...new Set(pairings.map(p => p[f.a]))].sort()
    const colDecks = [...new Set(pairings.map(p => p[f.b]))].sort()
    // primary-vs-primary plays each pair once, so mirror it to fill both triangles; vs-training is a full cross product already
    const cell = new Map(), rowT = new Map(rowDecks.map(d => [d, { wins: 0, games: 0 }])), colT = new Map(colDecks.map(d => [d, { wins: 0, games: 0 }]))
    const add = (m, k, w, g) => { m.get(k).wins += w; m.get(k).games += g }
    for (const p of pairings) {
      cell.set(`${p[f.a]}|${p[f.b]}`, { games: p.games, wins: p[f.aWins] })
      add(rowT, p[f.a], p[f.aWins], p.games); add(colT, p[f.b], p[f.bWins], p.games)
      if (f.mirrored) {
        cell.set(`${p[f.b]}|${p[f.a]}`, { games: p.games, wins: p[f.bWins] })
        add(rowT, p[f.b], p[f.bWins], p.games); add(colT, p[f.a], p[f.aWins], p.games)
      }
    }
    const value = t => (!t || !t.games ? null : t.wins / t.games)
    const show = t => (!t || !t.games ? '—' : showRecord ? `${t.wins}/${t.games}` : fmtPct(t.wins / t.games))
    const key = (d, col) => value(col === 'overall' ? rowT.get(d) : cell.get(`${d}|${col}`)) ?? -1
    const rows = sort.col == null ? rowDecks : [...rowDecks].sort((x, y) => {
      const diff = key(y, sort.col) - key(x, sort.col)
      return diff !== 0 ? (sort.dir === 'desc' ? diff : -diff) : x.localeCompare(y)
    })
    const sortBy = col => setSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }))
    const arrow = col => (sort.col === col ? (sort.dir === 'desc' ? ' ▾' : ' ▴') : '')
    return (
      <table className="matrix">
        <thead>
          <tr>
            <th />
            {colDecks.map(d => (
              <th key={d} className="sortable" onClick={() => sortBy(d)}>{wrapName(d)}{arrow(d)}<span className="matrix-sub">{show(colT.get(d))}</span></th>
            ))}
            <th className="sortable matrix-overall" onClick={() => sortBy('overall')}>Overall{arrow('overall')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(a => (
            <tr key={a}>
              <th>{wrapName(a)}<span className="matrix-sub">{show(rowT.get(a))}</span></th>
              {colDecks.map(b => {
                const t = cell.get(`${a}|${b}`), v = value(t)
                return v == null
                  ? <td key={b} className="matrix-empty">—</td>
                  : <td key={b} className="matrix-cell" style={{ background: divergingColor(v) }} title={`${a} vs ${b}: ${t.wins}/${t.games} (${fmtPct(v)})`}>{show(t)}</td>
              })}
              <td className="matrix-cell matrix-overall" style={{ background: value(rowT.get(a)) == null ? 'none' : divergingColor(value(rowT.get(a))) }}
                  title={`${a} vs the field: ${show(rowT.get(a))}`}>{show(rowT.get(a))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div className="card matrix-card">
      <div className="matrix-toolbar">
        <div>
          <div className="chart-title">Pairing matrix <span className="hint">row's <Term k="win_rate">win rate</Term> vs column</span></div>
        </div>
        <label className="toggle-switch">
          <span className={showRecord ? '' : 'on'}>Win %</span>
          <input type="checkbox" checked={showRecord} onChange={e => setShowRecord(e.target.checked)} />
          <span className="toggle-track" />
          <span className={showRecord ? 'on' : ''}>Wins/games</span>
        </label>
        <label className="hint">Snapshot&nbsp;
          <select value={snap.cumulative_games} onChange={e => setPick(Number(e.target.value))}>
            {snapshots.map(s => <option key={s.cumulative_games} value={s.cumulative_games}>{s.cumulative_games.toLocaleString()} games/deck</option>)}
          </select>
        </label>
      </div>
      {body()}
    </div>
  )
}
