/**
 * Document model for the PDF editor.
 *
 * The central idea of the v2 architecture: there is ONE working document, and
 * every tool mutates its `EditState`. Nothing builds-and-downloads on its own.
 * Export walks the edit state once and produces the final PDF.
 *
 * Two halves, deliberately kept apart:
 *
 *   Sources   — immutable raw bytes of uploaded files, keyed by id. Heavy.
 *               Never cloned, never placed in history.
 *   EditState — plain JSON describing everything the user has changed. Light.
 *               Snapshotted for undo/redo.
 *
 * Because EditState is pure JSON with no references into Sources, undo/redo is
 * a structural clone of a small object rather than a per-operation inverse. That
 * removes a whole class of bugs where an operation forgets to register its own
 * undo handler, which the previous annotation-only command stack was prone to.
 */

let nextId = 1
export const uid = (prefix = 'id') => `${prefix}_${nextId++}`

/** Rotation is always normalized into [0, 90, 180, 270]. */
export const normalizeRotation = (deg) => ((deg % 360) + 360) % 360

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/**
 * A page entry in the working document. `sourceId`/`sourceIndex` point back at
 * the immutable bytes; everything else is user intent layered on top.
 *
 * Note that a page is NOT unique per source page — duplicating a page creates a
 * second entry pointing at the same source page, which is why annotations are
 * keyed by page id rather than source index.
 */
export function createPage(sourceId, sourceIndex, size, intrinsicRotation = 0) {
  return {
    id: uid('pg'),
    sourceId,
    sourceIndex,
    /** User-applied rotation, added to whatever the source page already had. */
    rotation: 0,
    intrinsicRotation,
    /** Intrinsic page size in points, before crop. */
    size: { width: size.width, height: size.height },
    /** Crop insets in points from each edge, or null for uncropped. */
    crop: null,
    /** Pending paper size `{ width, height, mode }`, applied at export. */
    resize: null,
    /** Set when a page is replaced by a flattened raster (redaction, grayscale). */
    raster: null,
  }
}

/** The complete set of user edits. Must stay JSON-serializable. */
export function emptyEditState() {
  return {
    pages: [],
    /** pageId -> Annotation[] */
    annotations: {},
    /** pageId -> TextEdit[] — edits to text that already existed in the PDF. */
    textEdits: {},
    /** pageId -> Redaction[] — true content removal, applied at export. */
    redactions: {},
    /** pageId -> OcrWord[] — recognized words, written as an invisible layer. */
    ocr: {},
    /** Document-wide settings, each null until the user enables that tool. */
    doc: {
      bookmarks: [],
      formValues: {},
      watermark: null,
      headerFooter: null,
      bates: null,
      metadata: null,
      encryption: null,
    },
  }
}

// ---------------------------------------------------------------------------
// Derived geometry
// ---------------------------------------------------------------------------

/**
 * Effective rotation actually applied when rendering or exporting a page.
 * Source pages can carry their own /Rotate, and the user's rotation composes
 * with it rather than replacing it.
 */
export function effectiveRotation(page) {
  return normalizeRotation((page.intrinsicRotation || 0) + (page.rotation || 0))
}

/**
 * Visible size in points after crop and rotation.
 *
 * Crop is expressed in unrotated page space (that is how the user drew it and
 * how the PDF boxes are written), so insets are applied first and the result is
 * swapped only when the effective rotation is a quarter turn.
 */
export function displaySize(page) {
  const crop = page.crop
  let w = page.size.width
  let h = page.size.height
  if (crop) {
    w = Math.max(1, w - (crop.left || 0) - (crop.right || 0))
    h = Math.max(1, h - (crop.top || 0) - (crop.bottom || 0))
  }
  const rot = effectiveRotation(page)
  return rot === 90 || rot === 270 ? { width: h, height: w } : { width: w, height: h }
}

/** Aspect ratio of the page as the user sees it. Used for viewer layout. */
export function displayAspect(page) {
  const { width, height } = displaySize(page)
  return width / height
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 60

/**
 * Snapshot-based undo. Entries hold a label (shown in the UI) plus a deep clone
 * of the edit state as it was BEFORE the change, so undo restores directly.
 *
 * structuredClone is used rather than JSON round-tripping so that typed arrays
 * inside raster entries survive; those are the one non-JSON value we allow.
 */
export function createHistory() {
  return { past: [], future: [] }
}

export function pushHistory(history, label, priorState) {
  const past = [...history.past, { label, state: structuredClone(priorState) }]
  return {
    past: past.slice(-HISTORY_LIMIT),
    future: [], // any new action invalidates the redo branch
  }
}

export function applyUndo(history, currentState) {
  if (history.past.length === 0) return null
  const entry = history.past[history.past.length - 1]
  return {
    state: entry.state,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, { label: entry.label, state: structuredClone(currentState) }],
    },
  }
}

export function applyRedo(history, currentState) {
  if (history.future.length === 0) return null
  const entry = history.future[history.future.length - 1]
  return {
    state: entry.state,
    history: {
      past: [...history.past, { label: entry.label, state: structuredClone(currentState) }],
      future: history.future.slice(0, -1),
    },
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const pageIndexById = (state, pageId) => state.pages.findIndex(p => p.id === pageId)
export const getPage = (state, pageId) => state.pages.find(p => p.id === pageId) || null

export const annotationsFor = (state, pageId) => state.annotations[pageId] || []
export const redactionsFor = (state, pageId) => state.redactions[pageId] || []
export const textEditsFor = (state, pageId) => state.textEdits[pageId] || []
export const ocrFor = (state, pageId) => state.ocr[pageId] || null

/** True when the document has any change worth warning about on unload. */
export function hasEdits(state, originalPageIds) {
  if (state.pages.length !== originalPageIds.length) return true
  if (state.pages.some((p, i) => p.id !== originalPageIds[i])) return true
  // resize belongs here even though nothing on screen shows it: the viewer draws
  // every page at its original size and the new box is only written at export,
  // so a pending resize is the one page edit the user cannot see they have made.
  if (state.pages.some(p => p.rotation !== 0 || p.crop || p.resize || p.raster)) return true
  const nonEmpty = (map) => Object.values(map).some(v => v && v.length > 0)
  if (nonEmpty(state.annotations) || nonEmpty(state.textEdits) || nonEmpty(state.redactions)) return true
  const d = state.doc
  if (d.bookmarks.length > 0) return true
  if (Object.keys(d.formValues).length > 0) return true
  return Boolean(d.watermark || d.headerFooter || d.bates || d.metadata || d.encryption)
}
