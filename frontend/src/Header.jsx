import { Link } from 'react-router-dom'

const PAGES = [
  { to: '/replay', label: 'Game Replay' },
  { to: '/stats', label: 'Validation Stats' },
  { to: '/methodology', label: 'Methodology' },
]

// Same bar as the original pages: title + subtitle left, links to the other pages right.
export default function Header({ title, subtitle, current, children }) {
  return (
    <header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      <nav>
        {children}
        <Link to="/">Home</Link>
        {PAGES.filter(p => p.to !== current).map(p => <Link key={p.to} to={p.to}>{p.label}</Link>)}
      </nav>
    </header>
  )
}
