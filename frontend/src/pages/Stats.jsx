import { NavLink, Navigate, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import Header from '../Header'
import { useLeague, useLeagues } from '../lib/statsApi'
import '../components/ui.css'
import '../stats/stats.css'

// Tabs are grouped by the question they answer, not by where the data comes from.
export const TABS = [
  ['summary', 'Summary'],
  ['progress', 'Progress'],
  ['strength', 'Strength'],
  ['training', 'Training'],
  ['behavior', 'Behavior'],
  ['compare', 'Compare'],
]

// The /stats shell: league picker + tab links (every tab is a route), and the chosen league's data handed to the
// tab through the outlet context. Compare picks its own leagues, so the single-league picker is hidden there.
export default function Stats() {
  const [params, setParams] = useSearchParams()
  const { pathname } = useLocation()
  const onCompare = pathname.endsWith('/compare')
  const leagues = useLeagues()

  const names = leagues.data?.map(l => l.name) ?? []
  const requested = params.get('league')
  // Opens on the first league listed (most recently written), unless ?league= names another that exists.
  const league = names.includes(requested) ? requested : names[0]
  const data = useLeague(onCompare ? null : league)

  const picker = leagues.status === 'ok' && !onCompare && (
    <select className="league-select" value={league ?? ''} aria-label="League"
            onChange={e => setParams({ league: e.target.value }, { replace: true })}>
      {leagues.data.map(l => (
        <option key={l.name} value={l.name}>
          {l.name}{l.cumulative_games_per_deck != null ? ` — ${l.cumulative_games_per_deck.toLocaleString()} games/deck` : ''}
        </option>
      ))}
    </select>
  )
  // Keep the chosen league as you move between tabs (Compare has its own selection).
  const search = tab => (tab !== 'compare' && league ? `?league=${encodeURIComponent(league)}` : '')

  if (pathname.replace(/\/+$/, '').endsWith('/stats')) return <Navigate to={{ pathname: '/stats/summary', search: params.toString() }} replace />
  return (
    <div className="stats-page">
      <Header title="Validation Stats" subtitle="Metrics exported during training runs, by league." current="/stats">{picker}</Header>
      <nav className="stats-tabs" aria-label="Stats sections">
        {TABS.map(([id, label]) => (
          <NavLink key={id} to={{ pathname: `/stats/${id}`, search: search(id) }} className={({ isActive }) => `stats-tab${isActive ? ' active' : ''}`}>{label}</NavLink>
        ))}
      </nav>
      <main className="stats-main">
        {leagues.status === 'error' && <p className="hint">Couldn't list leagues: {leagues.error.message}</p>}
        {leagues.status === 'ok' && names.length === 0 && <p className="hint">No leagues with data yet — run training first.</p>}
        {leagues.status === 'loading' && <p className="hint">loading…</p>}
        {leagues.status === 'ok' && names.length > 0 && <Outlet context={{ league, leagues: leagues.data, data }} />}
      </main>
    </div>
  )
}
