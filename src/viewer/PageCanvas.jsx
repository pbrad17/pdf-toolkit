import { useEffect, useRef, useState } from 'react'
import { getPageProxy } from '../utils/pdfRegistry'
import { cropRectInViewport, viewportRotation } from './geometry'

/**
 * Browsers cap canvas backing stores (Safari is the tightest at roughly 16M
 * device pixels). Past that the canvas silently comes back blank, so render
 * resolution is scaled down to fit rather than trusting the device ratio.
 */
const MAX_CANVAS_PIXELS = 16_000_000

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
      {status !== 'ready' && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-white"
          style={{ width, height }}
        >
          {status === 'error' ? (
            <span className="text-xs text-negative">Could not render this page</span>
          ) : (
            <span className="w-6 h-6 rounded-full border-2 border-steel-blue/30 border-t-steel-blue animate-spin" />
          )}
        </div>
      )}
    </>
  )
}
