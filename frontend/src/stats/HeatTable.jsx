// A small heat table: rows (decks) x columns (e.g. anchor ages), each cell {text, color, title} or null. The number is
// always printed; color only reinforces it. `cell(row, col)` supplies a cell.
export default function HeatTable({ rows, cols, cell, corner, colLabel = c => c.toLocaleString() }) {
  if (!rows.length || !cols.length) return <p className="hint">no data yet</p>
  return (
    <table className="matrix heat">
      <thead><tr><th>{corner}</th>{cols.map(c => <th key={c}>{colLabel(c)}</th>)}</tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r}>
            <th>{r.split('_').flatMap((w, i, all) => (i < all.length - 1 ? [w + '_', <wbr key={i} />] : [w]))}</th>
            {cols.map(c => {
              const x = cell(r, c)
              return x
                ? <td key={c} className="matrix-cell" style={{ background: x.color }} title={x.title}>{x.text}</td>
                : <td key={c} className="matrix-empty">·</td>
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
