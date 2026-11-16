import { useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtGames, pivot } from '../../lib/series'
import { SURFACE } from '../../lib/palette'
import { HelpLink } from '../ui'
import './charts.css'

// Hover readout: one tooltip listing every series at the hovered x, value first, series name second.
function ChartTooltip({ active, payload, label, series, xLabel, yFormat }) {
  if (!active || !payload?.length) return null
  const label_of = key => series.find(s => s.key === key)
  const rows = payload.filter(p => p.value != null && label_of(p.dataKey)).sort((a, b) => b.value - a.value) // series only (not their bands)
  return (
    <div className="chart-tip">
      <div className="chart-tip-x">{xLabel(label)}</div>
      {rows.map(p => (
        <div key={p.dataKey} className="chart-tip-row">
          <span className="line-key" style={{ background: label_of(p.dataKey)?.color }} />
          <b>{yFormat(p.value)}</b>
          <span>{label_of(p.dataKey)?.label ?? p.dataKey}</span>
        </div>
      ))}
    </div>
  )
}

// A titled card with a multi-series line chart. `series` = [{key, label, color, dashed?, points: [{x, y, band?: [lo, hi]}]}].
// `legend` defaults to on for 2+ series (pass false when a shared legend sits above a group of charts).
// Two or more series always get a legend (identity is never color alone); every chart can be read as a table.
export default function LineChartCard({
  title, subtitle, help, series, yFormat = v => v, xFormat = fmtGames, xLabel = x => `${x.toLocaleString()} games/deck`,
  yDomain = ['auto', 'auto'], refLines = [], height = 260, loading = false, xName = 'Games per deck', legend = series.length > 1, toolbar = null, alignLegend = false,
}) {
  const [table, setTable] = useState(false)
  const rows = pivot(Object.fromEntries(series.map(s => [s.key, s.points])))
  const empty = rows.length === 0
  return (
    <div className="card chart-card" style={loading ? { opacity: 0.55 } : undefined}>
      <div className="chart-head">
        <div>
          <div className="chart-title">{title}</div>
          {subtitle && <div className="hint">{subtitle}</div>}
        </div>
        <div className="chart-actions">
          {help && <HelpLink to={help} />}
          {!empty && <button className="chart-toggle" onClick={() => setTable(t => !t)}>{table ? 'Chart' : 'Table'}</button>}
        </div>
      </div>
      {toolbar}
      {!legend && alignLegend && <div className="chart-legend" aria-hidden="true" />}
      {legend && (
        <div className="chart-legend">
          {series.map(s => <span key={s.key} className="legend-item"><span className="line-key" style={{ background: s.color }} />{s.label}</span>)}
        </div>
      )}
      {empty && <p className="hint">no data yet</p>}
      {!empty && !table && (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#262a31" vertical={false} />
              <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickFormatter={xFormat}
                     stroke="#3a3f47" tick={{ fill: '#8a909b', fontSize: 11 }} tickLine={false} interval="preserveStartEnd" minTickGap={32} />
              <YAxis domain={yDomain} tickFormatter={yFormat} stroke="#3a3f47" tick={{ fill: '#8a909b', fontSize: 11 }}
                     tickLine={false} axisLine={false} width={46} />
              <Tooltip cursor={{ stroke: '#6b717c', strokeWidth: 1 }} isAnimationActive={false}
                       content={<ChartTooltip series={series} xLabel={xLabel} yFormat={yFormat} />} />
              {refLines.map(r => (
                <ReferenceLine key={r.label} y={r.y} stroke="#6b717c" strokeDasharray="4 4"
                               label={{ value: r.label, position: 'insideTopRight', fill: '#8a909b', fontSize: 11 }} />
              ))}
              {series.filter(s => s.points.some(p => p.band)).map(s => (
                <Area key={`${s.key}-band`} dataKey={`${s.key}__band`} stroke="none" fill={s.color} fillOpacity={0.14}
                      isAnimationActive={false} activeDot={false} legendType="none" />
              ))}
              {series.map(s => (
                <Line key={s.key} strokeDasharray={s.dashed ? '5 4' : undefined} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} connectNulls
                      isAnimationActive={false} activeDot={{ r: 4.5, fill: s.color, stroke: SURFACE, strokeWidth: 2 }} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      {!empty && table && (
        <div className="chart-table-wrap" style={{ maxHeight: height }}>
          <table className="data-table">
            <thead><tr><th>{xName}</th>{series.map(s => <th key={s.key}>{s.label}</th>)}</tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.x}><td>{r.x.toLocaleString()}</td>{series.map(s => <td key={s.key}>{r[s.key] == null ? '—' : yFormat(r[s.key])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
