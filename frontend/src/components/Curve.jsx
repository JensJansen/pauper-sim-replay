// Tiny SVG line/step chart of a function of x -- the methodology page's schedule and penalty curves.
export default function Curve({ fn, w = 300, h = 130, xMin, xMax, yMin, yMax, steps = 100, step, color = '#6a9dff', xTicks, yTicks, xFmt = v => v, yFmt = v => v }) {
  const padL = 30, padR = 8, padT = 8, padB = 20
  const pts = Array.from({ length: steps + 1 }, (_, i) => { const x = xMin + (xMax - xMin) * i / steps; return [x, fn(x)] })
  yMin ??= Math.min(...pts.map(p => p[1]))
  yMax ??= Math.max(...pts.map(p => p[1]))
  const sx = x => padL + (x - xMin) / (xMax - xMin) * (w - padL - padR)
  const sy = y => h - padB - (y - yMin) / (yMax - yMin || 1) * (h - padT - padB)
  const f = n => n.toFixed(1)

  let d = `M${f(sx(pts[0][0]))},${f(sy(pts[0][1]))}`
  for (let i = 1; i < pts.length; i++) {
    if (step) d += ` L${f(sx(pts[i][0]))},${f(sy(pts[i - 1][1]))}`
    d += ` L${f(sx(pts[i][0]))},${f(sy(pts[i][1]))}`
  }
  yTicks ??= [yMin, (yMin + yMax) / 2, yMax]
  xTicks ??= [xMin, xMax]
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {yTicks.map(v => (
        <g key={`y${v}`}>
          <line x1={padL} y1={f(sy(v))} x2={w - padR} y2={f(sy(v))} stroke="#23262c" strokeWidth="1" />
          <text x="1" y={f(sy(v) + 3)} fontSize="9" fill="#666">{yFmt(v)}</text>
        </g>
      ))}
      {xTicks.map(v => (
        // edge ticks anchor outward so a wide label isn't clipped by the viewBox
        <text key={`x${v}`} x={f(sx(v))} y={h - 5} fontSize="9" fill="#666"
              textAnchor={v === xMin ? 'start' : v === xMax ? 'end' : 'middle'}>{xFmt(v)}</text>
      ))}
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
