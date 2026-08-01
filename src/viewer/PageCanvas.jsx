import { useEffect, useRef, useState } from 'react'
import { getPageProxy } from '../utils/pdfRegistry'
import { Callout } from '../ui/primitives'
import { cropRectInViewport, viewportRotation } from './geometry'

/**
 * Browsers cap canvas backing stores (Safari is the tightest at roughly 16M
 * device pixels). Past that the canvas silently comes back blank, so render
 * resolution is scaled down to fit rather than trusting the device ratio.
 */
const MAX_CANVAS_PIXELS = 16_000_000

/**
 * Ink for the placeholder rules, as a fraction of black.
 *
 * The page is white in both themes because it is the document, not chrome — so
 * anything drawn ON it has to be paper-relative. A theme token would invert
 * with the UI and leave this either invisible (dark theme text colours are
 * near-white) or shouting. index.css has no paper sub-ramp; this is the only
 * value in the viewer that cannot come from the token ramp, and it is kept in
 * one place so a token can replace it in one edit.
 */
const PAPER_INK = 'rgb(18 36 47 / 0.09)'

/**
 * Placeholder rules, as a fraction of the text column width. `null` is a
 * paragraph break. Ragged right edges are what make a stack of bars read as a
 * page of text rather than as a loading graphic.
 */
const SKELETON_ROWS = [
  0.42, null,
  0.96, 0.9, 0.94, 0.88, 0.71, null,
  0.93, 0.97, 0.89, 0.95, 0.86, 0.62, null,
  0.91, 0.96, 0.87, 0.94, 0.48,
]

/**
 * What a page looks like before its canvas exists.
 *
 * A page that has not rendered yet is still a page. Reserving its space with a
 * blank sheet and a spinner reads as a hole in the document; ruled placeholder
 * lines in a text column read as "this page, not yet drawn". Rule thickness and
 * spacing track the rendered page height so the placeholder stays proportional
 * from a 120px thumbnail up to 800% zoom.
 *
 * `active` marks a page that is actually rendering right now, as opposed to one
 * reserved but not yet mounted — the only difference the user needs is whether
 * something is happening.
 */
export function PageSkeleton({ height = 0, active = false }) {
  const rule = Math.max(2, Math.round(height * 0.010))
  const gap = Math.max(3, Math.round(height * 0.017))

  return (
    <div
      className={`absolute inset-0 overflow-hidden ${active ? 'animate-pulse' : ''}`}
      aria-hidden="true"
    >
      <div className="absolute left-[11%] right-[11%] top-[11%] flex flex-col" style={{ gap }}>
        {SKELETON_ROWS.map((w, i) => (
          <span
            key={i}
            className="block shrink-0"
            style={w == null
              ? { height: gap }
              : {
                  width: `${w * 100}%`,
                  height: i === 0 ? Math.round(rule * 1.6) : rule,
                  background: PAPER_INK,
                }}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * One rendered page. Owns its pdf.js render task and cancels it on unmount or
 * when the scale changes, which matters a lot during fast scrolling — without
 * cancellation the worker queues every intermediate zoom level and the UI
 * stalls behind renders whose output is already stale.
 */
export default function PageCanvas({ page, scale, width, height, onRendered }) {
  const canvasRef = useRef(null)
  const taskRef = useRef(null)

  /**
   * What has actually been painted, rather than a separate "pending" flag.
   *
   * Storing the completed signature lets readiness be derived during render
   * (`renderKey === renderedKey`), so changing page or scale marks the canvas
   * stale without an effect having to synchronously reset a status field — and
   * without remounting the canvas, which would flicker on every zoom step.
   */
  const renderKey = `${page.id}:${page.rotation}:${page.crop ? 'c' : 'u'}:${scale.toFixed(4)}`
  const [rendered, setRendered] = useState(null)
  const status = rendered === renderKey ? 'ready' : rendered === `error:${renderKey}` ? 'error' : 'pending'

  useEffect(() => {
    let cancelled = false

    async function render() {
      const canvas = canvasRef.current
      if (!canvas) return

      try {
        const proxy = await getPageProxy(page.sourceId, page.sourceIndex)
        if (cancelled) return

        const rotation = viewportRotation(page)
        const viewport = proxy.getViewport({ scale, rotation })
        const crop = cropRectInViewport(page, viewport)

        // Clamp resolution so huge pages at high zoom stay within canvas limits.
        const dpr = window.devicePixelRatio || 1
        const wanted = crop.width * crop.height * dpr * dpr
        const res = wanted > MAX_CANVAS_PIXELS ? Math.sqrt(MAX_CANVAS_PIXELS / wanted) * dpr : dpr

        canvas.width = Math.max(1, Math.floor(crop.width * res))
        canvas.height = Math.max(1, Math.floor(crop.height * res))
        canvas.style.width = `${Math.round(crop.width)}px`
        canvas.style.height = `${Math.round(crop.height)}px`

        const ctx = canvas.getContext('2d', { alpha: false })
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        // Shift the page so the cropped region lands at the canvas origin.
        const transform = [res, 0, 0, res, -crop.x * res, -crop.y * res]

        const task = proxy.render({ canvasContext: ctx, viewport, transform })
        taskRef.current = task
        await task.promise
        if (cancelled) return

        setRendered(renderKey)
        onRendered?.(page.id)
      } catch (err) {
        // Cancellation is the expected outcome when scrolling or zooming.
        if (cancelled || err?.name === 'RenderingCancelledException') return
        setRendered(`error:${renderKey}`)
      }
    }

    render()

    return () => {
      cancelled = true
      if (taskRef.current) {
        taskRef.current.cancel()
        taskRef.current = null
      }
    }
  }, [page, scale, onRendered, renderKey])

  return (
    <>
      <canvas
        ref={canvasRef}
        className="block"
        style={{ width, height, opacity: status === 'ready' ? 1 : 0 }}
        aria-hidden="true"
      />
      {status === 'pending' && <PageSkeleton height={height} active />}

      {/* A failed render leaves a white sheet, which is indistinguishable from a
          genuinely blank page — so the failure has to say so on the page itself.
          The message carries its own surface rather than sitting directly on
          paper: the semantic text colours are measured against chrome, and the
          dark theme's negative is only 2.51:1 on white. */}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden p-2">
          <div className="w-full max-w-[34ch]">
            <Callout tone="danger">Could not render this page</Callout>
          </div>
        </div>
      )}
    </>
  )
}
