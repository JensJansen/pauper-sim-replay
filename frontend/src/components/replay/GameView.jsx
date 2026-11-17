import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { buildNav, clampIndex, nextStart, prevStart } from '../../lib/replayNav'
import Board from './Board'
import DecisionZone from './DecisionZone'
import { TurnBanner, Transport } from './Controls'
import './replay-board.css'

const K_MIN = 0.25, K_MAX = 2.2
const ROW_CARDS = 10 // a battlefield row should hold this many cards side by side before it wraps

// Sizes the board to the window: finds the largest --k (card size; see replay-board.css) at which the whole board fits the
// space below the banner and a full row of cards fits across the field, and makes the layout exactly that tall. It measures
// the real rendered layout (two probe sizes, then a correction pass), so it follows CSS changes and never goes stale;
// rows and the center strip have fixed heights, so the answer doesn't depend on what is on the board. Re-fits on resize.
function useFitBoard(ref) {
  useLayoutEffect(() => {
    const layout = ref.current
    if (!layout) return undefined
    const fit = () => {
      const board = layout.querySelector('.board'), field = layout.querySelector('.field')
      if (!board || !field) return
      const set = k => layout.style.setProperty('--k', k.toFixed(4))
      layout.style.setProperty('--avail', 'auto') // measure the board's natural height, not the old fitted one
      const top = layout.getBoundingClientRect().top + window.scrollY
      const avail = Math.max(240, window.innerHeight - top)
      const cs = getComputedStyle(layout)
      const fitH = avail - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) // the board gets the height inside the layout's padding
      const probe = k => { set(k); return { h: board.offsetHeight, w: field.clientWidth } }
      const a = probe(1), b = probe(0.5)
      const slopeH = (a.h - b.h) / 0.5, slopeW = (b.w - a.w) / 0.5 // height grows, field width shrinks, as k grows
      const kHeight = (fitH - (a.h - slopeH)) / slopeH
      const kWidth = ((a.w + slopeW) - 24) / (ROW_CARDS * 130 + slopeW) // width left at k=0, less padding, over the cards' width per k
      let k = Math.min(Math.max(Math.min(kHeight, kWidth), K_MIN), K_MAX)
      for (let n = 0; n < 3; n += 1) { // the model is nearly linear; correct for what it misses (borders, rounding, a wrapped row)
        const { h } = probe(k)
        if (Math.abs(h - fitH) < 2) break
        const next = Math.min(Math.max(k + (fitH - h) / slopeH, K_MIN), Math.min(K_MAX, Math.max(kWidth, K_MIN)))
        if (next === k) break
        k = next
      }
      set(k)
      layout.style.setProperty('--avail', `${avail}px`)
    }
    let raf = 0
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit) }
    fit()
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); cancelAnimationFrame(raf) }
  }, [ref])
}

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

  const layoutRef = useRef(null)
  useFitBoard(layoutRef)

  const step = steps[i]
  const decisionStep = nav.lastDecision[i] === null ? null : steps[nav.lastDecision[i]]
  return (
    <>
      <TurnBanner step={step} phase={nav.phase[i]} nav={nav} go={go}>
        <Transport i={i} last={last} nav={nav} go={go} />
      </TurnBanner>
      <div className="game-layout" ref={layoutRef}>
        <Board step={step} decision={<DecisionZone step={decisionStep} age={i - nav.lastDecision[i]} onJump={go} />} />
      </div>
    </>
  )
}
