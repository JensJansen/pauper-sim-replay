import { useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, ErrorBar, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { SURFACE } from '../../lib/palette'
import { HelpLink } from '../ui'
import './charts.css'

function Tip({ active, payload, label, series, yFormat, xPrefix }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const find = k => series.find(s => s.key === k)
  const items = payload.filter(p => p.value != null && find(p.dataKey))
  return (
    <div className="chart-tip">
      <div className="chart-tip-x">{xPrefix}{label}</div>
      {items.map(p => (
        <div key={p.dataKey} className="chart-tip-row">
          <span className="line-key" style={{ background: find(p.dataKey).color }} />
          <b>{yFormat(p.value)}</b><span>{find(p.dataKey).label}</span>
        </div>
      ))}
      {row.note && <div className="chart-tip-x" style={{ marginTop: 4 }}>{row.note}</div>}
    </div>
  )
}

// A chart over a handful of ordered categories (opening land count 0-7). `series` = [{key, label, color, kind: 'bar' | 'line',
// dashed?, errorKey?}]; each data row is {label, [key]: value, note?}. Bars carry optional error whiskers (errorKey = a
// [minus, plus] pair or a single +/- value). Every chart can be read as a table.
export default function CategoryChart({ title, subtitle, help, data, series, yFormat = v => v, yDomain = ['auto', 'auto'], xPrefix = '', xName = 'Lands', height = 240, alignLegend = false }) {
  const [table, setTable] = useState(false)
  const bars = series.filter(s => s.kind === 'bar'), lines = series.filter(s => s.kind === 'line')
  return (
    <div className="card chart-card">
      <div className="chart-head">
        <div><div className="chart-title">{title}</div>{subtitle && <div className="hint">{subtitle}</div>}</div>
        <div className="chart-actions">
          {help && <HelpLink to={help} />}
          {data.length > 0 && <button className="chart-toggle" onClick={() => setTable(t => !t)}>{table ? 'Chart' : 'Table'}</button>}
        </div>
      </div>
      {series.length <= 1 && alignLegend && <div className="chart-legend" aria-hidden="true" />}
      {series.length > 1 && (
        <div className="chart-legend">
          {series.map(s => <span key={s.key} className="legend-item"><span className={s.kind === 'bar' ? 'bar-key' : 'line-key'} style={{ background: s.color }} />{s.label}</span>)}
        </div>
      )}
      {!data.length && <p className="hint">no data yet</p>}
      {data.length > 0 && !table && (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#262a31" vertical={false} />
              <XAxis dataKey="label" stroke="#3a3f47" tick={{ fill: '#8a909b', fontSize: 11 }} tickLine={false} />
              <YAxis domain={yDomain} tickFormatter={yFormat} stroke="#3a3f47" tick={{ fill: '#8a909b', fontSize: 11 }} tickLine={false} axisLine={false} width={46} />
              <Tooltip cursor={{ fill: '#ffffff0d' }} isAnimationActive={false} content={<Tip series={series} yFormat={yFormat} xPrefix={xPrefix} />} />
              {bars.map(s => (
                <Bar key={s.key} dataKey={s.key} fill={s.color} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {s.errorKey && <ErrorBar dataKey={s.errorKey} stroke="#c3c8d2" strokeWidth={1.5} width={6} />}
                </Bar>
              ))}
              {lines.map(s => (
                <Line key={s.key} dataKey={s.key} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} isAnimationActive={false}
                      dot={{ r: 4, fill: s.color, stroke: SURFACE, strokeWidth: 2 }} activeDot={{ r: 5, fill: s.color, stroke: SURFACE, strokeWidth: 2 }} connectNulls />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      {data.length > 0 && table && (
        <div className="chart-table-wrap" style={{ maxHeight: height }}>
          <table className="data-table">
            <thead><tr><th>{xName}</th>{series.map(s => <th key={s.key}>{s.label}</th>)}<th>Sample</th></tr></thead>
            <tbody>{data.map(r => <tr key={r.label}><td>{r.label}</td>{series.map(s => <td key={s.key}>{r[s.key] == null ? '—' : yFormat(r[s.key])}</td>)}<td>{r.note ?? ''}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
