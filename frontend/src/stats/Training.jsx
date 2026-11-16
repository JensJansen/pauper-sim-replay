import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import Term from '../components/Term'
import LineChartCard from '../components/charts/LineChartCard'
import { HelpLink } from '../components/ui'
import { MUTED, NEUTRAL, deckColor, divergingColor } from '../lib/palette'
import { binSeries, fmtPct, groupBy, latestByDeck, wilson } from '../lib/series'
import { LoadGate } from './parts'

// The PPO diagnostics shown as small multiples, every deck overlaid in each panel. `ref` draws a labelled reference line.
const PANELS = [
  { key: 'entropy', term: 'entropy', label: 'Entropy', fmt: v => v.toFixed(3) },
  { key: 'approx_kl', term: 'approx_kl', label: 'Approx KL', fmt: v => v.toFixed(4), ref: r => (r.target_kl != null ? { y: r.target_kl, label: 'target KL' } : null) },
  { key: 'clip_fraction', term: 'clip_fraction', label: 'Clip fraction', fmt: v => fmtPct(v, 1) },
  { key: 'explained_variance', term: 'explained_variance', label: 'Explained variance', fmt: v => v.toFixed(2), domain: [0, 1], ref: () => ({ y: 0.2, label: '0.2' }) },
  { key: 'adv_std', term: 'adv_std', label: 'Advantage std', fmt: v => v.toFixed(3) },
  { key: 'policy_loss', label: 'Policy loss', fmt: v => v.toFixed(3) },
  { key: 'value_loss', label: 'Value loss', fmt: v => v.toFixed(3) },
]

// The defaults described on the methodology page: entropy anneals 0.02 -> 0.005 and the minibatch steps 4 -> 16
// episodes, both over the first 50,000 cumulative games per deck.
const plannedEntropy = g => 0.02 + (0.005 - 0.02) * Math.min(1, g / 50000)
const plannedBatch = g => Math.min(4 * 2 ** Math.floor(Math.min(1, g / 50000) * 6), 16)

const deckSeries = (records, field, bin) => [...groupBy(records, 'deck')].sort((a, b) => a[0].localeCompare(b[0])).map(([deck, rs]) => ({
  key: deck, label: deck, color: deckColor(deck), points: binSeries(rs.map(r => ({ x: r.cumulative_games, y: r[field] })), bin),
}))

function Stability({ ppo, bin }) {
  const decks = [...new Set(ppo.map(r => r.deck))].sort()
  const latest = latestByDeck(ppo)
  const anyLatest = [...latest.values()][0]
  return (
    <>
      <div className="shared-legend">{decks.map(d => <span key={d} className="legend-item"><span className="line-key" style={{ background: deckColor(d) }} />{d}</span>)}</div>
      <div className="chart-grid">
        {PANELS.map(p => {
          const ref = p.ref && anyLatest ? p.ref(anyLatest) : null
          return (
            <LineChartCard key={p.key} title={p.term ? <Term k={p.term}>{p.label}</Term> : p.label} series={deckSeries(ppo, p.key, bin)}
                           legend={false} yFormat={p.fmt} yDomain={p.domain} refLines={ref ? [ref] : []} height={190} />
          )
        })}
      </div>
    </>
  )
}

// Planned (the documented default schedule) vs. actual (the value each PPO update really used, averaged over decks).
function Schedules({ ppo, bin, lr }) {
  const actual = field => binSeries(ppo.map(r => ({ x: r.cumulative_games, y: r[field] })), bin)
  const planned = (pts, f) => pts.map(p => ({ x: p.x, y: f(p.x) }))
  const ent = actual('ent_coef'), batch = actual('batch_size')
  const pair = (pts, f) => [
    { key: 'actual', label: 'actual (used by the update)', color: NEUTRAL, points: pts },
    { key: 'planned', label: 'default schedule', color: MUTED, dashed: true, points: planned(pts, f) },
  ]
  return (
    <>
      <div className="chart-grid">
        <LineChartCard title={<Term k="entropy_coef">Entropy coefficient</Term>} series={pair(ent, plannedEntropy)} yFormat={v => v.toFixed(3)} height={200} />
        <LineChartCard title={<Term k="minibatch">Minibatch size</Term>} subtitle="episodes per minibatch" series={pair(batch, plannedBatch)} yFormat={v => v.toFixed(0)} height={200} />
      </div>
      <p className="hint section-hint">
        Where the two lines differ, the run overrode the default schedule. The learning rate is {lr != null ? <b>{lr}</b> : 'flat'} for the whole run unless training was launched through an
        lr-decay wrapper, which isn't recorded in the metrics (the run's config can't show it either).
      </p>
    </>
  )
}

// PFSP tallies: what each deck trained against.
function Opponents({ opponents, gamesPerSnapshot }) {
  const trainDecks = opponents ? Object.keys(opponents).sort() : []
  const oppDecks = [...new Set(trainDecks.flatMap(t => Object.keys(opponents[t]).map(k => k.split(':')[1])))].sort()
  const [train, setTrain] = useState(null), [vs, setVs] = useState(null)
  if (!opponents) return <p className="hint">No opponent tallies for this league yet (written at each snapshot).</p>
  const t = trainDecks.includes(train) ? train : trainDecks[0], o = oppDecks.includes(vs) ? vs : oppDecks[0]
  const tally = (d, key) => opponents[d][key] || [0, 0]
  const totals = Object.fromEntries(trainDecks.map(d => [d, Object.values(opponents[d]).reduce((a, [, g]) => a + g, 0)]))
  const snaps = Object.entries(opponents[t]).filter(([k]) => k.startsWith(`snapshot:${o}:`)).map(([k, [w, g]]) => ({ id: +k.split(':')[2], w, g })).sort((a, b) => a.id - b.id)
  // A single snapshot has only a few games against it, so its win rate is nearly all noise: pool neighbouring snapshots
  // into ~12 age buckets and show each bucket's pooled rate with its 95% interval.
  const per = Math.max(1, Math.ceil(snaps.length / 12))
  const points = []
  for (let i = 0; i < snaps.length; i += per) {
    const chunk = snaps.slice(i, i + per), w = chunk.reduce((s, c) => s + c.w, 0), g = chunk.reduce((s, c) => s + c.g, 0)
    if (!g) continue
    const [lo, hi] = wilson(w, g)
    points.push({ x: Math.round(chunk.reduce((s, c) => s + (c.id + 1) * gamesPerSnapshot, 0) / chunk.length), y: w / g, band: [lo, hi] })
  }
  return (
    <>
      <div className="card" style={{ padding: '10px 12px' }}>
        <table className="matrix">
          <thead><tr><th>trains ↓ · vs →</th>{oppDecks.map(d => <th key={d}>{d}</th>)}<th>training games</th></tr></thead>
          <tbody>
            {trainDecks.map(d => (
              <tr key={d}>
                <th>{d}</th>
                {oppDecks.map(opp => {
                  const [w, g] = tally(d, `deck:${opp}`)
                  const sn = Object.entries(opponents[d]).filter(([k]) => k.startsWith(`snapshot:${opp}:`)).reduce((a, [, v]) => [a[0] + v[0], a[1] + v[1]], [0, 0])
                  if (!g && !sn[1]) return <td key={opp} className="matrix-empty">·</td>
                  const share = v => fmtPct(v / totals[d], 1)
                  return (
                    <td key={opp} className="matrix-cell pair-cell" style={{ background: g ? divergingColor(w / g) : 'transparent' }}
                        title={`${d} vs ${opp} live: ${w}/${g} (${share(g)} of its games) · vs ${opp} snapshots: ${sn[0]}/${sn[1]} (${share(sn[1])})`}>
                      {g ? fmtPct(w / g) : '—'}<small>{share(g + sn[1])} of games</small>
                    </td>
                  )
                })}
                <td>{totals[d].toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">Row = training deck, column = opponent deck. Colored number: the row deck's win rate against the opponent's <b>live</b> agent. Small text: the share of the row deck's training games played against that deck (live plus its snapshots). Cumulative over the whole run.</p>
      </div>
      <div className="toolbar" style={{ marginTop: 14 }}>
        <select value={t} onChange={e => setTrain(e.target.value)} aria-label="Training deck">{trainDecks.map(d => <option key={d}>{d}</option>)}</select>
        <span className="hint">vs snapshots of</span>
        <select value={o} onChange={e => setVs(e.target.value)} aria-label="Opponent deck">{oppDecks.map(d => <option key={d}>{d}</option>)}</select>
      </div>
      <LineChartCard title={`${t} against older ${o}`} subtitle="Win rate against the opponent's frozen snapshots, pooled into age buckets (shaded = 95% interval). Low stretches are ages this deck loses to, which PFSP samples more."
                     series={[{ key: 'wr', label: 'win rate', color: deckColor(t), points }]} yFormat={v => fmtPct(v)} yDomain={[0, 1]}
                     refLines={[{ y: 0.5, label: '50%' }]} xName="Opponent snapshot (games/deck)" xLabel={x => `snapshots around ${x.toLocaleString()} games/deck`} height={230} />
    </>
  )
}

export default function Training() {
  const { data } = useOutletContext()
  return (
    <LoadGate state={data}>
      {({ metrics, opponents }) => {
        const ppo = metrics.ppo || []
        const maxGames = ppo.length ? Math.max(...ppo.map(r => r.cumulative_games)) : 0
        const bin = Math.max(250, Math.round(maxGames / 110 / 50) * 50) // ~110 points across the run
        const sessions = metrics.session_start || []
        const last = sessions[sessions.length - 1] || {}
        const gamesPerSnapshot = (last.snapshot_every ?? 8) * (last.games_per_iteration ?? 24)
        if (!ppo.length) return <p className="hint">No PPO updates logged yet.</p>
        return (
          <>
            <h2 className="section-h">Is the update stable? <HelpLink to="metrics">What do these mean?</HelpLink></h2>
            <p className="hint section-hint">Every deck overlaid in each panel; each point is the mean of the updates in a {bin.toLocaleString()}-game window. KL should stay near or under its target, explained variance above about 0.2, and entropy should fall gradually, not collapse.</p>
            <Stability ppo={ppo} bin={bin} />

            <h2 className="section-h">Schedules <HelpLink to="ppo" /></h2>
            <Schedules ppo={ppo} bin={bin} lr={last.lr} />

            <h2 className="section-h">What did it train against? <HelpLink to="league">Self-play league</HelpLink></h2>
            <p className="hint section-hint"><Term k="pfsp">PFSP</Term> picks opponents the deck is currently losing to, so these tallies show where its training games actually went.</p>
            <Opponents opponents={opponents} gamesPerSnapshot={gamesPerSnapshot} />

            <h2 className="section-h">Mulligan net <HelpLink to="mulligan" /></h2>
            <LineChartCard title="Mulligan-net training loss" subtitle="REINFORCE loss per update. Includes the entropy bonus, so it can sit below zero."
                           series={deckSeries(metrics.mulligan || [], 'loss', bin)} yFormat={v => v.toFixed(3)} height={220} />
          </>
        )
      }}
    </LoadGate>
  )
}
