import { useOutletContext } from 'react-router-dom'
import Term from '../components/Term'
import Sparkline from '../components/charts/Sparkline'
import { Drill, HelpLink } from '../components/ui'
import { NEUTRAL, STATUS, deckColor } from '../lib/palette'
import { fmtGames, fmtPct, groupBy, latestByDeck, referenceAnchor } from '../lib/series'
import { LoadGate, StatTile, StatusMark } from './parts'

// What the progress indicator's label means, in a sentence (the same wording as the methodology page).
const LABELS = {
  IMPROVING: { status: 'good', text: 'The current agents clearly beat their own older selves (interval above 50%).' },
  CHURNING: { status: 'warning', text: 'No clear strength gain, but the policy is still moving: changing without getting better.' },
  STUCK: { status: 'serious', text: 'No clear strength gain and the policy has stopped moving.' },
  FLAT: { status: 'neutral', text: 'No clear strength gain (the policy probe was not available).' },
  WARMUP: { status: 'neutral', text: 'Too early: no snapshot is old enough to compare against yet.' },
}

function Verdict({ metrics }) {
  const records = (metrics.progress_indicator || []).filter(r => r.deck === 'ALL')
  if (!records.length) {
    return (
      <section className="verdict">
        <div className="verdict-head"><span className="verdict-q">Is it still learning?</span><span className="hint">No progress indicator yet. It is written at each validation tick once a snapshot is old enough to compare against.</span></div>
        <HelpLink to="indicator" />
      </section>
    )
  }
  const last = records[records.length - 1]
  const info = LABELS[last.label] ?? LABELS.FLAT
  const points = records.filter(r => r.score != null).map(r => ({ x: r.cumulative_games, y: r.score }))
  return (
    <section className={`verdict status-${info.status}`}>
      <div className="verdict-head">
        <span className="verdict-q">Is it still learning?</span>
        <StatusMark status={info.status}><Term k={last.label.toLowerCase()}>{last.label}</Term></StatusMark>
        <span className="hint">at {last.cumulative_games.toLocaleString()} games/deck</span>
        <span className="verdict-help"><HelpLink to="indicator" /></span>
      </div>
      <p className="verdict-text">{info.text}</p>
      {last.label !== 'WARMUP' && (
        <p className="hint">
          <Term k="pooled">Pooled score</Term> against the reference self: <b>{fmtPct(last.score, 1)}</b> [{fmtPct(last.lo, 1)}, {fmtPct(last.hi, 1)}] over {last.games.toLocaleString()} games (50% = no progress)
          {last.policy_ratio != null && <> · policy moved {fmtPct(last.policy_ratio)} of the way to an unrelated policy</>}
        </p>
      )}
      {points.length > 1 && (
        <div className="verdict-spark">
          <Sparkline points={points} color={NEUTRAL} baseline={0.5} baselineLabel="no progress" labelPosition="insideTopRight" fmt={v => fmtPct(v)} height={84} />
          <span className="hint">pooled score by validation tick, against the 50% line</span>
        </div>
      )}
    </section>
  )
}

// One headline card per deck: strength vs the frozen twin (the fixed yardstick), with its trend, plus two reference reads.
function DeckCards({ metrics }) {
  const twin = groupBy(metrics.primary_vs_training_round_robin || [], 'deck')
  const field = latestByDeck(metrics.primary_vs_primary_round_robin || [])
  const own = metrics.strength_history || []
  const newest = own.length ? Math.max(...own.map(r => r.cumulative_games)) : null
  const ownNow = own.filter(r => r.cumulative_games === newest)
  const anchor = newest == null ? null : referenceAnchor([...new Set(ownNow.map(r => r.anchor_games))], newest)
  const decks = [...new Set([...twin.keys(), ...field.keys()])].sort()
  if (!decks.length) return <p className="hint">No round-robin results yet.</p>
  return (
    <div className="deck-cards">
      {decks.map(deck => {
        const rs = twin.get(deck) || []
        // Trend vs a tick about 10% of the run earlier: the newest ticks can be only a few games apart (a run that stopped
        // and resumed), and a delta across those is just noise.
        const last = rs[rs.length - 1]
        const prev = last && [...rs].reverse().find(r => r.cumulative_games <= last.cumulative_games - Math.max(1000, last.cumulative_games * 0.1))
        const delta = last && prev ? (last.win_rate - prev.win_rate) * 100 : null
        const first = rs[0]
        const growth = last && first && first !== last ? (last.win_rate - first.win_rate) * 100 : null
        const self = anchor && ownNow.find(r => r.deck === deck && r.anchor_games === anchor)
        return (
          <div key={deck} className="card deck-card">
            <div className="deck-name"><span className="swatch" style={{ background: deckColor(deck) }} />{deck}</div>
            <div className="deck-big">{last ? fmtPct(last.win_rate) : '—'}</div>
            <div className="hint"><Term k="win_rate">win rate</Term> vs the <Term k="twin">frozen twin</Term></div>
            {growth != null && (
              <div className="deck-change" style={{ color: STATUS[growth >= 0 ? 'good' : 'serious'].color }} title={`from ${fmtPct(first.win_rate)} at ${first.cumulative_games.toLocaleString()} games/deck`}>
                {Math.abs(growth) < 0.05 ? '●' : growth > 0 ? '▲' : '▼'} {Math.abs(growth).toFixed(1)} pts <span className="hint">since {fmtGames(first.cumulative_games)}</span>
                {delta != null && <span className="hint"> · {Math.abs(delta) < 0.05 ? '● flat' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}`} since {fmtGames(prev.cumulative_games)}</span>}
              </div>
            )}
            <Sparkline points={rs.map(r => ({ x: r.cumulative_games, y: r.win_rate }))} color={deckColor(deck)}
                       baseline={first?.win_rate} baselineLabel={first ? `start ${fmtPct(first.win_rate)}` : undefined} fmt={v => fmtPct(v)} />
            <dl className="mini-kv">
              <dt><Term k="primary_vs_primary">vs the field</Term></dt><dd>{field.get(deck) ? fmtPct(field.get(deck).win_rate) : '—'}</dd>
              <dt><Term k="past_selves">vs own self</Term>{anchor ? ` at ${anchor.toLocaleString()}` : ''}</dt><dd>{self ? fmtPct(self.score) : '—'}</dd>
            </dl>
          </div>
        )
      })}
    </div>
  )
}

// Latest PPO update per deck, flagged where the diagnostics leave their normal range.
function Health({ metrics }) {
  const latest = latestByDeck(metrics.ppo || [])
  if (!latest.size) return <p className="hint">No PPO updates logged yet.</p>
  const rows = [...latest.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  return (
    <>
      <div className="card health-card">
        <table className="data-table">
          <thead><tr>
            <th>Deck</th><th><Term k="entropy">Entropy</Term></th><th><Term k="approx_kl">Approx KL</Term></th>
            <th><Term k="clip_fraction">Clip fraction</Term></th><th><Term k="explained_variance">Explained variance</Term></th><th><Term k="adv_std">Adv std</Term></th>
          </tr></thead>
          <tbody>
            {rows.map(([deck, r]) => {
              const klBad = r.approx_kl > r.target_kl, evBad = r.explained_variance < 0.2
              return (
                <tr key={deck}>
                  <td><span className="swatch" style={{ background: deckColor(deck) }} />{deck}</td>
                  <td>{r.entropy.toFixed(3)}</td>
                  <td>{r.approx_kl.toFixed(4)} <StatusMark status={klBad ? 'warning' : 'good'} compact>{klBad ? `over target ${r.target_kl}` : 'ok'}</StatusMark></td>
                  <td>{fmtPct(r.clip_fraction, 1)}</td>
                  <td>{r.explained_variance.toFixed(2)} <StatusMark status={evBad ? 'warning' : 'good'} compact>{evBad ? 'low' : 'ok'}</StatusMark></td>
                  <td>{r.adv_std.toFixed(3)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">
        What's normal: approx KL stays under its target (PPO stops an epoch early when it doesn't); explained variance above about 0.2 means the value head is
        pulling its weight; entropy should fall gradually as the schedule anneals, not collapse early. These are the latest update only; the Training tab has the trends.
      </p>
    </>
  )
}

function RunDetails({ manifest }) {
  if (!manifest) return <p className="hint">No run manifest for this league (it predates manifests).</p>
  const sessions = manifest.sessions || [], last = sessions[sessions.length - 1] || {}
  const model = manifest.model || {}, cfg = manifest.config || {}, env = manifest.environment || {}, code = last.code || {}
  const cfgKeys = ['league_name', 'total_games', 'roster', 'games_per_iteration', 'n_workers', 'overlap_collect', 'pfsp', 'pfsp_power', 'device', 'seed', 'checks_cadence_pct']
  const cfgText = cfgKeys.filter(k => cfg[k] != null).map(k => `${k}=${Array.isArray(cfg[k]) ? cfg[k].join(',') : cfg[k]}`).join(' · ')
  const changed = (manifest.model_history || []).length
  return (
    <dl className="kv">
      <dt>started</dt><dd>{manifest.created_at || '?'}</dd>
      <dt>sessions</dt><dd>{sessions.length} · latest {last.games_start != null ? `${last.games_start.toLocaleString()} → ${last.games_end != null ? last.games_end.toLocaleString() : 'running'} games/deck` : '?'}</dd>
      <dt>model</dt><dd>trunk {(model.trunk_hidden || []).join('×')} · encoder d={model.encoder_d_model ?? '?'} · {(model.n_params_example_deck || 0).toLocaleString()} params/deck · vocab {model.vocab_size ?? '?'}{changed > 0 && <span className="status-warn"> · model changed {changed}× during this run</span>}</dd>
      <dt>config</dt><dd>{cfgText || '—'}</dd>
      <dt>code</dt><dd>{(code.commit || '?').slice(0, 8)} on {code.branch || '?'}{code.dirty ? ' (uncommitted changes)' : ''}</dd>
      <dt>environment</dt><dd>python {env.python || '?'} · torch {env.torch || '?'} · {env.cuda_device || 'cpu'}</dd>
    </dl>
  )
}

export default function Summary() {
  const { league, leagues, data } = useOutletContext()
  return (
    <LoadGate state={data}>
      {({ metrics, manifest }) => {
        const meta = leagues.find(l => l.name === league)
        const ppo = metrics.ppo || []
        return (
          <>
            <Verdict metrics={metrics} />
            <div className="tiles">
              <StatTile label="Games per deck" value={(meta?.cumulative_games_per_deck ?? 0).toLocaleString()} />
              <StatTile label="Training sessions" value={(metrics.session_start || []).length} />
              <StatTile label="PPO updates logged" value={ppo.length.toLocaleString()} />
              <StatTile label="Last validation" value={(metrics.progress_indicator?.at(-1)?.cumulative_games ?? metrics.primary_vs_training_round_robin?.at(-1)?.cumulative_games ?? 0).toLocaleString()} sub="games/deck" />
            </div>
            <h2 className="section-h">Decks <HelpLink to="validation" /></h2>
            <DeckCards metrics={metrics} />
            <h2 className="section-h">Training health <HelpLink to="metrics">What do these mean?</HelpLink></h2>
            <Health metrics={metrics} />
            <Drill summary="Run details">
              <RunDetails manifest={manifest} />
            </Drill>
          </>
        )
      }}
    </LoadGate>
  )
}
