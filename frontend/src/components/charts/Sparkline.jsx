import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from 'recharts'
import { SURFACE } from '../../lib/palette'

// A small trend line with a scale, a labelled baseline and an end-dot. points: [{x, y}].
//   baseline  the value to read change against (the first tick, or "no progress" at 50%): a dashed line the series
//             visibly rises above or falls below
//   fmt       formats the two scale labels (the series' min and max, so the vertical extent is never unlabelled)
// The domain fits the data and the baseline, so growth or loss is visible instead of being squashed into a 0-100% frame.
export default function Sparkline({ points, color, baseline, baselineLabel, labelPosition = 'insideBottomRight', fmt = v => v, xFmt = x => x.toLocaleString(), height = 64, yDomain }) {
  if (points.length < 2) return <div style={{ height }} />
  const ys = points.map(p => p.y)
  const all = baseline != null ? [...ys, baseline] : ys
  const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo || 0.02) * 0.18
  const domain = yDomain ?? [lo - pad, hi + pad]
  const ticks = [Math.min(...ys), Math.max(...ys)]
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 6, left: 0 }}>
          <YAxis domain={domain} ticks={ticks} tickFormatter={fmt} width={36} axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#7d838f' }} />
          {baseline != null && (
            <ReferenceLine y={baseline} stroke="#6b717c" strokeDasharray="3 3"
                           label={baselineLabel ? { value: baselineLabel, position: labelPosition, fill: '#7d838f', fontSize: 9 } : undefined} />
          )}
          <Tooltip isAnimationActive={false} cursor={{ stroke: '#6b717c' }}
                   content={({ active, payload }) => (active && payload?.length
                     ? <div className="chart-tip"><b style={{ color: '#fff' }}>{fmt(payload[0].value)}</b> <span className="chart-tip-x">at {xFmt(payload[0].payload.x)} games/deck</span></div> : null)} />
          <Line dataKey="y" stroke={color} strokeWidth={2} isAnimationActive={false}
                activeDot={{ r: 4, fill: color, stroke: SURFACE, strokeWidth: 2 }}
                dot={({ index, cx, cy }) => (index === points.length - 1
                  ? <circle key="end" cx={cx} cy={cy} r={4} fill={color} stroke={SURFACE} strokeWidth={2} /> : <g key={index} />)} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
