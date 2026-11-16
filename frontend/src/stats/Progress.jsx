import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import Term from '../components/Term'
import LineChartCard from '../components/charts/LineChartCard'
import { HelpLink } from '../components/ui'
import { NEUTRAL, deckColor, divergingColor, sequentialColor } from '../lib/palette'
import { fmtGames, fmtPct, groupBy, mean, newestTick, referenceAnchor } from '../lib/series'
import HeatTable from './HeatTable'
import { LoadGate, StatusMark } from './parts'

const STATUS_OF = { IMPROVING: 'good', CHURNING: 'warning', STUCK: 'serious', FLAT: 'neutral', WARMUP: 'neutral' }

// The verdict at every validation tick, and the pooled score (with its 95% interval) behind it.
function Indicator({ records }) {
  const ticks = records.filter(r => r.deck === 'ALL')
  if (!ticks.length) return <p className="hint">No progress indicator yet. It is written at each validation tick once a snapshot is old enough to compare against.</p>
  const points = ticks.filter(r => r.score != null).map(r => ({ x: r.cumulative_games, y: r.score, band: [r.lo, r.hi] }))
  return (
    <>
      <div className="timeline">
        {ticks.map(r => (
          <StatusMark key={r.cumulative_games} status={STATUS_OF[r.label] ?? 'neutral'} compact>
            {fmtGames(r.cumulative_games)} · <Term k={r.label.toLowerCase()}>{r.label}</Term>
          </StatusMark>
        ))}
      </div>
      <LineChartCard title={<><Term k="pooled">Pooled score</Term> against the reference self</>}
                     subtitle="Shaded band = 95% interval. Above 50% with the whole band clear of it means the current agents beat their older selves."
                     series={[{ key: 'score', label: 'Pooled score', color: NEUTRAL, points }]}
                     yFormat={v => fmtPct(v)} yDomain={[0.3, 0.8]} refLines={[{ y: 0.5, label: 'no progress' }]} height={220} />
    </>
  )
}

// A heat table of the newest tick (decks x anchor ages) next to a trend of one anchor over time.
// `value` reads the number from a record; `paint` colors it.
function HistoryBlock({ records, value, fmt, paint, corner, yDomain, refLines = [], unit, trendTitle, defaultAnchor }) {
  const anchors = [...new Set(records.map(r => r.anchor_games))].sort((a, b) => a - b)
  const [picked, setPicked] = useState(null)
  if (!records.length) return <p className="hint">No data yet.</p>
  const anchor = anchors.includes(picked) ? picked : (defaultAnchor && anchors.includes(defaultAnchor) ? defaultAnchor : anchors[anchors.length - 1])
  const now = newestTick(records)
  const decks = [...new Set(now.map(r => r.deck))].sort()
  const series = [...groupBy(records.filter(r => r.anchor_games === anchor), 'deck')].sort((a, b) => a[0].localeCompare(b[0])).map(([deck, rs]) => ({
    key: deck, label: deck, color: deckColor(deck), points: rs.map(r => ({ x: r.cumulative_games, y: value(r) })),
  }))
  return (
    <div className="two-col">
      <div className="card heat-card">
        <div className="chart-head"><div className="chart-title">Latest tick <span className="hint">({now[0].cumulative_games.toLocaleString()} games/deck)</span></div></div>
        <div className="heat-fill"><HeatTable rows={decks} cols={anchors} corner={corner}
                   cell={(d, a) => {
                     const r = now.find(x => x.deck === d && x.anchor_games === a)
                     return r ? { text: fmt(value(r)), color: paint(value(r)), title: r.games ? `${r.games} games` : undefined } : null
                   }} /></div>
      </div>
      <LineChartCard title={`${trendTitle} ${anchor.toLocaleString()} games`} series={series} yFormat={fmt}
                     yDomain={yDomain} refLines={refLines} height={230}
                     toolbar={(
                       <div className="toolbar chip-row">
                         <span className="hint">{unit}</span>
                         {anchors.map(a => <button key={a} className={`chip${a === anchor ? ' active' : ''}`} onClick={() => setPicked(a)}>{a.toLocaleString()}</button>)}
                       </div>
                     )} />
    </div>
  )
}

function Section({ title, help, children, hint }) {
  return (
    <>
      <h2 className="section-h">{title} <HelpLink to={help} /></h2>
      {hint && <p className="hint section-hint">{hint}</p>}
      {children}
    </>
  )
}

export default function Progress() {
  const { data } = useOutletContext()
  return (
    <LoadGate state={data}>
      {({ metrics }) => {
        const own = metrics.strength_history || [], field = metrics.strength_field || []
        const move = metrics.policy_movement || [], scale = metrics.policy_scale || []
        const newest = own.length ? Math.max(...own.map(r => r.cumulative_games)) : null
        const refAnchor = newest == null ? null : referenceAnchor([...new Set(own.map(r => r.anchor_games))], newest)
        const scaleNow = newestTick(scale)
        const adj = mean(scaleNow.map(r => r.adjacent_js).filter(v => v != null)), rnd = mean(scaleNow.map(r => r.random_js).filter(v => v != null))
        const scoreFmt = v => fmtPct(v)
        const entropySeries = [...groupBy(scale, 'deck')].sort((a, b) => a[0].localeCompare(b[0])).map(([deck, rs]) => ({
          key: deck, label: deck, color: deckColor(deck), points: rs.map(r => ({ x: r.cumulative_games, y: r.entropy })),
        }))
        return (
          <>
            <Section title="Is it still learning?" help="indicator">
              <Indicator records={metrics.progress_indicator || []} />
            </Section>

            <Section title="Against their own past selves" help="history-checks"
                     hint={<>Score of each deck's current agent against its own frozen snapshot at an <Term k="anchor_age">anchor age</Term> (50% = no difference). Against much older selves it should sit well above 50%; against recent ones it sinks toward 50%. Cells near 100% are saturated and say little. Still rising on a fixed old anchor = still improving.</>}>
              <HistoryBlock records={own} value={r => r.score} fmt={scoreFmt} paint={divergingColor} corner="deck ↓ · older self at →"
                            yDomain={[0, 1]} refLines={[{ y: 0.5, label: '50%' }]} unit="Trend against the self at" trendTitle="Strength vs the own self from" defaultAnchor={refAnchor} />
            </Section>

            <Section title="Against every deck's history" help="history-checks"
                     hint="All decks' current agents (pooled) against one deck's snapshot at each age. It falls as that deck improves and flattens where it stopped, a fixed yardstick on each deck's learning, and a check that progress generalizes beyond a deck's own past.">
              <HistoryBlock records={field} value={r => r.score} fmt={scoreFmt} paint={divergingColor} corner="opponent deck ↓ · at age →"
                            yDomain={[0, 1]} refLines={[{ y: 0.5, label: '50%' }]} unit="Trend against the deck at" trendTitle="All decks vs this deck, snapshot from" defaultAnchor={refAnchor} />
            </Section>

            <Section title="Policy movement" help="history-checks"
                     hint={<>Mean <Term k="js">Jensen-Shannon divergence</Term> between the current policy and a snapshot, over a fixed suite of mid-game decisions (0 = identical, 0.693 = disjoint).
                       {adj != null && <> One snapshot interval apart is about <b>{adj.toFixed(3)}</b>; a random net vs the current policy is about <b>{rnd.toFixed(3)}</b>.</>} Movement is not progress: read it next to the strength tables above.</>}>
              <HistoryBlock records={move} value={r => r.js} fmt={v => v.toFixed(3)} paint={v => sequentialColor(v, 0.3)} corner="deck ↓ · vs snapshot at →"
                            yDomain={[0, 'auto']} refLines={adj != null ? [{ y: adj, label: 'one interval apart' }] : []} unit="Distance from the snapshot at" trendTitle="Distance from the snapshot from" />
              <div style={{ marginTop: 12 }}>
                <LineChartCard title={<><Term k="policy_entropy">Policy entropy</Term> on the probe suite</>}
                               subtitle="How undecided the policy is on the same fixed positions over time."
                               series={entropySeries} yFormat={v => v.toFixed(2)} height={220} />
              </div>
            </Section>
          </>
        )
      }}
    </LoadGate>
  )
}
