import { useOutletContext, useSearchParams } from 'react-router-dom'
import Term from '../components/Term'
import LineChartCard from '../components/charts/LineChartCard'
import { HelpLink } from '../components/ui'
import { NEUTRAL, armColor } from '../lib/palette'
import { PCT_DOMAIN, binSeries, fmtGames, fmtPct, mean, pooledByTick, wilson } from '../lib/series'
import { loadCompare, loadLeague, useAsync } from '../lib/statsApi'
import { StatusMark } from './parts'

// Compare training runs ("arms") at matched ages: curves, a table at one age, published head-to-head matches, and what
// differs in their configs. Which arms are shown lives in the URL (?leagues=a,b,c).

const nearest = (ticks, target) => (ticks.length ? ticks.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a)) : null)
const pts = n => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(1)} pts`

// A comparison's one-line series per arm: {key, label, color, points}.
const armSeries = (arms, points) => arms.map(a => ({ key: a.name, label: a.name, color: armColor(a.name), points: points(a) }))

function Curves({ arms }) {
  const ppoPoints = field => a => binSeries((a.metrics.ppo || []).map(r => ({ x: r.cumulative_games, y: r[field] })), 500)
  return (
    <>
      <div className="shared-legend">{arms.map(a => <span key={a.name} className="legend-item"><span className="line-key" style={{ background: armColor(a.name) }} />{a.name}</span>)}</div>
      <div className="chart-grid">
        <LineChartCard title={<>Win rate vs the <Term k="twin">frozen twin</Term></>} subtitle="all decks pooled, by validation tick" legend={false}
                       series={armSeries(arms, a => pooledByTick(a.metrics.primary_vs_training_round_robin || []))}
                       yFormat={v => fmtPct(v)} yDomain={PCT_DOMAIN} refLines={[{ y: 0.5, label: '50%' }]} height={230} />
        <LineChartCard title={<><Term k="pooled">Pooled strength</Term> vs own past selves</>} subtitle="the progress indicator's score; above 50% = beating older selves" legend={false}
                       series={armSeries(arms, a => (a.metrics.progress_indicator || []).filter(r => r.deck === 'ALL' && r.score != null).map(r => ({ x: r.cumulative_games, y: r.score })))}
                       yFormat={v => fmtPct(v)} yDomain={PCT_DOMAIN} refLines={[{ y: 0.5, label: 'no progress' }]} height={230} />
        <LineChartCard title={<Term k="entropy">Entropy</Term>} subtitle="mean over decks and updates in each 500-game window" legend={false}
                       series={armSeries(arms, ppoPoints('entropy'))} yFormat={v => v.toFixed(3)} height={210} />
        <LineChartCard title={<Term k="explained_variance">Explained variance</Term>} legend={false}
                       series={armSeries(arms, ppoPoints('explained_variance'))} yFormat={v => v.toFixed(2)} refLines={[{ y: 0.2, label: '0.2' }]} height={210} />
        <LineChartCard title={<Term k="approx_kl">Approx KL</Term>} legend={false}
                       series={armSeries(arms, ppoPoints('approx_kl'))} yFormat={v => v.toFixed(4)} height={210} />
      </div>
    </>
  )
}

// Every arm's numbers at (about) one age, with the difference from a reference arm.
function MatchedAge({ arms, refName, age, onAge }) {
  const ref = arms.find(a => a.name === refName) ?? arms[0]
  const twin = a => a.metrics.primary_vs_training_round_robin || []
  const refTicks = [...new Set(twin(ref).map(r => r.cumulative_games))].sort((x, y) => x - y)
  const target = refTicks.includes(age) ? age : refTicks[refTicks.length - 1]
  const row = a => {
    const ticks = [...new Set(twin(a).map(r => r.cumulative_games))]
    const tick = nearest(ticks, target)
    const rs = twin(a).filter(r => r.cumulative_games === tick)
    const win = rs.reduce((s, r) => s + r.wins, 0) / rs.reduce((s, r) => s + r.games, 0)
    const ind = (a.metrics.progress_indicator || []).filter(r => r.deck === 'ALL' && r.score != null)
    const indTick = nearest(ind.map(r => r.cumulative_games), tick)
    const self = indTick != null && Math.abs(indTick - tick) <= 0.05 * tick ? ind.find(r => r.cumulative_games === indTick).score : null
    const near = (a.metrics.ppo || []).filter(r => Math.abs(r.cumulative_games - tick) <= 0.03 * tick)
    return { a, tick, win, self, entropy: mean(near.map(r => r.entropy)), ev: mean(near.map(r => r.explained_variance)) }
  }
  const rows = arms.map(row), base = rows.find(r => r.a === ref)
  const delta = (v, b) => (v == null || b == null ? '—' : <span title="difference from the reference arm">{v >= b ? '▲' : '▼'} {pts(v - b)}</span>)
  return (
    <>
      <div className="toolbar">
        <span className="hint">At</span>
        <select value={target} onChange={e => onAge(Number(e.target.value), refName)} aria-label="Age">
          {refTicks.map(t => <option key={t} value={t}>{t.toLocaleString()} games/deck</option>)}
        </select>
        <span className="hint">reference arm</span>
        <select value={ref.name} onChange={e => onAge(target, e.target.value)} aria-label="Reference arm">
          {arms.map(a => <option key={a.name}>{a.name}</option>)}
        </select>
      </div>
      <div className="card" style={{ padding: '6px 10px', overflowX: 'auto' }}>
        <table className="data-table">
          <thead><tr><th>Arm</th><th>Tick (games/deck)</th><th>Win rate vs twin</th><th>Δ vs ref</th><th>Strength vs past selves</th><th>Δ vs ref</th><th>Entropy</th><th>Explained variance</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.a.name}>
                <td><span className="swatch" style={{ background: armColor(r.a.name) }} />{r.a.name}{r.a === ref && <span className="hint"> · reference</span>}</td>
                <td>{r.tick.toLocaleString()}</td>
                <td>{fmtPct(r.win, 1)}</td><td>{r.a === ref ? '—' : delta(r.win, base.win)}</td>
                <td>{r.self == null ? '—' : fmtPct(r.self, 1)}</td><td>{r.a === ref ? '—' : delta(r.self, base.self)}</td>
                <td>{r.entropy == null ? '—' : r.entropy.toFixed(3)}</td><td>{r.ev == null ? '—' : r.ev.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ---- head-to-head matches (analysis/eval/compare_arms.py) ----
// Naming convention of the experiment plan: "<x>control<...>" is an identical replicate of the baseline, so its
// head-to-head with the baseline measures how far two runs with the same settings differ by chance (the noise floor).
// A config can't say this: some arms differ in ways the manifest doesn't record (e.g. an lr-decay wrapper).
const isNoiseFloor = r => (/control/.test(r.a) && /baseline/.test(r.b)) || (/control/.test(r.b) && /baseline/.test(r.a))

function summarize(res, gamesPerSnapshot) {
  const wins = r => r.a_wins + 0.5 * (r.games - r.a_wins - r.b_wins) // a tie / no-winner counts as half
  const n = res.rows.reduce((s, r) => s + r.games, 0), w = res.rows.reduce((s, r) => s + wins(r), 0)
  const perDeck = new Map()
  for (const r of res.rows) {
    const d = perDeck.get(r.deck) ?? [0, 0]
    perDeck.set(r.deck, [d[0] + wins(r), d[1] + r.games])
  }
  const [lo, hi] = wilson(w, n)
  const ages = res.ids.map(i => (i + 1) * gamesPerSnapshot)
  return { score: n ? w / n : 0.5, lo, hi, n, decks: [...perDeck].map(([deck, [dw, dn]]) => ({ deck, score: dw / dn })), age: [Math.min(...ages), Math.max(...ages)] }
}

// Dot-and-whisker for one result: the score and its 95% interval on a 35-65% axis, with the 50% line. It sits in the
// table row, so each interval lines up with its own result.
function ForestCell({ s }) {
  const W = 160, lo = 0.35, hi = 0.65, x = v => ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (W - 12) + 6
  return (
    <svg className="forest" viewBox={`0 0 ${W} 20`} role="img" aria-label={`${fmtPct(s.score, 1)}, 95% interval ${fmtPct(s.lo, 1)} to ${fmtPct(s.hi, 1)}`}>
      <title>{`${fmtPct(s.score, 1)} [${fmtPct(s.lo, 1)}, ${fmtPct(s.hi, 1)}] on a 35-65% axis`}</title>
      <line x1={x(0.5)} x2={x(0.5)} y1={1} y2={19} stroke="#6b717c" strokeDasharray="3 3" />
      <line x1={x(s.lo)} x2={x(s.hi)} y1={10} y2={10} stroke="#8a909b" strokeWidth={2} />
      <circle cx={x(s.score)} cy={10} r={4.5} fill={NEUTRAL} stroke="#1b1e24" strokeWidth={2} />
    </svg>
  )
}

function HeadToHead({ arms }) {
  const state = useAsync(loadCompare, [])
  if (state.status === 'error') return <p className="hint">Couldn't load the head-to-head results: {state.error.message}</p>
  if (state.status !== 'ok') return <p className="hint">loading…</p>
  const names = new Set(arms.map(a => a.name))
  const results = state.data.filter(r => names.has(r.a) && names.has(r.b))
  if (!results.length) return <p className="hint">No published head-to-head results between the selected arms. Publish one with <code>compare_arms.py --out logs/validation/compare/&lt;a&gt;_vs_&lt;b&gt;.json</code>.</p>
  const gps = name => {
    const last = (arms.find(a => a.name === name)?.metrics.session_start || []).at(-1) || {}
    return (last.snapshot_every ?? 8) * (last.games_per_iteration ?? 24)
  }
  const rows = results.map(r => ({ ...r, s: summarize(r, gps(r.a)), floor: isNoiseFloor(r) }))
  const floor = rows.find(r => r.floor)
  const floorSize = floor ? Math.abs(floor.s.score - 0.5) : null
  const verdict = r => {
    const clear = r.s.lo > 0.5 || r.s.hi < 0.5
    if (r.floor) return <StatusMark status="neutral" compact>noise floor</StatusMark>
    if (!clear) return <StatusMark status="neutral" compact>no clear difference</StatusMark>
    if (floorSize != null && Math.abs(r.s.score - 0.5) <= floorSize) return <StatusMark status="warning" compact>within the noise floor</StatusMark>
    return <StatusMark status="good" compact>{r.s.score > 0.5 ? `${r.a} ahead` : `${r.b} ahead`}</StatusMark>
  }
  return (
    <>
      <div className="card" style={{ padding: '6px 10px', overflowX: 'auto' }}>
        <table className="data-table">
          <thead><tr><th>Match-up (A vs B)</th><th>Ages (games/deck)</th><th>A's score [95%]</th><th>vs 50% <span className="hint">(35–65%)</span></th><th>Decks where A leads</th><th>Games</th><th>Read as</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.name}>
                <td><span className="swatch" style={{ background: armColor(r.a) }} />{r.a} <span className="hint">vs</span> <span className="swatch" style={{ background: armColor(r.b), marginLeft: 6 }} />{r.b}</td>
                <td>{r.s.age[0] === r.s.age[1] ? r.s.age[0].toLocaleString() : `${fmtGames(r.s.age[0])}–${fmtGames(r.s.age[1])}`}</td>
                <td><b>{fmtPct(r.s.score, 1)}</b> <span className="hint">[{fmtPct(r.s.lo, 1)}, {fmtPct(r.s.hi, 1)}]</span></td>
                <td><ForestCell s={r.s} /></td>
                <td>{r.s.decks.filter(d => d.score > 0.5).length} of {r.s.decks.length}</td>
                <td>{r.s.n.toLocaleString()}</td>
                <td>{verdict(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint section-hint">
        Each result is arm A's snapshot against arm B's snapshot of the same age, greedy play, pooled over the decks and the listed ages. The intervals treat games as independent, so they understate the
        run-to-run uncertainty. That is what the <Term k="noise_floor">noise floor</Term> row is for: {floor
          ? <>two runs with the same settings differ by <b>{pts(floorSize)}</b> from 50% here, so a result only means something if it is clearly larger and its interval excludes 50%.</>
          : 'no replicate result is published among these arms, so there is no noise floor to read the others against.'}
      </p>
    </>
  )
}

// ---- config diff ----
const flatten = (o, prefix = '') => Object.entries(o || {}).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]))
const show = v => (v == null ? '—' : Array.isArray(v) ? v.join(', ') : String(v))
const NAMES_ONLY = new Set(['league_name', 'training_league_name'])

function ConfigDiff({ arms, refName }) {
  const ref = arms.find(a => a.name === refName) ?? arms[0]
  const cfg = a => new Map([...flatten(a.manifest?.config), ['code.commit', ((a.manifest?.sessions || []).at(-1)?.code?.commit || '').slice(0, 8) || null]])
  const maps = new Map(arms.map(a => [a.name, cfg(a)]))
  const keys = [...new Set(arms.flatMap(a => [...maps.get(a.name).keys()]))].filter(k => !NAMES_ONLY.has(k)).sort()
  const differing = keys.filter(k => new Set(arms.map(a => show(maps.get(a.name).get(k)))).size > 1)
  if (arms.some(a => !a.manifest)) return <p className="hint">Some of these runs have no manifest (they predate manifests), so their configs can't be compared.</p>
  return (
    <>
      <div className="card" style={{ padding: '6px 10px', overflowX: 'auto' }}>
        {differing.length === 0
          ? <p className="hint" style={{ margin: 8 }}>The recorded configs are identical (apart from run names).</p>
          : (
            <table className="data-table">
              <thead><tr><th>Setting</th>{arms.map(a => <th key={a.name}><span className="swatch" style={{ background: armColor(a.name) }} />{a.name}</th>)}</tr></thead>
              <tbody>
                {differing.map(k => (
                  <tr key={k}>
                    <td><code>{k}</code></td>
                    {arms.map(a => {
                      const v = show(maps.get(a.name).get(k)), changed = a !== ref && v !== show(maps.get(ref.name).get(k))
                      return <td key={a.name} style={changed ? { color: '#fff', fontWeight: 600 } : undefined}>{v}{changed && <span className="hint" title={`differs from ${ref.name}`}> ◆</span>}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
      <p className="hint section-hint">◆ differs from the reference arm. Only recorded settings appear here: an arm can also differ in ways the manifest doesn't capture (for example, a learning-rate decay applied by a launch wrapper), so read this next to the plan for each run.</p>
    </>
  )
}

export default function Compare() {
  const { leagues } = useOutletContext()
  const [params, setParams] = useSearchParams()
  const all = leagues.map(l => l.name)
  const wanted = (params.get('leagues') || '').split(',').filter(n => all.includes(n))
  const chosen = wanted.length ? all.filter(n => wanted.includes(n)) : all
  const refName = chosen.includes(params.get('ref')) ? params.get('ref') : (chosen.includes('small_baseline') ? 'small_baseline' : chosen[0])
  const age = Number(params.get('age')) || null
  const setP = patch => setParams(Object.fromEntries(Object.entries({ leagues: chosen.join(','), ref: refName, age, ...patch }).filter(([, v]) => v)), { replace: true })
  const toggle = n => {
    const next = chosen.includes(n) ? chosen.filter(x => x !== n) : all.filter(x => chosen.includes(x) || x === n)
    if (next.length) setP({ leagues: next.join(',') })
  }
  const state = useAsync(() => Promise.all(chosen.map(loadLeague)), [chosen.join(',')])
  const arms = state.status === 'ok' ? state.data : null
  return (
    <>
      <div className="toolbar">
        <span className="hint">Runs</span>
        {all.map(n => (
          <button key={n} className={`chip${chosen.includes(n) ? ' active' : ''}`} aria-pressed={chosen.includes(n)} onClick={() => toggle(n)}>
            <span className="swatch" style={{ background: armColor(n), marginRight: 6 }} />{n}
          </button>
        ))}
      </div>
      {state.status === 'error' && <p className="hint">Couldn't load these leagues: {state.error.message}</p>}
      {!arms && state.status === 'loading' && <p className="hint">loading…</p>}
      {arms && (
        <>
          <h2 className="section-h">Learning curves, aligned by games per deck <HelpLink to="validation" /></h2>
          <Curves arms={arms} />
          <h2 className="section-h">At one age</h2>
          <MatchedAge arms={arms} refName={refName} age={age} onAge={(a, r) => setP({ age: a, ref: r })} />
          <h2 className="section-h">Head-to-head <HelpLink to="validation" /></h2>
          <HeadToHead arms={arms} />
          <h2 className="section-h">What differs between these runs</h2>
          <ConfigDiff arms={arms} refName={refName} />
        </>
      )}
    </>
  )
}
