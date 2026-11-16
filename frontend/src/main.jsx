import { Component } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Home from './pages/Home'
import Replay from './pages/Replay'
import Stats from './pages/Stats'
import Summary from './stats/Summary'
import Strength from './stats/Strength'
import Progress from './stats/Progress'
import Training from './stats/Training'
import Behavior from './stats/Behavior'
import Compare from './stats/Compare'
import Methodology from './pages/Methodology'
import './styles.css'

// A render error inside a page shows a message (and clears when you navigate) instead of blanking the whole site.
class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ padding: 24, maxWidth: 720 }}>
        <h2>Something went wrong on this page</h2>
        <p className="hint">{String(this.state.error.message || this.state.error)}</p>
        <p><a href="/">Back to the home page</a> · or pick another page from the header.</p>
      </div>
    )
  }
}

function Shell() {
  const { pathname, search } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname + search}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/replay" element={<Replay />} />
        <Route path="/stats" element={<Stats />}>
          <Route path="summary" element={<Summary />} />
          <Route path="progress" element={<Progress />} />
          <Route path="strength" element={<Strength />} />
          <Route path="training" element={<Training />} />
          <Route path="behavior" element={<Behavior />} />
          <Route path="compare" element={<Compare />} />
        </Route>
        <Route path="/methodology" element={<Methodology />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Shell />
  </BrowserRouter>,
)
