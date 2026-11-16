import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Card images are hotlinked from Scryfall (nothing cached or committed); a failed load falls back to the name.
const scryfall = (name, version) =>
  `https://api.scryfall.com/cards/named?format=image&version=${version}&fuzzy=${encodeURIComponent(name)}`

// Placement for a fixed-position popup: beside the anchor rect (right, else left), clamped to the viewport.
// Rendered through a portal so a transformed ancestor (a tapped, rotated card) can't offset it.
function useFloat(anchor) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return
    const { offsetWidth: w, offsetHeight: h } = ref.current
    const m = 8
    let left = anchor.right + m
    if (left + w > innerWidth - m) left = anchor.left - w - m
    setPos({
      left: Math.max(m, Math.min(left, innerWidth - w - m)),
      top: Math.max(m, Math.min(anchor.top + anchor.height / 2 - h / 2, innerHeight - h - m)),
    })
  }, [anchor])
  return [ref, pos]
}

// Hover handlers + the popup for one anchor element: const { bind, popup } = useHover(content)
function useHover(render) {
  const [anchor, setAnchor] = useState(null)
  const [ref, pos] = useFloat(anchor)
  const bind = { onMouseEnter: e => setAnchor(e.currentTarget.getBoundingClientRect()), onMouseLeave: () => setAnchor(null) }
  const popup = anchor && createPortal(<div ref={ref} className="float-pop" style={pos}>{render()}</div>, document.body)
  return { bind, popup }
}

// One card face. `card` (optional) is a battlefield entry: tapped / P-T / attacking / blocking / token.
export function CardView({ name, card, noPreview }) {
  const [broken, setBroken] = useState(false)
  const { bind, popup } = useHover(() => <img className="card-large" src={scryfall(name, 'normal')} alt={name} />)
  const c = card || {}
  const pt = c.power != null && c.toughness != null
  const delta = pt && c.base_power != null ? (c.power - c.base_power) + (c.toughness - c.base_toughness) : 0
  return (
    <div className={`card-slot${c.tapped ? ' tapped' : ''}`} {...(noPreview ? {} : bind)}>
      <div className={`card-face${c.attacking ? ' attacking' : ''}${c.blocking ? ' blocking' : ''}`} title={name}>
        {broken
          ? <div className="card-fallback">{name}</div>
          : <img src={scryfall(name, 'small')} alt={name} loading="lazy" onError={() => setBroken(true)} />}
        {pt && <div className={`card-pt${delta > 0 ? ' up' : delta < 0 ? ' down' : ''}`}>{c.power}/{c.toughness}</div>}
        {c.is_token && <div className="card-token">T</div>}
      </div>
      {!noPreview && popup}
    </div>
  )
}

// A zone pile (graveyard / exile): the most recently added card on top, a count, and the full contents on hover.
export function Pile({ label, cards }) {
  const { bind, popup } = useHover(() => (
    <div className="pile-flyout">{cards.map((n, i) => <CardView key={i} name={n} />)}</div>
  ))
  return (
    <div className="pile">
      <div className="pile-label">{label}</div>
      <div className="pile-body" {...(cards.length ? bind : {})}>
        {cards.length
          ? <><CardView name={cards[cards.length - 1]} noPreview /><span className="pile-count">{cards.length}</span></>
          : <div className="pile-empty">empty</div>}
        {cards.length > 0 && popup}
      </div>
    </div>
  )
}
