import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import Term from '../components/Term'
import CategoryChart from '../components/charts/CategoryChart'
import LineChartCard from '../components/charts/LineChartCard'
import { HelpLink } from '../components/ui'
import { MUTED, NEUTRAL, deckColor } from '../lib/palette'
import { fmtPct } from '../lib/series'
import { loadCheck, useAsync } from '../lib/statsApi'
import { LoadGate } from './parts'

const sortedKeys = obj => Object.keys(obj).sort((a, b) => +a - +b)

// Opening-hand decisions of the mulligan net, by land count, at one round-robin snapshot (optionally against an earlier one).
function Mulligan({ league, checks }) {
  const snaps = checks.filter(c => c.check === 'mulligan_audit' && c.deck === null).sort((a, b) => b.cumulative_games - a.cumulative_games)
  const [deckPick, setDeck] = useState(null), [snapPick, setSnap] = useState(null), [cmpPick, setCmp] = useState(null)
  const snap = snaps.find(s => s.cumulative_games === snapPick) ?? snaps[0]
  const cmp = snaps.find(s => s.cumulative_games === cmpPick)
  const cur = useAsync(() => (snap ? loadCheck(league, snap.path) : Promise.resolve(null)), [league, snap?.path])
  const old = useAsync(() => (cmp ? loadCheck(league, cmp.path) : Promise.resolve(null)), [league, cmp?.path])

  if (!snaps.length) return <p className="hint">No mulligan_audit snapshots yet.</p>
  if (cur.status === 'error') return <p className="hint">Couldn't load the snapshot: {cur.error.message}</p>
  // useAsync keeps the previous result while refetching, so only trust data that belongs to the snapshot now picked
  if (cur.status !== 'ok' || cur.data?.cumulative_games !== snap.cumulative_games) return <p className="hint">loading…</p>

  const decks = Object.keys(cur.data.decks).sort()
  const deck = decks.includes(deckPick) ? deckPick : decks[0]
  const d = cur.data.decks[deck]
  const before = cmp && old.status === 'ok' && old.data?.cumulative_games === cmp.cumulative_games ? old.data.decks[deck] ?? null : null
  const color = deckColor(deck)
  const lands = sortedKeys(d.by_land_count)
  const rows = lands.map(lc => {
    const b = d.by_land_count[lc]
    return {
      label: lc, keep: b.keep_rate, win: b.win_rate_after_keep, entropy: b.avg_entropy_bits,
      before: before?.by_land_count[lc]?.keep_rate,
      note: `${b.kept} kept, ${b.mulliganed} mulliganed (${b.wins}-${b.losses} after keep)`,
    }
  })
  const probes = sortedKeys(d.probe_hands).map(lc => {
    const p = d.probe_hands[lc]
    return { label: lc, p: p.p_mulligan_mean, spread: p.p_mulligan_spread, note: `${p.n} probe hands · spread ±${fmtPct(p.p_mulligan_spread, 1)} · entropy ${p.entropy_bits_mean.toFixed(2)} bits` }
  })
  return (
    <>
      <div className="toolbar">
        {decks.map(x => (
          <button key={x} className={`chip${x === deck ? ' active' : ''}`} onClick={() => setDeck(x)}>
            <span className="swatch" style={{ background: deckColor(x), marginRight: 6 }} />{x}
          </button>
        ))}
        <span className="hint" style={{ marginLeft: 'auto' }}>Snapshot</span>
        <select value={snap.cumulative_games} onChange={e => setSnap(Number(e.target.value))} aria-label="Snapshot">
          {snaps.map(s => <option key={s.cumulative_games} value={s.cumulative_games}>{s.cumulative_games.toLocaleString()} games/deck</option>)}
        </select>
        <span className="hint">compare keep rate with</span>
        <select value={cmp?.cumulative_games ?? ''} onChange={e => setCmp(e.target.value ? Number(e.target.value) : null)} aria-label="Compare snapshot">
          <option value="">none</option>
          {snaps.filter(s => s.cumulative_games !== snap.cumulative_games).map(s => <option key={s.cumulative_games} value={s.cumulative_games}>{s.cumulative_games.toLocaleString()} games/deck</option>)}
        </select>
      </div>
      <div className="chart-grid">
        <CategoryChart title={<><Term k="keep_rate">Keep rate</Term> and <Term k="win_after_keep">win rate after keep</Term></>} subtitle="by number of lands in the opening hand, from the round robins' own games"
                       data={rows} yFormat={v => fmtPct(v)} yDomain={[0, 1]} xPrefix="Opening hand: " xName="Lands in hand"
                       series={[
                         { key: 'keep', label: 'keep rate', color, kind: 'bar' },
                         { key: 'win', label: 'win rate after keep', color: NEUTRAL, kind: 'line' },
                         ...(before ? [{ key: 'before', label: `keep rate at ${cmp.cumulative_games.toLocaleString()}`, color: MUTED, kind: 'line', dashed: true }] : []),
                       ]} />
        <CategoryChart title={<Term k="decision_entropy">Decision entropy</Term>} subtitle="bits; 1 = a coin flip between keep and mulligan"
                       data={rows} yFormat={v => v.toFixed(2)} yDomain={[0, 1]} xPrefix="Opening hand: " xName="Lands in hand" alignLegend
                       series={[{ key: 'entropy', label: 'decision entropy (bits)', color, kind: 'bar' }]} />
        <CategoryChart title={<><Term k="probe_hands">Probe hands</Term>: P(mulligan)</>} subtitle="seeded synthetic hands; whiskers = spread"
                       help="probe-hands" data={probes.map(r => ({ ...r, err: r.spread }))} yFormat={v => fmtPct(v)} yDomain={[0, 1]} xPrefix="Probe hand with " xName="Lands" alignLegend
                       series={[{ key: 'p', label: 'P(mulligan)', color, kind: 'bar', errorKey: 'err' }]} />
      </div>
    </>
  )
}

// Mana burnt per game by each primary deck, at every round-robin-vs-training tick (only that check records it).
function ManaBurn({ league, checks }) {
  const snaps = checks.filter(c => c.check === 'primary_vs_training_round_robin' && c.deck === null).sort((a, b) => a.cumulative_games - b.cumulative_games)
  const state = useAsync(() => Promise.all(snaps.map(s => loadCheck(league, s.path))), [league, snaps.length])
  if (!snaps.length) return <p className="hint">Mana burn is only recorded by primary_vs_training_round_robin checks, and there are none yet.</p>
  if (state.status === 'error') return <p className="hint">Couldn't load the snapshots: {state.error.message}</p>
  if (state.status !== 'ok') return <p className="hint">loading…</p>
  const byDeck = new Map()
  state.data.forEach((detail, i) => {
    for (const [label, m] of Object.entries(detail.mana_burnt_by_deck || {})) {
      if (!label.startsWith('primary/')) continue // training/<deck> is the benchmark pool, not a league deck
      const deck = label.slice('primary/'.length)
      if (!byDeck.has(deck)) byDeck.set(deck, [])
      byDeck.get(deck).push({ x: snaps[i].cumulative_games, total: m.mana_burnt_total_per_game, single: m.mana_burnt_total_single_pip_per_game })
    }
  })
  const series = field => [...byDeck].sort((a, b) => a[0].localeCompare(b[0])).map(([deck, pts]) => ({
    key: deck, label: deck, color: deckColor(deck), points: pts.map(p => ({ x: p.x, y: p[field] })),
  }))
  return (
    <div className="chart-grid">
      <LineChartCard title={<><Term k="mana_burn">Mana burnt</Term> per game</>} subtitle="all wasted mana, every source" series={series('total')} yFormat={v => v.toFixed(2)} yDomain={[0, 'auto']} height={230} />
      <LineChartCard title={<><Term k="single_pip">Single-pip burn</Term> per game</>} subtitle="the part the reward charges (winning seat only)" series={series('single')} yFormat={v => v.toFixed(2)} yDomain={[0, 'auto']} height={230} />
    </div>
  )
}

export default function Behavior() {
  const { data } = useOutletContext()
  return (
    <LoadGate state={data}>
      {({ name, checks }) => (
        <>
          <h2 className="section-h" style={{ marginTop: 0 }}>Mulligan decisions <HelpLink to="mulligan" /></h2>
          <p className="hint section-hint">What the mulligan net does with each opening hand: how often it keeps by land count, how those keeps turn out, and how decisively. Probe hands fill in land counts self-play rarely produces.</p>
          <Mulligan key={name} league={name} checks={checks} />
          <h2 className="section-h">Mana burn <HelpLink to="reward" /></h2>
          <ManaBurn key={`${name}-burn`} league={name} checks={checks} />
        </>
      )}
    </LoadGate>
  )
}
