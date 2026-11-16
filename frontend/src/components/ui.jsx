import { Fragment } from 'react'
import { Link } from 'react-router-dom'

// Small presentational pieces shared across pages (styled in ui.css).

export const Card = ({ title, children, className = '', style }) => (
  <div className={`card ${className}`} style={style}>
    {title && <div className="card-title">{title}</div>}
    {children}
  </div>
)

export const Callout = ({ kind = 'info', title, children }) => (
  <div className={`callout ${kind}`}>
    <span className="callout-title">{title}</span>
    {children}
  </div>
)

export const Drill = ({ summary, id, children }) => (
  <details className="drill" id={id}>
    <summary>{summary}</summary>
    <div className="drill-body">{children}</div>
  </details>
)

// "How is this measured? →" link to a methodology section (element id); the target page scrolls to it and opens it.
export const HelpLink = ({ to, children = 'How is this measured?' }) => (
  <Link className="help-link" to={`/methodology#${to}`}>{children} →</Link>
)

// head: array of header labels; rows: array of arrays of cells
export const DataTable = ({ head, rows }) => (
  <table className="data-table">
    <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
  </table>
)

// A row of boxes joined by arrows: items = [{t, d}]
export const FlowRow = ({ label, items }) => (
  <div className="flow-row">
    <span className="row-label">{label}</span>
    {items.map((it, i) => (
      <Fragment key={i}>
        {i > 0 && <div className="flow-arrow">→</div>}
        <div className="flow-box"><div className="t">{it.t}</div><div className="d">{it.d}</div></div>
      </Fragment>
    ))}
  </div>
)

export const ArchNode = ({ t, d }) => (
  <div className="arch-node"><div className="t">{t}</div>{d && <div className="d">{d}</div>}</div>
)
export const ArchDown = ({ children }) => <div className="arch-down"><b>↓</b>{children}</div>

// Two curves converging on one point (x positions follow the viewBox).
export const MergeConnector = ({ viewBox = '0 0 300 26', left = 70, right = 230, mid = 150, wide }) => (
  <svg className="merge-connector" viewBox={viewBox} preserveAspectRatio={wide ? 'none' : undefined}
       style={wide ? { maxWidth: 'none' } : undefined}>
    <path className="curve" d={`M ${left} 1 C ${left} 15, ${mid} 13, ${mid} 25`} />
    <path className="curve" d={`M ${right} 1 C ${right} 15, ${mid} 13, ${mid} 25`} />
  </svg>
)
