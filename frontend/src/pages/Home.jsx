import { Link } from 'react-router-dom'
import './home.css'

const CARDS = [
  { to: '/replay', icon: '🎬', title: 'Game Replay', text: "Step through a logged game's board state, event by event." },
  { to: '/stats', icon: '📊', title: 'Validation Stats', text: 'Win rates, PPO diagnostics, and mulligan behavior from training runs.' },
  { to: '/methodology', icon: '🧠', title: 'Training Methodology', text: 'How self-play, the model, reward shaping, and PPO fit together.' },
]

export default function Home() {
  return (
    <div className="home">
      <h1>Pauper Sim</h1>
      <p className="sub">Magic: the Gathering engine + RL training harness</p>
      <div className="cards">
        {CARDS.map(c => (
          <Link key={c.to} className="home-card" to={c.to}>
            <div className="icon">{c.icon}</div>
            <h2>{c.title}</h2>
            <p>{c.text}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
