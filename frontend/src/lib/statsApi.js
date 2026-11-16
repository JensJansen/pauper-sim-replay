import { useEffect, useState } from 'react'

// Client for /api/stats/*, with a per-page-load cache so tabs and the Compare view never refetch a league.

export async function fetchJson(url) {
  const res = await fetch(url)
  const body = await res.json()
  if (!res.ok) throw new Error(body.error || res.statusText)
  return body
}

const cache = new Map() // key -> Promise
function cached(key, load) {
  if (!cache.has(key)) cache.set(key, load().catch(e => { cache.delete(key); throw e })) // a failure can be retried
  return cache.get(key)
}

const enc = encodeURIComponent
const leaguePath = name => `/api/stats/leagues/${enc(name)}`

// Leagues listed by the API, minus the frozen training-league twins ("<league>-training"): those are benchmark
// opponents, not runs to look at.
export const isTwin = name => name.endsWith('-training')
export const loadLeagues = () => cached('leagues', async () => (await fetchJson('/api/stats/leagues')).filter(l => !isTwin(l.name)))

// Everything a league has: metrics grouped by kind, the check index, the run manifest and PFSP tallies.
export const loadLeague = name => cached(`league:${name}`, async () => {
  const [metrics, checks, manifest, opponents] = await Promise.all([
    fetchJson(`${leaguePath(name)}/metrics`),
    fetchJson(`${leaguePath(name)}/checks`),
    fetchJson(`${leaguePath(name)}/manifest`).catch(() => null),
    fetchJson(`${leaguePath(name)}/opponents`).catch(() => null),
  ])
  return { name, metrics, checks, manifest, opponents }
})

// One check snapshot (checks/<check>_<N>games.json), addressed by the path the checks index lists.
export const loadCheck = (league, path) => cached(`check:${league}:${path}`,
  () => fetchJson(`${leaguePath(league)}/checks/${path.split('/').map(enc).join('/')}`))

// Published head-to-head results between training arms (logs/validation/compare/*.json); [] if none.
export const loadCompare = () => cached('compare', () => fetchJson('/api/stats/compare'))

// Hook shape for every loader: {status: 'loading' | 'ok' | 'error', data, error}.
export function useAsync(load, deps) {
  const [state, setState] = useState({ status: 'loading' })
  useEffect(() => {
    let stale = false
    setState(s => (s.status === 'ok' ? s : { status: 'loading' })) // keep the previous render while refetching
    load().then(data => !stale && setState({ status: 'ok', data }), error => !stale && setState({ status: 'error', error }))
    return () => { stale = true }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}

export const useLeagues = () => useAsync(loadLeagues, [])
export const useLeague = name => useAsync(() => (name ? loadLeague(name) : Promise.resolve(null)), [name])
