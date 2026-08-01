import { useCallback, useRef, useState } from 'react'
import { useEditor } from '../state/useEditor'
import AnnotationItem from './AnnotationItem'
import { AnnotationErrorBoundary } from '../ui/ErrorBoundary'

/**
 * Take pointer capture, tolerating failure.
 *
 * setPointerCapture throws if the pointer id is no longer active — which can
 * happen when a pointer is released or cancelled between the event being queued
 * and the handler running. Capture is an enhancement that keeps a drag tracking
 * outside the element; losing it must never abort the gesture before it starts.
 */
function capturePointer(el, pointerId) {
  try {
    el?.setPointerCapture?.(pointerId)
  } catch {
    // Drag still works, it just stops tracking if the cursor leaves the page.
  }
}

/** Tools that create an annotation by dragging out a rectangle. */
const DRAG_TOOLS = new Set(['highlight', 'redact', 'stamp'])
/** Tools that create an annotation with a single click. */
const CLICK_TOOLS = new Set(['text', 'note', 'signature', 'image'])

/**
 * Interactive overlay for one page: existing annotations plus the placement
 * surface for whichever tool is active.
 *
 * Placement lives here rather than in each tool so every tool gets the same
 * pointer handling, the same coordinate normalisation and the same single
 * undo entry per placement.
 */
export default function AnnotationLayer({ page, width, height }) {
  const {
    state, activeTool, toolOptions, addAnnotation,
    selectedAnnotationId, setSelectedAnnotationId,
  } = useEditor()

  const annotations = state.annotations[page.id] || []
  const surfaceRef = useRef(null)
  const drawRef = useRef(null)
  const [preview, setPreview] = useState(null)

  const isPlacing = DRAG_TOOLS.has(activeTool) || CLICK_TOOLS.has(activeTool) || activeTool === 'draw'

  /** Pointer position as a 0..1 fraction of the page box. */
  const fractionAt = useCallback((e) => {
    const rect = surfaceRef.current.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    }
  }, [])

  const placeClickAnnotation = useCallback((tool, pos) => {
    if (tool === 'text') {
      addAnnotation(page.id, {
        type: 'text', x: pos.x, y: pos.y, width: 0.3, height: 0.06,
        text: '', spans: [{ text: '', bold: false, italic: false, underline: false }],
        fontSize: toolOptions.text.fontSize,
        fontFamily: toolOptions.text.fontFamily,
        color: toolOptions.text.color,
        opacity: 1,
        refWidthPt: page.size.width,
      }, 'Add text')
    } else if (tool === 'note') {
      addAnnotation(page.id, {
        type: 'note', x: pos.x, y: pos.y, width: 0.03, height: 0.03,
        color: toolOptions.note.color, text: '',
      }, 'Add note')
    } else if (tool === 'signature' && toolOptions.signature.dataUrl) {
      addAnnotation(page.id, {
        type: 'signature', x: pos.x, y: pos.y,
        width: toolOptions.signature.width,
        dataUrl: toolOptions.signature.dataUrl,
        aspect: toolOptions.signature.aspect,
        opacity: 1,
      }, 'Add signature')
    } else if (tool === 'image' && toolOptions.image.dataUrl) {
      addAnnotation(page.id, {
        type: 'image', x: pos.x, y: pos.y,
        width: toolOptions.image.width,
        dataUrl: toolOptions.image.dataUrl,
        aspect: toolOptions.image.aspect,
        opacity: 1,
      }, 'Add image')
    }
  }, [addAnnotation, page.id, page.size.width, toolOptions])

  const handlePointerDown = useCallback((e) => {
    if (!isPlacing) {
      // Clicking bare page area with no placement tool clears the selection.
      if (e.target === surfaceRef.current && selectedAnnotationId) setSelectedAnnotationId(null)
      return
    }
    e.preventDefault()
    const pos = fractionAt(e)
    capturePointer(surfaceRef.current, e.pointerId)

    if (CLICK_TOOLS.has(activeTool)) {
      placeClickAnnotation(activeTool, pos)
      return
    }

    if (activeTool === 'draw') {
      drawRef.current = { kind: 'draw', points: [pos] }
      setPreview({ kind: 'draw', points: [pos] })
      return
    }

    drawRef.current = { kind: 'rect', start: pos, current: pos }
    setPreview({ kind: 'rect', start: pos, current: pos })
  }, [isPlacing, activeTool, fractionAt, selectedAnnotationId, setSelectedAnnotationId, placeClickAnnotation])

  const handlePointerMove = useCallback((e) => {
    const drag = drawRef.current
    if (!drag) return
    const pos = fractionAt(e)

    if (drag.kind === 'draw') {
      const last = drag.points[drag.points.length - 1]
      // Distance filter keeps stroke point counts manageable without visibly
      // changing the curve; unfiltered strokes bloat the exported PDF.
      const dx = (pos.x - last.x) * width
      const dy = (pos.y - last.y) * height
      if (dx * dx + dy * dy < 9) return
      drag.points.push(pos)
      setPreview({ kind: 'draw', points: [...drag.points] })
      return
    }

    drag.current = pos
    setPreview({ kind: 'rect', start: drag.start, current: pos })
  }, [fractionAt, width, height])

  const handlePointerUp = useCallback(() => {
    const drag = drawRef.current
    drawRef.current = null
    setPreview(null)
    if (!drag) return

    if (drag.kind === 'draw') {
      if (drag.points.length < 2) return
      const xs = drag.points.map(p => p.x)
      const ys = drag.points.map(p => p.y)
      const minX = Math.min(...xs), maxX = Math.max(...xs)
      const minY = Math.min(...ys), maxY = Math.max(...ys)
      const w = Math.max(maxX - minX, 0.001)
      const h = Math.max(maxY - minY, 0.001)
      addAnnotation(page.id, {
        type: 'draw',
        x: minX, y: minY, width: w, height: h,
        // Points are re-expressed inside the bounding box so the stroke scales
        // with the box when resized.
        points: drag.points.map(p => ({ x: (p.x - minX) / w, y: (p.y - minY) / h })),
        color: toolOptions.draw.color,
        strokeWidth: toolOptions.draw.strokeWidth,
        opacity: toolOptions.draw.opacity,
      }, 'Draw')
      return
    }

    const x = Math.min(drag.start.x, drag.current.x)
    const y = Math.min(drag.start.y, drag.current.y)
    const w = Math.abs(drag.current.x - drag.start.x)
    const h = Math.abs(drag.current.y - drag.start.y)
    if (w < 0.005 || h < 0.005) return

    if (activeTool === 'highlight') {
      addAnnotation(page.id, {
        type: 'highlight', x, y, width: w, height: h,
        color: toolOptions.highlight.color,
        opacity: toolOptions.highlight.opacity,
      }, 'Highlight')
    } else if (activeTool === 'redact') {
      addAnnotation(page.id, { type: 'redact', x, y, width: w, height: h }, 'Mark for redaction')
    } else if (activeTool === 'stamp') {
      addAnnotation(page.id, {
        type: 'stamp', x, y, width: w, height: h,
        shape: toolOptions.stamp.shape,
        strokeColor: toolOptions.stamp.strokeColor,
        strokeWidth: toolOptions.stamp.strokeWidth,
        fillColor: toolOptions.stamp.fillColor,
        flipped: toolOptions.stamp.flipped,
        opacity: toolOptions.stamp.opacity,
      }, 'Add shape')
    }
  }, [activeTool, addAnnotation, page.id, toolOptions])

  return (
    // Sits above the text layer (z-20) so placement clicks reach it rather than
    // being eaten by a glyph box.
    //
    // The surface only captures pointer events while a placement tool is active.
    // Otherwise it is transparent to them and individual annotations opt back in,
    // so selecting and copying text still works with the select tool — a surface
    // that captured everything would trade one broken interaction for another.
    <div
      ref={surfaceRef}
      className="absolute inset-0 z-20"
      style={{
        cursor: isPlacing ? 'crosshair' : 'default',
        pointerEvents: isPlacing ? 'auto' : 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Each annotation is isolated: one that cannot draw shows a marker in
          its place instead of taking the page — and the open document — down
          with it. It stays in the state and still exports. */}
      {annotations.map(ann => (
        <AnnotationErrorBoundary key={ann.id} type={ann.type}>
          <AnnotationItem
            annotation={ann}
            page={page}
            pageWidth={width}
            pageHeight={height}
            selected={ann.id === selectedAnnotationId}
          />
        </AnnotationErrorBoundary>
      ))}

      {preview && <PlacementPreview preview={preview} tool={activeTool} options={toolOptions} width={width} height={height} />}
    </div>
  )
}

/** Live outline shown while dragging out a new annotation. */
function PlacementPreview({ preview, tool, options, width, height }) {
  if (preview.kind === 'draw') {
    return (
      <svg className="absolute inset-0 pointer-events-none" width={width} height={height}>
        <polyline
          points={preview.points.map(p => `${p.x * width},${p.y * height}`).join(' ')}
          fill="none"
          stroke={options.draw.color}
          strokeWidth={options.draw.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  const x = Math.min(preview.start.x, preview.current.x) * width
  const y = Math.min(preview.start.y, preview.current.y) * height
  const w = Math.abs(preview.current.x - preview.start.x) * width
  const h = Math.abs(preview.current.y - preview.start.y) * height

  const fill = tool === 'redact'
    ? 'rgba(0,0,0,0.75)'
    : tool === 'highlight'
      ? options.highlight.color
      : 'transparent'

  // Dashed, because the rectangle does not exist yet — the moment it does it
  // gets a solid selection ring instead, and the difference is the feedback.
  //
  // accent-soft-border rather than accent for the same reason the selection ring
  // uses it: this line is drawn on white paper in both themes, and the dark
  // theme's accent is only 1.92:1 there. See AnnotationItem.
  return (
    <div
      className="absolute pointer-events-none border border-dashed border-accent-soft-border"
      style={{ left: x, top: y, width: w, height: h, background: fill, opacity: tool === 'highlight' ? options.highlight.opacity : 1 }}
    />
  )
}
