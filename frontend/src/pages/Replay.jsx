import { useEffect, useState } from 'react'
import Header from '../Header'
import ReplayTree, { useReplayTree } from '../components/ReplayTree'
import GameView from '../components/replay/GameView'
import '../components/ui.css'
import './replay.css'

export default function Replay() {
  const tree = useReplayTree()
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [selected, setSelected] = useState(null) // {run, gameIndex}
  const [game, setGame] = useState(null)         // {status, steps|error} for `selected`

  const { loadRuns } = tree
  useEffect(() => { loadRuns() }, [])

  useEffect(() => {
    if (!selected) return
    let stale = false
    setGame({ status: 'loading' })
    fetch(`/api/replay/runs/${selected.run}/games/${selected.gameIndex}`)
      .then(async res => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || res.statusText)
        return body
      })
      .then(body => !stale && setGame({ status: 'ok', steps: body.steps }))
      .catch(error => !stale && setGame({ status: 'error', error }))
    return () => { stale = true }
  }, [selected])

  // Nothing to see behind the drawer until a game is picked, so it can't be closed before then.
  const canClose = selected !== null
  const close = () => canClose && setDrawerOpen(false)
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && canClose && setDrawerOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [canClose])

  // The drawer stays mounted (slid off-screen when closed), so the tree keeps its state.
  return (
    <div className="replay">
      <button className="menu-btn" title="Menu" disabled={!canClose} onClick={() => setDrawerOpen(o => !o)}>☰</button>
      <div className={`drawer-backdrop${drawerOpen ? ' open' : ''}`} onClick={close} />
      <nav className={`drawer${drawerOpen ? ' open' : ''}`}>
        <h2>Server logs</h2>
        <div className="tree">
          <ReplayTree tree={tree} selected={selected} onSelect={(run, g) => {
            setSelected({ run, gameIndex: g.game_index })
            setDrawerOpen(false)
          }} />
        </div>
      </nav>

      <Header title="Game Replay" subtitle="Step through a logged game's board state, event by event." current="/replay" />
      {!selected && <main><p className="hint">Pick a game from the drawer.</p></main>}
      {game?.status === 'loading' && <main><p className="hint">loading game…</p></main>}
      {game?.status === 'error' && <main><p className="hint">failed to load game: {game.error.message}</p></main>}
      {game?.status === 'ok' && <GameView key={`${selected.run}#${selected.gameIndex}`} steps={game.steps} />}
    </div>
  )
}
