import { useCallback, useRef } from 'react'
import { useEditor } from '../state/useEditor'
import { getSpans, getBaseFontCSS } from '../utils/richTextUtils'
import { getShapeSvgElements } from '../utils/shapeDefinitions'

/** Resize handles, as [name, xFactor, yFactor] against the annotation box. */
const HANDLES = [
  ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0],
  ['w', 0, 0.5], ['e', 1, 0.5],
  ['sw', 0, 1], ['s', 0.5, 1], ['se', 1, 1],
]

const CURSORS = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  w: 'ew-resize', e: 'ew-resize',
}

/** Types whose height follows their width, so corner drags stay proportional. */
const ASPECT_LOCKED = new Set(['signature', 'image'])

/**
 * A single annotation rendered over the page, with drag-to-move and
 * eight-handle resize.
 *
 * Coordinates are stored as 0..1 fractions of the page so an annotation stays
 * put across zoom changes, rotation and export. Pointer deltas are therefore
 * divided by the rendered page size before being applied.
 *
 * Gestures are bracketed by beginInteraction/endInteraction so a drag produces
 * exactly one undo entry rather than one per pointer event.
 */
export default function AnnotationItem({ annotation: ann, page, pageWidth, pageHeight, selected }) {
  const {
    updateAnnotationLive, beginInteraction, endInteraction,
    setSelectedAnnotationId, removeAnnotation,
  } = useEditor()

  const dragRef = useRef(null)

  const aspect = ann.aspect || 1
  const left = ann.x * pageWidth
  const top = ann.y * pageHeight
  const width = (ann.width ?? 0.15) * pageWidth
  const height = ASPECT_LOCKED.has(ann.type)
    ? width / aspect
    : (ann.height ?? 0.04) * pageHeight

  const startGesture = useCallback((e, mode, handle) => {
    e.stopPropagation()
    e.preventDefault()
    // Capture keeps the drag tracking if the cursor leaves the element, but it
    // throws when the pointer is already gone; a gesture must not depend on it.
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* non-fatal */ }
    setSelectedAnnotationId(ann.id)
    beginInteraction()
    dragRef.current = {
      mode, handle,
      startX: e.clientX,
      startY: e.clientY,
      origin: { x: ann.x, y: ann.y, width: ann.width ?? 0.15, height: ann.height ?? 0.04 },
    }
  }, [ann, beginInteraction, setSelectedAnnotationId])

  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = (e.clientX - drag.startX) / pageWidth
    const dy = (e.clientY - drag.startY) / pageHeight
    const o = drag.origin

    if (drag.mode === 'move') {
      updateAnnotationLive(page.id, ann.id, {
        x: Math.max(0, Math.min(1 - o.width, o.x + dx)),
        y: Math.max(0, Math.min(1, o.y + dy)),
      })
      return
    }

    // Resize: each handle moves only the edges it touches.
    const h = drag.handle
    let { x, y, width: w, height: hh } = o
    const MIN = 0.01

    if (h.includes('w')) { const nx = Math.min(o.x + dx, o.x + o.width - MIN); w = o.width + (o.x - nx); x = nx }
    if (h.includes('e')) { w = Math.max(MIN, o.width + dx) }
    if (h.includes('n')) { const ny = Math.min(o.y + dy, o.y + o.height - MIN); hh = o.height + (o.y - ny); y = ny }
    if (h.includes('s')) { hh = Math.max(MIN, o.height + dy) }

    if (ASPECT_LOCKED.has(ann.type)) {
      // Height is derived from width for these, so only width is stored.
      updateAnnotationLive(page.id, ann.id, { x, y, width: w })
    } else {
      updateAnnotationLive(page.id, ann.id, { x, y, width: w, height: hh })
    }
  }, [ann, page.id, pageWidth, pageHeight, updateAnnotationLive])

  const endGesture = useCallback(() => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    endInteraction(drag.mode === 'move' ? 'Move annotation' : 'Resize annotation')
  }, [endInteraction])

  const commonStyle = {
    left, top, width,
    height: ann.type === 'note' ? undefined : height,
    opacity: ann.opacity ?? 1,
  }

  return (
    <div
      className={`absolute ${selected ? 'ring-2 ring-accent' : ''}`}
      style={commonStyle}
      onPointerDown={(e) => startGesture(e, 'move')}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      role="button"
      tabIndex={0}
      aria-label={`${ann.type} annotation`}
      onKeyDown={(e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') removeAnnotation(page.id, ann.id)
      }}
    >
      <AnnotationBody ann={ann} width={width} pageWidth={pageWidth} />

      {selected && HANDLES.map(([name, fx, fy]) => (
        <div
          key={name}
          className="absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full bg-accent-strong border border-white shadow"
          style={{ left: `${fx * 100}%`, top: `${fy * 100}%`, cursor: CURSORS[name] }}
          onPointerDown={(e) => startGesture(e, 'resize', name)}
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
        />
      ))}
    </div>
  )
}

/** Visual for each annotation type. Kept separate so gestures stay readable. */
function AnnotationBody({ ann, width, pageWidth }) {
  switch (ann.type) {
    case 'text': {
      const spans = getSpans(ann)
      return (
        <div
          className="w-full h-full overflow-hidden whitespace-pre-wrap break-words leading-tight"
          style={{
            // fontSize is stored in points; the page renders at pageWidth px
            // for a page of ann.pageWidthPt points, so scale accordingly.
            fontSize: (ann.fontSize || 14) * (pageWidth / (ann.refWidthPt || pageWidth)),
            fontFamily: getBaseFontCSS(ann.fontFamily || 'Helvetica'),
            color: ann.color || '#000000',
          }}
        >
          {spans.map((s, i) => (
            <span
              key={i}
              style={{
                fontWeight: s.bold ? 700 : 400,
                fontStyle: s.italic ? 'italic' : 'normal',
                textDecoration: s.underline ? 'underline' : 'none',
              }}
            >
              {s.text}
            </span>
          ))}
        </div>
      )
    }

    case 'signature':
    case 'image':
      return <img src={ann.dataUrl} alt="" className="w-full h-full object-contain pointer-events-none" draggable={false} />

    case 'stamp':
      return (
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none">
          {getShapeSvgElements(ann.shape, ann.strokeColor, ann.strokeWidth, ann.fillColor, ann.flipped)}
        </svg>
      )

    case 'draw':
      return (
        <svg width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none overflow-visible">
          <polyline
            points={(ann.points || []).map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={ann.color || '#000'}
            strokeWidth={(ann.strokeWidth || 2) / Math.max(width, 1)}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )

    case 'redact':
      return (
        <div className="w-full h-full bg-black relative">
          {/* Marked, not yet removed — removal happens at export. Labelling it
              avoids implying the content is already gone. */}
          <span className="absolute inset-0 flex items-center justify-center text-[9px] text-white/70 select-none">
            REDACT
          </span>
        </div>
      )

    case 'highlight':
      return <div className="w-full h-full" style={{ background: ann.color || '#FFFF00' }} />

    case 'note':
      return (
        <div className="flex items-start gap-1">
          <svg width="20" height="20" viewBox="0 0 24 24" fill={ann.color || '#FFF176'} stroke="rgba(0,0,0,.35)" strokeWidth="1.5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
      )

    default:
      return null
  }
}
