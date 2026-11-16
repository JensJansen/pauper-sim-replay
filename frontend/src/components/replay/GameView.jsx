import { useEffect, useMemo, useState } from 'react'
import { buildNav, clampIndex, nextStart, prevStart } from '../../lib/replayNav'
import Board from './Board'
import DecisionZone from './DecisionZone'
import { TurnBanner, Transport } from './Controls'
import './replay-board.css'

// One reduced game (an array of steps) with all navigation state. Mount it with a `key` per game
// so a new game starts at event 0.
export default function GameView({ steps }) {
  const [i, setI] = useState(0)
  const nav = useMemo(() => buildNav(steps), [steps])
  const last = steps.length - 1
  const go = n => n !== null && setI(clampIndex(n, last))

  // ← / → step one event; Shift = phase; Alt = turn. Ignored while typing in the event box.
  useEffect(() => {
    const onKey = e => {
      if (e.target.tagName === 'INPUT' || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return
      const dir = e.key === 'ArrowRight' ? 1 : -1
      const starts = e.altKey ? nav.turnStarts : e.shiftKey ? nav.phaseStarts : null
      e.preventDefault()
      setI(cur => {
        const to = starts ? (dir > 0 ? nextStart(starts, cur) : prevStart(starts, cur)) : cur + dir
        return to === null ? cur : clampIndex(to, last)
      })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [nav, last])

  const step = steps[i]
  const decisionStep = nav.lastDecision[i] === null ? null : steps[nav.lastDecision[i]]
  return (
    <>
      <TurnBanner step={step} phase={nav.phase[i]} nav={nav} go={go}>
        <Transport i={i} last={last} nav={nav} go={go} />
      </TurnBanner>
      <div className="game-layout">
        <Board step={step} decision={<DecisionZone step={decisionStep} age={i - nav.lastDecision[i]} onJump={go} />} />
      </div>
    </>
  )
}
