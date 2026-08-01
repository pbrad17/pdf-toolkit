import { createElement, useCallback, useRef } from 'react'
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
 * Selection colour, on paper.
 *
 * Selection chrome is drawn over the page, which is white in both themes, so it
 * cannot use the accent that the rest of the UI uses: `--theme-accent` is
 * #F9AC2A on dark and reaches only 1.92:1 against paper, well under the 3:1 a
 * non-text indicator needs. `--theme-accent-soft-border` is the one accent token
 * that clears 3:1 on white at both ends of the ramp — 4.23:1 light, 3.76:1 dark
 * — so it is what selection is drawn in here. Still amber, still the same family
 * as the selected state in the chrome; it just survives the theme flip.
 */
const SELECT_RING = 'ring-accent-soft-border'

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
  /**
   * Height an aspect-locked annotation takes up, per unit of its width, both as
   * fractions of the page. The gesture maths works in page fractions, so the
   * derived height has to be expressed in them too — mixing it with raw pixels
   * is what let a north drag resize by a page-height fraction against a
   * page-width one.
   */
  const heightPerWidth = pageWidth / (aspect * Math.max(1, pageHeight))
  const heightFraction = ASPECT_LOCKED.has(ann.type)
    ? (ann.width ?? 0.15) * heightPerWidth
    : (ann.height ?? 0.04)

  const left = ann.x * pageWidth
  const top = ann.y * pageHeight
  const width = (ann.width ?? 0.15) * pageWidth
  const height = heightFraction * pageHeight

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
      origin: { x: ann.x, y: ann.y, width: ann.width ?? 0.15, height: heightFraction },
    }
  }, [ann, heightFraction, beginInteraction, setSelectedAnnotationId])

  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = (e.clientX - drag.startX) / pageWidth
    const dy = (e.clientY - drag.startY) / pageHeight
    const o = drag.origin

    if (drag.mode === 'move') {
      updateAnnotationLive(page.id, ann.id, {
        x: Math.max(0, Math.min(1 - o.width, o.x + dx)),
        // Bounded by the bottom edge for the same reason x is bounded by the
        // right one. Clamping to 1 instead let the whole box be dragged past
        // the foot of the page, where it is invisible on screen and lands
        // below the page box on export — the annotation is simply gone.
        y: Math.max(0, Math.min(1 - o.height, o.y + dy)),
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
      // Height is derived from width for these, so only width is stored — and
      // a handle that moved only a horizontal edge has to be re-expressed as a
      // width change. Storing the raw x/y/w from above instead meant a north
      // drag slid the whole signature up the page rather than growing it, and
      // a south drag did nothing at all: its height never reached the state.
      const vertical = h === 'n' || h === 's'
      const nextWidth = Math.max(MIN, vertical ? hh / heightPerWidth : w)
      updateAnnotationLive(page.id, ann.id, {
        x,
        // A north drag pins the bottom edge; every other handle pins the top.
        y: h.includes('n') ? o.y + o.height - nextWidth * heightPerWidth : o.y,
        width: nextWidth,
      })
    } else {
      updateAnnotationLive(page.id, ann.id, { x, y, width: w, height: hh })
    }
  }, [ann, page.id, pageWidth, pageHeight, heightPerWidth, updateAnnotationLive])

  const endGesture = useCallback(() => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    endInteraction(drag.mode === 'move' ? 'Move annotation' : 'Resize annotation')
  }, [endInteraction])

  // Opacity belongs to the annotation, not to the selection chrome drawn around
  // it. Applied to the wrapper it also faded the ring and the handles, so a
  // highlight at its default 0.4 got a 40% selection outline and handles that
  // were hard to see against the mark they were resizing. It is applied to the
  // body instead; nothing else about the annotation changes.
  const commonStyle = {
    left, top, width,
    height: ann.type === 'note' ? undefined : height,
    // The layer beneath is transparent to pointer events unless a placement
    // tool is active, so each annotation opts itself back in. Without this an
    // existing annotation could not be selected, moved or resized while the
    // select tool was active — which is the only tool you would use to do it.
    pointerEvents: 'auto',
  }

  return (
    <div
      className={`absolute ${selected ? `ring-1 ${SELECT_RING}` : ''}`}
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
      <AnnotationBody ann={ann} pageWidth={pageWidth} opacity={ann.opacity ?? 1} />

      {selected && HANDLES.map(([name, fx, fy]) => (
        // The hit target is the 16px box; the mark inside it is 8px. A square
        // reads as a resize grip rather than a dot, and the white rim is what
        // keeps it visible when the annotation sits over dark page content —
        // the amber alone would disappear into a photograph.
        //
        // Both boxes are centred on the same point the 10px handle used, so the
        // grab point has not moved; only the target around it got bigger.
        <div
          key={name}
          className="absolute w-4 h-4 -ml-2 -mt-2 flex items-center justify-center"
          style={{ left: `${fx * 100}%`, top: `${fy * 100}%`, cursor: CURSORS[name] }}
          onPointerDown={(e) => startGesture(e, 'resize', name)}
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
        >
          <span className="block w-2 h-2 bg-accent-soft-border ring-1 ring-white shadow-[var(--theme-shadow-sm)]" />
        </div>
      ))}
    </div>
  )
}

/** Visual for each annotation type. Kept separate so gestures stay readable. */
function AnnotationBody({ ann, pageWidth, opacity = 1 }) {
  switch (ann.type) {
    case 'text': {
      const spans = getSpans(ann)
      return (
        <div
          className="w-full h-full overflow-hidden whitespace-pre-wrap break-words leading-tight"
          style={{
            opacity,
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
      return <img src={ann.dataUrl} alt="" style={{ opacity }} className="w-full h-full object-contain pointer-events-none" draggable={false} />

    case 'stamp':
      return (
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ opacity }} className="pointer-events-none">
          {/* getShapeSvgElements returns { el, props } descriptors, not React
              elements — it is shared with the PDF exporter, which cannot use
              JSX. Rendering the descriptors directly threw "Objects are not
              valid as a React child" the instant a shape was drawn. */}
          {getShapeSvgElements(ann.shape, ann.strokeColor, ann.strokeWidth, ann.fillColor, ann.flipped)
            .map(({ el, props }, i) => createElement(el, { key: i, ...props }))}
        </svg>
      )

    case 'draw':
      return (
        <svg width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none" style={{ opacity }} className="pointer-events-none overflow-visible">
          {/* non-scaling-stroke already takes the width in CSS pixels rather
              than in the 0..1 viewBox units, so dividing by the box width
              divided it a second time: a 10px pen came out at 10/183 of a
              pixel, a ghost hairline, the instant the stroke was committed —
              while the placement preview beside it drew the full 10px. */}
          <polyline
            points={(ann.points || []).map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={ann.color || '#000'}
            strokeWidth={ann.strokeWidth || 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )

    case 'redact':
      return (
        // Deliberately the loudest thing on the page. Solid black at full
        // opacity, because on export this content is destroyed and not
        // recoverable — a translucent or tinted treatment would read as a
        // reversible mark. The label is full white rather than 70%, and large
        // enough to survive compact density, because "marked, not yet removed"
        // is the one thing the box itself cannot say. overflow-hidden keeps the
        // label from spilling onto the page when the box is smaller than the
        // word; the black bar alone is unambiguous at that size.
        <div className="w-full h-full bg-black relative overflow-hidden">
          <span className="absolute inset-0 flex items-center justify-center whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.12em] text-white select-none">
            REDACT
          </span>
        </div>
      )

    case 'highlight':
      return <div className="w-full h-full" style={{ opacity, background: ann.color || '#FFFF00' }} />

    case 'note':
      return (
        <div className="flex items-start gap-1" style={{ opacity }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill={ann.color || '#FFF176'} stroke="rgba(0,0,0,.35)" strokeWidth="1.8">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
      )

    default:
      return null
  }
}
