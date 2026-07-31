import { useCallback, useMemo, useState } from 'react'
import { useEditor } from '../../state/useEditor'
import { displaySize, effectiveRotation } from '../../state/documentModel'

const buttonClass ='w-full px-2 py-1.5 rounded-lg border border-border text-xs hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border'

/**
 * Crop insets are stored in UNROTATED page space — the space the PDF boxes are
 * written in — so "top" is the top of the page as the file describes it, not
 * necessarily the top of the screen. The viewer pushes the rect through pdf.js's
 * viewport transform (cropRectInViewport) to put it back on the right edge.
 */
const EDGES = [
  { key: 'top', label: 'Top', axis: 'height', opposite: 'bottom' },
  { key: 'bottom', label: 'Bottom', axis: 'height', opposite: 'top' },
  { key: 'left', label: 'Left', axis: 'width', opposite: 'right' },
  { key: 'right', label: 'Right', axis: 'width', opposite: 'left' },
]

const ZERO = { top: 0, right: 0, bottom: 0, left: 0 }

/** Points that must survive on each axis, so a page can never be cropped away. */
const MIN_KEEP = 18

/** Longest edge, in pixels, used when measuring a page for its content bounds. */
const MEASURE_MAX_EDGE = 900

/** Channel value at or above which a pixel counts as page white, not content. */
const WHITE_LEVEL = 247

/** Breathing room left around detected content, in points. */
const MARGIN_PADDING = 4

const normalizeCrop = (crop) => ({
  top: crop?.top || 0,
  right: crop?.right || 0,
  bottom: crop?.bottom || 0,
  left: crop?.left || 0,
})

const isZero = (crop) => EDGES.every(e => (crop[e.key] || 0) <= 0)
const sameCrop = (a, b) => EDGES.every(e => Math.abs(a[e.key] - b[e.key]) < 0.01)

/** An all-zero crop is stored as null, so an untouched page stays untouched. */
const toStored = (crop) => (isZero(crop) ? null : { ...crop })

const formatPt = (value) => String(Math.round(value * 10) / 10)
const formatIn = (value) => (value / 72).toFixed(2)

/**
 * Measure where the ink actually is on a page, as insets in points.
 *
 * Rendered at rotation 0 deliberately: that puts the canvas in unrotated page
 * space, which is the space crop insets are stored in, so the result maps
 * straight across with no rotation maths to get backwards.
 *
 * @returns insets, or null for a page with nothing on it
 */
async function measureContentInsets(page, canvas, getPageProxy) {
  const proxy = await getPageProxy(page.sourceId, page.sourceIndex)
  const base = proxy.getViewport({ scale: 1, rotation: 0 })
  const scale = Math.min(1, MEASURE_MAX_EDGE / Math.max(base.width, base.height))
  const viewport = proxy.getViewport({ scale, rotation: 0 })

  const width = Math.max(1, Math.floor(viewport.width))
  const height = Math.max(1, Math.floor(viewport.height))
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  await proxy.render({ canvasContext: ctx, viewport }).promise

  const { data } = ctx.getImageData(0, 0, width, height)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i] >= WHITE_LEVEL && data[i + 1] >= WHITE_LEVEL && data[i + 2] >= WHITE_LEVEL) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0) return null

  const toPoints = 1 / scale
  return {
    left: minX * toPoints,
    top: minY * toPoints,
    right: (width - 1 - maxX) * toPoints,
    bottom: (height - 1 - maxY) * toPoints,
  }
}

/**
 * Crop panel.
 *
 * Everything here goes through the editor store: the sliders write the crop into
 * EditState, the viewer already draws from EditState, so the preview is the real
 * document rather than a second rendering of it that can disagree. The old crop
 * tool rendered its own preview canvas at an assumed 612pt page width, which was
 * wrong for every page that was not US Letter.
 */
export default function CropPanel() {
  const {
    state, targetPageIds, selectedPageIds, cropPages, commitLive,
    beginInteraction, endInteraction, setBusy, setError, getPageProxy,
  } = useEditor()

  /** The crop being edited. Non-null only mid-gesture, so it can never go stale. */
  const [pending, setPending] = useState(null)
  /** Raw text of the focused number field, so a half-typed value survives. */
  const [typing, setTyping] = useState(null)
  const [linked, setLinked] = useState(false)
  const [measuring, setMeasuring] = useState(false)

  const idSet = useMemo(() => new Set(targetPageIds), [targetPageIds])
  const pages = useMemo(() => state.pages.filter(p => idSet.has(p.id)), [state.pages, idSet])

  const reference = pages[0] || null
  const stored = useMemo(() => normalizeCrop(reference?.crop), [reference])
  const crop = pending ?? stored

  const mixed = pages.some(p => !sameCrop(normalizeCrop(p.crop), stored))
  const varyingSizes = pages.some(p => (
    p.size.width !== reference?.size.width || p.size.height !== reference?.size.height
  ))

  // Bounds come from the smallest page being written, so one crop is legal for
  // all of them rather than legal for the first and destructive for the rest.
  const boundsOf = useCallback((list) => ({
    width: list.length ? Math.min(...list.map(p => p.size.width)) : 612,
    height: list.length ? Math.min(...list.map(p => p.size.height)) : 792,
  }), [])

  const bounds = useMemo(() => boundsOf(pages), [boundsOf, pages])

  const maxFor = useCallback((edge, value) => (
    Math.max(0, bounds[edge.axis] - MIN_KEEP - (value[edge.opposite] || 0))
  ), [bounds])

  /**
   * Clamp every edge so at least MIN_KEEP points survive on each axis.
   *
   * `priority` is the edge the user just moved, and it is clamped first. Without
   * that, a value typed past the limit on one edge was absorbed by silently
   * shrinking the *opposite* edge — dragging Bottom moved Top, which the user
   * never asked for. The edge being edited is the one that should give way.
   */
  const clampEdges = useCallback((next, limits, priority = null) => {
    const out = { ...next }
    const order = priority
      ? [priority, ...EDGES.filter(e => e.key !== priority.key)]
      : EDGES
    for (const edge of order) {
      const limit = Math.max(0, limits[edge.axis] - MIN_KEEP - (out[edge.opposite] || 0))
      out[edge.key] = Math.max(0, Math.min(out[edge.key] || 0, limit))
    }
    return out
  }, [])

  /**
   * Linked edges have to stay equal, so the cap is half the shorter axis rather
   * than the per-edge limit. Clamping them one at a time converges on four
   * different numbers, which is precisely what linking is meant to prevent.
   */
  const linkedCrop = useCallback((value) => {
    const room = Math.max(0, Math.min(bounds.width, bounds.height) - MIN_KEEP) / 2
    const v = Math.max(0, Math.min(value, room))
    return { top: v, right: v, bottom: v, left: v }
  }, [bounds])

  /**
   * Mid-gesture update. Only the pages in scope get a new object identity, so
   * the pages that are not being cropped keep theirs and their canvases are not
   * re-rendered on every pixel of the drag.
   */
  const applyLive = useCallback((next) => {
    commitLive(prev => ({
      ...prev,
      pages: prev.pages.map(p => (idSet.has(p.id) ? { ...p, crop: toStored(next) } : p)),
    }))
  }, [commitLive, idSet])

  const setEdge = useCallback((edge, raw) => {
    const value = Number.isFinite(raw) ? Math.max(0, raw) : 0
    const next = linked
      ? linkedCrop(value)
      : clampEdges({ ...crop, [edge.key]: value }, bounds, edge)

    // Idempotent, so a keyboard adjustment on a focused slider opens a gesture
    // just as a pointer drag does. Without it, arrow keys would never reach
    // history and could not be undone.
    beginInteraction()
    setPending(next)
    applyLive(next)
  }, [applyLive, beginInteraction, bounds, clampEdges, crop, linked, linkedCrop])

  /** Close the gesture: one history entry for the whole drag or edit. */
  const finish = useCallback(() => {
    setPending(null)
    setTyping(null)
    endInteraction(targetPageIds.length === 1 ? 'Crop page' : 'Crop pages')
  }, [endInteraction, targetPageIds.length])

  /**
   * Write the crop. Limits are recomputed from the pages actually being written,
   * not from the current scope — "Apply to all" reaches pages smaller than the
   * selected one, and the selection's bounds say nothing about those.
   */
  const applyCrop = useCallback((next, ids = targetPageIds) => {
    setPending(null)
    setTyping(null)
    const written = new Set(ids)
    const limits = boundsOf(state.pages.filter(p => written.has(p.id)))
    cropPages(ids, toStored(clampEdges(next, limits)))
  }, [boundsOf, clampEdges, cropPages, state.pages, targetPageIds])

  const squareCrop = useCallback(() => {
    if (!reference) return
    const { width, height } = reference.size
    const side = Math.min(width, height)
    applyCrop({
      left: (width - side) / 2,
      right: (width - side) / 2,
      top: (height - side) / 2,
      bottom: (height - side) / 2,
    })
  }, [applyCrop, reference])

  /**
   * Trim the white margin off every page in scope.
   *
   * The insets are the union of what each page needs — the smallest trim that
   * keeps every page's content intact — because one crop is applied to all of
   * them. Trimming each page to its own bounds would leave a document whose
   * pages are all slightly different sizes.
   */
  const removeMargins = useCallback(async () => {
    if (pages.length === 0 || measuring) return
    setMeasuring(true)
    setError(null)
    setPending(null)

    const canvas = document.createElement('canvas')
    let union = null
    let failed = 0
    let problem = null

    try {
      for (let i = 0; i < pages.length; i++) {
        setBusy({ label: `Measuring page ${i + 1} of ${pages.length}`, progress: i / pages.length })
        try {
          const insets = await measureContentInsets(pages[i], canvas, getPageProxy)
          if (!insets) continue
          union = union
            ? {
                top: Math.min(union.top, insets.top),
                right: Math.min(union.right, insets.right),
                bottom: Math.min(union.bottom, insets.bottom),
                left: Math.min(union.left, insets.left),
              }
            : insets
        } catch (err) {
          failed++
          problem = err?.message || String(err)
        }
      }
    } finally {
      setBusy(null)
      setMeasuring(false)
    }

    if (union) {
      applyCrop({
        top: Math.max(0, union.top - MARGIN_PADDING),
        right: Math.max(0, union.right - MARGIN_PADDING),
        bottom: Math.max(0, union.bottom - MARGIN_PADDING),
        left: Math.max(0, union.left - MARGIN_PADDING),
      })
    }

    if (failed > 0) {
      setError(union
        ? `Margins were measured from ${pages.length - failed} of ${pages.length} pages; ${failed} could not be rendered (${problem}).`
        : `Could not measure the margins: ${problem}`)
    } else if (!union) {
      setError('Nothing to trim — no content was found on the pages in scope.')
    }
  }, [applyCrop, getPageProxy, measuring, pages, setBusy, setError])

  // Measured on the reference page and through displaySize, so a rotated page
  // reports the size the reader will see rather than the pre-rotation box.
  const visible = reference
    ? displaySize({ ...reference, crop: toStored(crop) })
    : { width: bounds.width, height: bounds.height }
  const referenceNumber = reference ? state.pages.indexOf(reference) + 1 : 0

  const scope = selectedPageIds.size > 0
    ? `${pages.length} selected page${pages.length === 1 ? '' : 's'}`
    : `all ${pages.length} page${pages.length === 1 ? '' : 's'}`

  // Insets are unrotated page space, so on a turned page "Top" is not the top of
  // the screen. Saying so is cheaper than leaving the user to discover it by
  // dragging Top and watching the width change.
  const rotated = reference ? effectiveRotation(reference) !== 0 : false

  return (
    <div className="w-64 bg-dark-bg border-l border-border flex flex-col shrink-0 overflow-auto">
      <div className="p-3 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Crop</h3>

        <p className="text-[11px] text-text-primary/60 leading-snug">
          Trims the page edges. Nothing is deleted — the content outside the crop
          is hidden, and removing the crop brings it back.
        </p>

        <div className="rounded-lg bg-alt-bg border border-border p-2">
          <p className="text-[11px] text-text-primary/50 uppercase tracking-wide mb-1">Applies to</p>
          <p className="text-xs">{scope}</p>
          {varyingSizes && (
            <p className="text-[11px] text-text-primary/50 leading-snug mt-1">
              These pages are not all the same size. Limits are measured against
              the smallest one.
            </p>
          )}
          {mixed && (
            <p className="text-[11px] text-text-primary/50 leading-snug mt-1">
              They are cropped differently right now. Changing any edge sets all
              of them to the values below.
            </p>
          )}
          {rotated && (
            <p className="text-[11px] text-text-primary/50 leading-snug mt-1">
              Page {referenceNumber} is rotated. The edges below are the page&apos;s
              own edges, so they will not line up with the screen.
            </p>
          )}
        </div>

        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />
          Link all edges
        </label>

        {EDGES.map(edge => {
          const max = maxFor(edge, crop)
          const value = Math.min(crop[edge.key], max)
          const id = `crop-${edge.key}`
          return (
            <div key={edge.key}>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor={id} className="text-[11px] uppercase tracking-wide text-text-primary/50">
                  {edge.label}
                </label>
                <div className="flex items-center gap-1">
                  <input
                    id={id}
                    type="number"
                    min={0}
                    max={Math.round(max)}
                    step={1}
                    value={typing?.edge === edge.key ? typing.text : formatPt(value)}
                    onFocus={() => setTyping({ edge: edge.key, text: formatPt(value) })}
                    onChange={(e) => {
                      setTyping({ edge: edge.key, text: e.target.value })
                      const parsed = Number(e.target.value)
                      if (e.target.value !== '' && Number.isFinite(parsed)) setEdge(edge, parsed)
                    }}
                    onBlur={finish}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    className="w-16 px-1.5 py-1 rounded-md bg-alt-bg border border-border text-xs text-right tabular-nums focus:outline-none focus:border-accent"
                  />
                  <span className="text-[11px] text-text-primary/50">pt</span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.round(max))}
                step={1}
                value={value}
                aria-label={`${edge.label} crop in points`}
                onChange={(e) => setEdge(edge, Number(e.target.value))}
                onPointerUp={finish}
                onKeyUp={finish}
                onBlur={finish}
                className="w-full cursor-pointer"
              />
            </div>
          )
        })}

        {reference && (
          <div className="rounded-lg bg-alt-bg border border-border p-2">
            <p className="text-[11px] text-text-primary/50 uppercase tracking-wide mb-1">
              Result — page {referenceNumber}
            </p>
            <p className="text-xs tabular-nums">
              {formatPt(visible.width)} × {formatPt(visible.height)} pt
            </p>
            <p className="text-[11px] text-text-primary/50 tabular-nums">
              {formatIn(visible.width)} × {formatIn(visible.height)} in
            </p>
          </div>
        )}

        <div className="space-y-2">
          <h4 className="text-[11px] uppercase tracking-wide text-text-primary/50">Presets</h4>
          <button
            type="button"
            onClick={removeMargins}
            disabled={measuring || pages.length === 0}
            className={buttonClass}
          >
            {measuring ? 'Measuring…' : 'Remove margins'}
          </button>
          <button type="button" onClick={squareCrop} disabled={!reference} className={buttonClass}>
            Square
          </button>
          <button
            type="button"
            onClick={() => applyCrop(crop, state.pages.map(p => p.id))}
            disabled={selectedPageIds.size === 0 || isZero(crop)}
            className={buttonClass}
          >
            Apply to all {state.pages.length} page{state.pages.length === 1 ? '' : 's'}
          </button>
          <p className="text-[11px] text-text-primary/50 leading-snug">
            Remove margins measures where the ink is on each page and trims to the
            widest content across them, so nothing is cut off.
          </p>
        </div>

        <div className="pt-4 border-t border-border">
          <button
            type="button"
            onClick={() => applyCrop(ZERO)}
            disabled={pages.length === 0 || (isZero(crop) && !mixed)}
            className="w-full px-2 py-1.5 rounded-lg border border-border text-xs text-negative hover:border-negative disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border"
          >
            Remove crop
          </button>
        </div>
      </div>
    </div>
  )
}
