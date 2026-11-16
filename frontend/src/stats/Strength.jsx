import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import Term from '../components/Term'
import LineChartCard from '../components/charts/LineChartCard'
import { deckColor } from '../lib/palette'
import { fmtPct, groupBy } from '../lib/series'
import MatchupMatrix from './MatchupMatrix'
import { LoadGate } from './parts'

// Which round robin the chart and the matrix show. The frozen twin leads: it is the only fixed yardstick.
const MODES = {
  primary_vs_training_round_robin: {
    chip: 'vs the frozen twin',
    title: 'Win rate against the frozen twin',
    blurb: <>The <Term k="twin">twin</Term> stopped improving at ~10k games/deck, so this line rises only if the primary league really got stronger. It is the clearest single read on strength.</>,
  },
  primary_vs_primary_round_robin: {
    chip: 'vs the other decks',
    title: 'Win rate against the other primary decks',
    blurb: <>Every deck improves together, so the field average sits near 50% whatever happens. Read this as <Term k="primary_vs_primary">relative deck strength</Term>, not progress.</>,
  },
}

export default function Strength() {
  const { data } = useOutletContext()
  const [check, setCheck] = useState('primary_vs_training_round_robin')
  const mode = MODES[check]
  return (
    <LoadGate state={data}>
      {({ name, metrics, checks }) => {
        const byDeck = groupBy(metrics[check] || [], 'deck')
        const series = [...byDeck.keys()].sort().map(deck => ({
          key: deck, label: deck, color: deckColor(deck),
          points: byDeck.get(deck).filter(r => r.win_rate != null).map(r => ({ x: r.cumulative_games, y: r.win_rate })),
        }))
        return (
          <>
            <div className="toolbar">
              {Object.entries(MODES).map(([id, m]) => (
                <button key={id} className={`chip${id === check ? ' active' : ''}`} onClick={() => setCheck(id)}>{m.chip}</button>
              ))}
            </div>
            <LineChartCard title={mode.title} subtitle={mode.blurb} help="validation" series={series}
                           yFormat={v => fmtPct(v)} yDomain={[0, 1]} refLines={[{ y: 0.5, label: '50%' }]} />
            <h2 className="section-h">Matchups</h2>
            <MatchupMatrix key={`${name}:${check}`} league={name} checks={checks} check={check} />
          </>
        )
      }}
    </LoadGate>
  )
}
