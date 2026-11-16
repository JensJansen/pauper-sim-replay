import { CardView, Pile } from './Cards'

const ATTACH_STEP = 36 // px of each attachment left visible beneath/above its host at --k = 1 (see replay-board.css)
const tuck = n => `calc(${n * ATTACH_STEP}px * var(--k))` // n steps, scaled by the board's size knob

const hostKey = (idx, c) => `${idx}|${c.name}|${c.slot}`
const attachKey = e => `${e.controller_idx}|${e.name}|${e.slot}`

// Attachments (auras, equipment: any battlefield entry with `enchanting`) grouped by their host's key.
// An entry whose host isn't on the battlefield stays a normal permanent.
export function groupAttachments(players) {
  const hosts = new Set(players.flatMap((p, idx) => p.battlefield.map(c => hostKey(idx, c))))
  const byHost = new Map()
  const attached = new Set()
  for (const p of players) {
    for (const c of p.battlefield) {
      if (c.enchanting && hosts.has(attachKey(c.enchanting))) {
        const k = attachKey(c.enchanting)
        byHost.set(k, [...(byHost.get(k) || []), c])
        attached.add(c)
      }
    }
  }
  return { byHost, attached }
}

// A permanent with its attachments tucked behind it (the attachment nearest the host is on top, so every
// strip shows). `flip` (the top player) tucks them upward instead of downward, so the two sides mirror.
function Permanent({ card, attachments, flip }) {
  const n = attachments.length
  const pad = tuck(n)
  return (
    <div className="perm" style={flip ? { paddingTop: pad } : { paddingBottom: pad }}>
      {attachments.map((a, i) => (
        <div key={i} className="perm-attach"
             style={{ top: tuck(flip ? n - 1 - i : i + 1), zIndex: n - i }}>
          <CardView name={a.name} card={a} />
        </div>
      ))}
      <div className="perm-host"><CardView name={card.name} card={card} /></div>
    </div>
  )
}

const Stat = ({ label, children }) => <div className="stat"><span>{label}</span><b>{children}</b></div>

function PlayerArea({ player, idx, top, groups }) {
  const perms = player.battlefield.filter(c => !groups.attached.has(c))
  const bfRow = (label, test) => (
    <div className="bf-row" data-label={label} key={label}>
      {perms.filter(test).map((c, i) => (
        <Permanent key={`${c.name}|${c.slot}|${i}`} card={c} attachments={groups.byHost.get(hostKey(idx, c)) || []} flip={top} />
      ))}
    </div>
  )
  // Three battlefield rows, from the opponent outward: creatures, then artifacts/enchantments/other, then lands.
  // The top player's order is reversed, so both sides mirror around the stack.
  const rows = [
    bfRow('Creatures', c => c.card_type === 'CREATURE'),
    bfRow('Artifacts & enchantments', c => c.card_type !== 'CREATURE' && c.card_type !== 'LAND'),
    bfRow('Lands', c => c.card_type === 'LAND'),
  ]
  const board = <div className="board-box">{top ? rows.reverse() : rows}</div>
  const hand = (
    <div className="hand-box">
      <div className="box-label">Hand · {player.hand.length}</div>
      <div className="hand-cards">{player.hand.map((n, i) => <CardView key={i} name={n} />)}</div>
    </div>
  )
  const mana = Object.entries(player.mana_pool || {}).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ')
  return (
    <section className={`player p${idx}`}>
      <aside className="stats">
        <div className="seat-tag">Player {idx}</div>
        <div className="life">{player.life}<span>life</span></div>
        <div className="stat-grid">
          <Stat label="Hand">{player.hand.length}</Stat>
          <Stat label="Library">{player.library_remaining}</Stat>
          <Stat label="Mana">{mana || '—'}</Stat>
        </div>
        <div className="pile-row">
          <Pile label="Graveyard" cards={player.graveyard} />
          <Pile label="Exile" cards={player.exile} />
        </div>
      </aside>
      {/* the hand sits on the outer edge, apart from the battlefield */}
      <div className="field">{top ? <>{hand}{board}</> : <>{board}{hand}</>}</div>
    </section>
  )
}

// The strip between the two boards: the one stack both players share (top of the stack first, each entry tinted
// by its controller) on the left, and the agent's decision on the right.
export function CenterStrip({ step, decision }) {
  const entries = [...step.stack].reverse()
  const top = step.stack[step.stack.length - 1] // the most recent item tints the whole zone
  return (
    <div className="center-strip">
      <div className={`stack-zone${top ? ` p${top.controller}` : ''}`}>
        <span className="row-tag">Stack · {step.stack.length}</span>
        {entries.length === 0 && <span className="hint">empty</span>}
        {entries.map((e, i) => (
          <div key={i} className={`stack-entry p${e.controller}`}>
            <CardView name={e.name} />
            <div className="stack-meta"><b>P{e.controller}</b>{i === 0 && <span> · top</span>}<div>{e.name}</div></div>
          </div>
        ))}
      </div>
      {decision}
    </div>
  )
}

// P1 on top, P0 on the bottom, the center strip between them.
export default function Board({ step, decision }) {
  const groups = groupAttachments(step.players)
  return (
    <div className="board">
      <PlayerArea player={step.players[1]} idx={1} top groups={groups} />
      <CenterStrip step={step} decision={decision} />
      <PlayerArea player={step.players[0]} idx={0} groups={groups} />
    </div>
  )
}
