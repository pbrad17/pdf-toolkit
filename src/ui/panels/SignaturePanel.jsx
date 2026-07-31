import { useCallback, useRef, useState } from 'react'
import { useEditor } from '../../state/useEditor'

/**
 * Backing-store size of the signing surface. Fixed rather than tied to the
 * rail's width so a saved signature does not come out at a different resolution
 * depending on how wide the window happened to be.
 */
const CANVAS_W = 720
const CANVAS_H = 260

/** Padding kept around the trimmed strokes, in backing-store pixels. */
const TRIM_PAD = 8

const PEN_COLORS = ['#101D27', '#1B3A6B', '#7A1414']

const Field = ({ label, children }) => (
  <div>
    <span className="block text-[11px] uppercase tracking-wide text-text-primary/50 mb-1.5">{label}</span>
    {children}
  </div>
)

function drawStroke(ctx, stroke) {
  const { points, color, width } = stroke
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // A tap with no movement is a dot, and a zero-length path strokes to nothing.
  if (points.length === 1) {
    ctx.beginPath()
    ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }

  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  ctx.stroke()
}

/**
 * Trim to the drawn strokes and return a transparent PNG plus its aspect ratio.
 *
 * The bounding box is taken from the alpha channel rather than by looking for
 * pixels that are not white. The old signature pad drew on white and then made
 * near-white pixels transparent, which ate the light end of any pen colour and
 * left a grey halo where antialiasing had blended the stroke into the
 * background. Drawing on a transparent surface means the alpha channel already
 * is the mask, exactly, for any colour.
 */
function trimToContent(canvas) {
  const ctx = canvas.getContext('2d')
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < minX || maxY < minY) return null

  minX = Math.max(0, minX - TRIM_PAD)
  minY = Math.max(0, minY - TRIM_PAD)
  maxX = Math.min(width - 1, maxX + TRIM_PAD)
  maxY = Math.min(height - 1, maxY + TRIM_PAD)

  const trimW = maxX - minX + 1
  const trimH = maxY - minY + 1

  const out = document.createElement('canvas')
  out.width = trimW
  out.height = trimH
  out.getContext('2d').drawImage(canvas, minX, minY, trimW, trimH, 0, 0, trimW, trimH)

  return { dataUrl: out.toDataURL('image/png'), aspect: trimW / trimH }
}

/**
 * Create and manage signatures.
 *
 * This panel only makes them. Placing one on a page is the viewer's job — the
 * active signature is published through setToolOption('signature', …) and the
 * placement layer reads it from there, so there is exactly one path from "this
 * is my signature" to "it is on the page".
 *
 * Signatures live in view state, not in the document, and are never uploaded.
 * They survive tool switches and stay available across documents in this
 * session, and go away when the tab does.
 */
export default function SignaturePanel() {
  const {
    signatures, addSignature, removeSignature, toolOptions, setToolOption, setError,
  } = useEditor()

  const canvasRef = useRef(null)
  const strokesRef = useRef([])
  const activeRef = useRef(null)

  const [penColor, setPenColor] = useState(PEN_COLORS[0])
  const [penWidth, setPenWidth] = useState(3)
  const [strokeCount, setStrokeCount] = useState(0)

  const activeDataUrl = toolOptions.signature?.dataUrl ?? null

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke)
  }, [])

  /** Pointer position in backing-store pixels. */
  const positionOf = (event) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  const onPointerDown = (event) => {
    const canvas = canvasRef.current
    if (!canvas) return
    event.preventDefault()
    // Capture keeps the stroke alive when the pointer leaves the canvas, which
    // it will on any signature that runs to the edge. It throws NotFoundError if
    // the pointer is no longer active by the time the handler runs — rare, but
    // an uncaught throw here would abandon the stroke before it started, and
    // drawing without capture is a worse outcome than not drawing at all.
    try {
      canvas.setPointerCapture(event.pointerId)
    } catch {
      // Carry on uncaptured.
    }

    const rect = canvas.getBoundingClientRect()
    const stroke = {
      color: penColor,
      // The chosen width is in on-screen pixels; the surface is drawn larger, so
      // scale it or a "thick" pen looks hairline at the saved resolution.
      width: penWidth * (canvas.width / rect.width),
      points: [positionOf(event)],
    }
    activeRef.current = stroke
    strokesRef.current.push(stroke)
    drawStroke(canvas.getContext('2d'), stroke)
  }

  const onPointerMove = (event) => {
    const stroke = activeRef.current
    if (!stroke) return
    event.preventDefault()
    stroke.points.push(positionOf(event))
    // Redrawing the whole path each move keeps joins smooth without holding a
    // partial path open across events; a signature is a few hundred points, so
    // the cost is not worth optimising away.
    redraw()
  }

  const endStroke = (event) => {
    if (!activeRef.current) return
    activeRef.current = null
    try {
      canvasRef.current?.releasePointerCapture(event.pointerId)
    } catch {
      // Already released, or was never captured.
    }
    setStrokeCount(strokesRef.current.length)
  }

  const undoStroke = useCallback(() => {
    strokesRef.current.pop()
    redraw()
    setStrokeCount(strokesRef.current.length)
  }, [redraw])

  const clear = useCallback(() => {
    strokesRef.current = []
    redraw()
    setStrokeCount(0)
  }, [redraw])

  const save = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const trimmed = trimToContent(canvas)
    if (!trimmed) {
      setError('There is nothing drawn to save yet.')
      return
    }
    const saved = addSignature(trimmed.dataUrl, trimmed.aspect)
    // Selecting it immediately is the point of having drawn it.
    setToolOption('signature', { dataUrl: saved.dataUrl, aspect: saved.aspect })
    clear()
  }, [addSignature, setToolOption, setError, clear])

  const select = useCallback((sig) => {
    setToolOption('signature', { dataUrl: sig.dataUrl, aspect: sig.aspect })
  }, [setToolOption])

  const discard = useCallback((sig) => {
    removeSignature(sig.id)
    // Leaving a deleted signature as the active one would let it keep being
    // placed from a list it is no longer in.
    if (toolOptions.signature?.dataUrl === sig.dataUrl) {
      setToolOption('signature', { dataUrl: null })
    }
  }, [removeSignature, setToolOption, toolOptions.signature])

  return (
    <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
      <div className="p-3 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Signature</h3>

        <Field label="Pen">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              {PEN_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setPenColor(c)}
                  style={{ background: c }}
                  aria-label={`Pen colour ${c}`}
                  aria-pressed={penColor === c}
                  className={`w-6 h-6 rounded-md border transition-transform ${
                    penColor === c ? 'border-accent scale-110' : 'border-border'
                  }`}
                />
              ))}
            </div>
            <input
              type="color"
              value={penColor}
              onChange={(e) => setPenColor(e.target.value)}
              aria-label="Custom pen colour"
              className="flex-1 h-6 rounded-md bg-alt-bg border border-border cursor-pointer"
            />
          </div>
        </Field>

        <Field label={`Thickness — ${penWidth}px`}>
          <input
            type="range"
            min="1"
            max="8"
            value={penWidth}
            onChange={(e) => setPenWidth(Number(e.target.value))}
            // Field wraps a control group in the pen row above, so it renders a
            // span rather than a label and cannot name its children.
            aria-label="Pen thickness"
            className="w-full"
          />
        </Field>

        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          role="img"
          aria-label="Signing area. Draw your signature with a mouse, finger or pen."
          className="w-full rounded-lg border border-border bg-white cursor-crosshair touch-none"
        />

        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={undoStroke}
            disabled={strokeCount === 0}
            className="flex-1 px-2 py-1.5 rounded-lg border border-border text-xs hover:border-accent disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={strokeCount === 0}
            className="flex-1 px-2 py-1.5 rounded-lg border border-border text-xs hover:border-accent disabled:opacity-40"
          >
            Clear
          </button>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={strokeCount === 0}
          className="w-full px-3 py-2 rounded-lg bg-accent-strong text-on-accent text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save signature
        </button>

        <p className="text-[11px] text-text-primary/50 leading-snug">
          Saved with a transparent background and trimmed to the ink, so it sits
          on the page without a white box around it.
        </p>

        <div className="pt-4 border-t border-border space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-accent">
            Saved {signatures.length > 0 && `(${signatures.length})`}
          </h4>

          {signatures.length === 0 ? (
            <p className="text-[11px] text-text-primary/50 leading-snug">
              Nothing saved yet. Draw above and save it to place it on pages.
            </p>
          ) : (
            <div className="space-y-2">
              {signatures.map((sig, i) => (
                <div key={sig.id} className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => select(sig)}
                    aria-label={`Use signature ${i + 1}`}
                    aria-pressed={activeDataUrl === sig.dataUrl}
                    className={`flex-1 min-w-0 p-2 rounded-lg border bg-white ${
                      activeDataUrl === sig.dataUrl ? 'border-accent' : 'border-border hover:border-accent/50'
                    }`}
                  >
                    <img src={sig.dataUrl} alt="" className="max-h-10 mx-auto object-contain" />
                  </button>
                  <button
                    type="button"
                    onClick={() => discard(sig)}
                    aria-label={`Delete signature ${i + 1}`}
                    className="p-1.5 rounded-md border border-border text-negative hover:border-negative shrink-0"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         strokeWidth="2.5" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] text-text-primary/50 leading-snug">
            {activeDataUrl
              ? 'Click a page to place the selected signature. Drag its corner to resize.'
              : 'Select a signature, then click a page to place it.'}
          </p>
        </div>

        <p className="text-[11px] text-text-primary/40 leading-snug border-t border-border pt-3">
          Signatures stay in this tab and are never uploaded. Closing the tab
          discards them.
        </p>
      </div>
    </div>
  )
}
