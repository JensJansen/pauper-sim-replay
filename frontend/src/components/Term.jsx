import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import GLOSSARY from '../glossary'

// Hover/focus glossary term: <Term k="pfsp">PFSP</Term>. The tooltip is fixed-positioned and clamped to the viewport.
// When the entry names a methodology section, the term is also a link to it.
export default function Term({ k, children }) {
  const [anchor, setAnchor] = useState(null) // bounding rect of the term while the tooltip shows
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const tip = useRef(null)
  const def = GLOSSARY[k]

  useLayoutEffect(() => {
    if (!anchor || !tip.current) return
    const { offsetWidth: tw, offsetHeight: th } = tip.current
    const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - tw / 2, window.innerWidth - tw - 8))
    const above = anchor.top - th - 8
    setPos({ left, top: above < 4 ? anchor.bottom + 8 : above })
  }, [anchor])

  const show = e => setAnchor(e.currentTarget.getBoundingClientRect())
  const hide = () => setAnchor(null)
  const props = { className: 'term', onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide }
  return (
    <>
      {def?.[2]
        ? <Link {...props} to={`/methodology#${def[2]}`}>{children}</Link>
        : <span {...props} tabIndex={0}>{children}</span>}
      {anchor && def && (
        <span ref={tip} className="term-tip" role="tooltip" style={pos}>
          <span className="term-tip-title">{def[0]}</span>{def[1]}
          {def[2] && <span className="term-tip-more">Click to read how this works →</span>}
        </span>
      )}
    </>
  )
}
