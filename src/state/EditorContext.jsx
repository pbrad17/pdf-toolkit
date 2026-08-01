import {
  useReducer, useState, useCallback, useEffect, useRef, useMemo,
} from 'react'
import {
  emptyEditState, createPage, createHistory, pushHistory, applyUndo, applyRedo,
  hasEdits, uid, normalizeRotation,
} from './documentModel'
import { EditorContext } from './editorContextObject'
import { registerSource, getPageProxy, releaseAll, probeSource } from '../utils/pdfRegistry'
import { createAutosaver, newSessionId, prepareRestore } from './persistence'

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * State and history advance together in one reducer so they can never disagree.
 *
 * This is the single choke point for document mutation. Tools do not hold their
 * own state and do not build their own PDFs — they describe a change, it lands
 * here, and undo works for free. The previous architecture registered undo
 * handlers per operation, which meant every tool added after the annotation
 * editor silently had no undo at all.
 */
function editorReducer(store, action) {
  switch (action.type) {
    case 'commit': {
      const draft = structuredClone(store.state)
      const next = action.mutator(draft) ?? draft
      return {
        state: next,
        history: pushHistory(store.history, action.label, store.state),
        // The page order as first opened, captured here rather than from an
        // effect so the dirty check has a baseline the moment pages exist.
        baseline: store.baseline ?? (next.pages.length > 0 ? next.pages.map(p => p.id) : null),
      }
    }

    // Mid-gesture updates (dragging, resizing, slider scrubbing). No history
    // entry and no deep clone — the surrounding interaction records one entry
    // for the whole gesture via 'commitSnapshot'.
    case 'live': {
      return { ...store, state: action.mutator(store.state) }
    }

    // Closes a gesture: writes the pre-gesture snapshot captured at its start.
    // Each case spreads `store` so the open-time baseline survives; dropping it
    // would make the document read as pristine after the first undo.
    case 'commitSnapshot': {
      return {
        ...store,
        history: pushHistory(store.history, action.label, action.snapshot),
      }
    }

    case 'undo': {
      const result = applyUndo(store.history, store.state)
      return result ? { ...store, state: result.state, history: result.history } : store
    }

    case 'redo': {
      const result = applyRedo(store.history, store.state)
      return result ? { ...store, state: result.state, history: result.history } : store
    }

    case 'load': {
      return {
        state: action.state,
        history: createHistory(),
        baseline: action.state.pages.map(p => p.id),
      }
    }

    case 'reset': {
      return { state: emptyEditState(), history: createHistory(), baseline: null }
    }

    default:
      return store
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function EditorProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('pdftoolkit-theme') || 'light')
  const [store, dispatch] = useReducer(editorReducer, undefined, () => ({
    state: emptyEditState(),
    history: createHistory(),
    baseline: null,
  }))
  const { state, history, baseline } = store

  /** Immutable uploaded files: [{ id, name, byteLength, pageCount, bytes }]. */
  const [sources, setSources] = useState([])

  const [activeTool, setActiveTool] = useState('select')
  /** { label, progress: 0..1 | null } while a long operation runs. */
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  /**
   * Current settings for each placement tool. Kept in view state rather than in
   * the edit state: these describe what the NEXT annotation will look like, not
   * anything about the document, so they must not appear in undo history.
   */
  const [toolOptions, setToolOptions] = useState(() => ({
    text: { fontSize: 14, fontFamily: 'Helvetica', color: '#000000' },
    draw: { color: '#D0021B', strokeWidth: 2, opacity: 1 },
    highlight: { color: '#FFEB3B', opacity: 0.4 },
    stamp: { shape: 'rectangle', strokeColor: '#D0021B', strokeWidth: 2, fillColor: '', flipped: false, opacity: 1 },
    note: { color: '#FFF176' },
    signature: { dataUrl: null, width: 0.2, aspect: 3 },
    image: { dataUrl: null, width: 0.25, aspect: 1 },
  }))

  /** Patch one tool's options without disturbing the others. */
  const setToolOption = useCallback((tool, patch) => {
    setToolOptions(prev => ({ ...prev, [tool]: { ...prev[tool], ...patch } }))
  }, [])

  /** Saved signatures, reusable across pages and documents in this session. */
  const [signatures, setSignatures] = useState([])

  const addSignature = useCallback((dataUrl, aspect) => {
    const sig = { id: uid('sig'), dataUrl, aspect }
    setSignatures(prev => [...prev, sig])
    return sig
  }, [])

  const removeSignature = useCallback((id) => {
    setSignatures(prev => prev.filter(s => s.id !== id))
  }, [])

  // View state
  const [zoomMode, setZoomMode] = useState('fit-width') // 'fit-width' | 'fit-page' | 'custom'
  const [zoom, setZoomRaw] = useState(1)
  const [currentPageId, setCurrentPageId] = useState(null)

  // Selection
  const [selectedPageIds, setSelectedPageIds] = useState(() => new Set())
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null)

  /** Pre-gesture snapshot, held between beginInteraction and endInteraction. */
  const gestureRef = useRef(null)

  /**
   * Autosave driver, created once per session.
   *
   * Built in a lazy state initialiser rather than assigned to a ref during
   * render: a ref write during render is not safe under concurrent rendering,
   * and this must be constructed exactly once — a second driver would mean two
   * timers racing to write the same session row.
   *
   * setSaveStatus is a stable setter, so capturing it here is fine.
   */
  const [saveStatus, setSaveStatus] = useState(null)
  const [autosaver] = useState(() => createAutosaver({
    sessionId: newSessionId(),
    onStatus: setSaveStatus,
  }))

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('pdftoolkit-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => setTheme(t => (t === 'dark' ? 'light' : 'dark')), [])

  // -------------------------------------------------------------------------
  // Mutation API
  // -------------------------------------------------------------------------

  /** Apply a labelled, undoable change. The mutator receives a mutable draft. */
  const commit = useCallback((label, mutator) => {
    dispatch({ type: 'commit', label, mutator })
  }, [])

  /**
   * Apply a change without touching history. Only valid between
   * beginInteraction/endInteraction, which bracket it with one history entry.
   * The mutator must return a NEW state object rather than mutating in place.
   */
  const commitLive = useCallback((mutator) => {
    dispatch({ type: 'live', mutator })
  }, [])

  const beginInteraction = useCallback(() => {
    // Only the outermost begin wins, so nested gestures collapse into one entry.
    if (!gestureRef.current) gestureRef.current = structuredClone(store.state)
  }, [store.state])

  const endInteraction = useCallback((label) => {
    const snapshot = gestureRef.current
    gestureRef.current = null
    if (snapshot) dispatch({ type: 'commitSnapshot', label, snapshot })
  }, [])

  const cancelInteraction = useCallback(() => { gestureRef.current = null }, [])

  const undo = useCallback(() => {
    setSelectedAnnotationId(null)
    dispatch({ type: 'undo' })
  }, [])

  const redo = useCallback(() => {
    setSelectedAnnotationId(null)
    dispatch({ type: 'redo' })
  }, [])

  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0
  const undoLabel = canUndo ? history.past[history.past.length - 1].label : null
  const redoLabel = canRedo ? history.future[history.future.length - 1].label : null

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * Read files into the working document. Encrypted files surface a
   * 'password' outcome so the caller can prompt and retry, rather than
   * failing silently the way the old upload path did.
   */
  const addFiles = useCallback(async (files, { password } = {}) => {
    setError(null)
    const results = []
    for (const file of files) {
      setBusy({ label: `Opening ${file.name}`, progress: null })
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())

        if (!password) {
          const probe = await probeSource(bytes)
          if (probe === 'password') {
            results.push({ file, status: 'password' })
            continue
          }
          if (probe === 'corrupt') {
            results.push({ file, status: 'corrupt' })
            continue
          }
        }

        const sourceId = uid('src')
        const doc = await registerSource(sourceId, bytes, { password })
        const pageCount = doc.numPages

        const newPages = []
        for (let i = 0; i < pageCount; i++) {
          setBusy({ label: `Reading ${file.name}`, progress: (i + 1) / pageCount })
          const page = await doc.getPage(i + 1)
          // getViewport at scale 1 with rotation 0 reports the unrotated media
          // box; intrinsic /Rotate is tracked separately so user rotation can
          // compose with it instead of overwriting it.
          const vp = page.getViewport({ scale: 1, rotation: 0 })
          newPages.push(createPage(sourceId, i, { width: vp.width, height: vp.height }, page.rotate || 0))
        }

        setSources(prev => [...prev, {
          id: sourceId, name: file.name, byteLength: bytes.byteLength, pageCount, bytes,
        }])
        commit(`Open ${file.name}`, draft => { draft.pages.push(...newPages) })
        results.push({ file, status: 'ok', pageCount })
      } catch (err) {
        results.push({ file, status: 'error', message: err?.message || String(err) })
      }
    }
    setBusy(null)

    const failed = results.filter(r => r.status === 'error' || r.status === 'corrupt')
    if (failed.length > 0) {
      setError(`Could not open ${failed.map(f => f.file.name).join(', ')}. The file may be damaged or not a PDF.`)
    }
    return results
  }, [commit])

  const closeDocument = useCallback(async () => {
    await releaseAll()
    setSources([])
    setSelectedPageIds(new Set())
    setSelectedAnnotationId(null)
    setCurrentPageId(null)
    setActiveTool('view')
    setError(null)
    dispatch({ type: 'reset' })
  }, [])

  const isDirty = useMemo(
    () => state.pages.length > 0 && baseline != null && hasEdits(state, baseline),
    [state, baseline],
  )

  /**
   * Queue an autosave whenever the document changes.
   *
   * Source bytes are handed over on every call, but persistence writes them
   * only once per session — they are immutable, and rewriting tens of megabytes
   * on each keystroke would be the entire cost of this feature for no benefit.
   */
  useEffect(() => {
    if (state.pages.length === 0) return
    autosaver.schedule({ sources, state })
  }, [state, sources, autosaver])

  /**
   * Restore a session the user explicitly chose to bring back.
   *
   * prepareRestore re-registers each source with the pdf.js registry and bumps
   * the id counter past everything in the restored state, so newly created
   * pages and annotations cannot collide with restored ones.
   */
  const restoreSession = useCallback(async (record) => {
    const { sources: restored, failures, state: restoredState } = await prepareRestore(record)
    setSources(restored)
    dispatch({ type: 'load', state: restoredState })
    if (failures.length > 0) {
      setError(
        `Restored the session, but ${failures.length} file(s) could not be read and were left out: ` +
        failures.map(f => f.name).join(', '),
      )
    }
    return { failures }
  }, [])

  // -------------------------------------------------------------------------
  // Page operations
  // -------------------------------------------------------------------------

  const rotatePages = useCallback((pageIds, delta) => {
    const ids = new Set(pageIds)
    const label = ids.size === 1 ? 'Rotate page' : `Rotate ${ids.size} pages`
    commit(label, draft => {
      draft.pages.forEach(p => {
        if (ids.has(p.id)) p.rotation = normalizeRotation(p.rotation + delta)
      })
    })
  }, [commit])

  const deletePages = useCallback((pageIds) => {
    const ids = new Set(pageIds)
    const label = ids.size === 1 ? 'Delete page' : `Delete ${ids.size} pages`
    commit(label, draft => {
      draft.pages = draft.pages.filter(p => !ids.has(p.id))
      // Drop per-page edits too, otherwise they linger invisibly and reappear
      // if the deletion is undone out of order.
      for (const id of ids) {
        delete draft.annotations[id]
        delete draft.textEdits[id]
        delete draft.redactions[id]
        delete draft.ocr[id]
      }
      draft.doc.bookmarks = draft.doc.bookmarks.filter(b => !ids.has(b.pageId))
    })
    setSelectedPageIds(prev => {
      const next = new Set(prev)
      for (const id of ids) next.delete(id)
      return next
    })
  }, [commit])

  const duplicatePages = useCallback((pageIds) => {
    const ids = new Set(pageIds)
    commit(ids.size === 1 ? 'Duplicate page' : `Duplicate ${ids.size} pages`, draft => {
      // Walk backwards so inserting does not shift indices still to be visited.
      for (let i = draft.pages.length - 1; i >= 0; i--) {
        const page = draft.pages[i]
        if (!ids.has(page.id)) continue
        const copy = { ...structuredClone(page), id: uid('pg') }
        draft.pages.splice(i + 1, 0, copy)
        const anns = draft.annotations[page.id]
        if (anns?.length) {
          draft.annotations[copy.id] = anns.map(a => ({ ...structuredClone(a), id: uid('ann') }))
        }
        if (draft.ocr[page.id]) draft.ocr[copy.id] = structuredClone(draft.ocr[page.id])
      }
    })
  }, [commit])

  const movePage = useCallback((fromIndex, toIndex) => {
    if (fromIndex === toIndex) return
    commit('Reorder pages', draft => {
      const [moved] = draft.pages.splice(fromIndex, 1)
      draft.pages.splice(toIndex, 0, moved)
    })
  }, [commit])

  const reorderPages = useCallback((orderedIds) => {
    commit('Reorder pages', draft => {
      const byId = new Map(draft.pages.map(p => [p.id, p]))
      draft.pages = orderedIds.map(id => byId.get(id)).filter(Boolean)
    })
  }, [commit])

  const cropPages = useCallback((pageIds, crop) => {
    const ids = new Set(pageIds)
    commit(crop ? 'Crop pages' : 'Remove crop', draft => {
      draft.pages.forEach(p => { if (ids.has(p.id)) p.crop = crop ? { ...crop } : null })
    })
  }, [commit])

  const resizePages = useCallback((pageIds, size, mode) => {
    const ids = new Set(pageIds)
    commit('Resize pages', draft => {
      draft.pages.forEach(p => {
        if (ids.has(p.id)) p.resize = { width: size.width, height: size.height, mode }
      })
    })
  }, [commit])

  // -------------------------------------------------------------------------
  // Annotation operations
  // -------------------------------------------------------------------------

  const addAnnotation = useCallback((pageId, annotation, label = 'Add annotation') => {
    const id = uid('ann')
    commit(label, draft => {
      if (!draft.annotations[pageId]) draft.annotations[pageId] = []
      draft.annotations[pageId].push({ ...annotation, id })
    })
    setSelectedAnnotationId(id)
    return id
  }, [commit])

  const removeAnnotation = useCallback((pageId, annotationId) => {
    commit('Delete annotation', draft => {
      draft.annotations[pageId] = (draft.annotations[pageId] || []).filter(a => a.id !== annotationId)
    })
    setSelectedAnnotationId(prev => (prev === annotationId ? null : prev))
  }, [commit])

  const updateAnnotation = useCallback((pageId, annotationId, updates, label = 'Edit annotation') => {
    commit(label, draft => {
      draft.annotations[pageId] = (draft.annotations[pageId] || [])
        .map(a => (a.id === annotationId ? { ...a, ...updates } : a))
    })
  }, [commit])

  /**
   * Mid-gesture annotation update. Rebuilds only the affected page's array so a
   * drag does not deep-clone the whole document on every pointer move.
   */
  const updateAnnotationLive = useCallback((pageId, annotationId, updates) => {
    commitLive(prev => ({
      ...prev,
      annotations: {
        ...prev.annotations,
        [pageId]: (prev.annotations[pageId] || [])
          .map(a => (a.id === annotationId ? { ...a, ...updates } : a)),
      },
    }))
  }, [commitLive])

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  const togglePageSelection = useCallback((pageId) => {
    setSelectedPageIds(prev => {
      const next = new Set(prev)
      if (next.has(pageId)) next.delete(pageId)
      else next.add(pageId)
      return next
    })
  }, [])

  const selectAllPages = useCallback(() => {
    setSelectedPageIds(new Set(state.pages.map(p => p.id)))
  }, [state.pages])

  const clearPageSelection = useCallback(() => setSelectedPageIds(new Set()), [])

  const setPageSelection = useCallback((ids) => setSelectedPageIds(new Set(ids)), [])

  /** Pages a tool should act on: the explicit selection, or all pages if none. */
  const targetPageIds = useMemo(() => (
    selectedPageIds.size > 0
      ? state.pages.filter(p => selectedPageIds.has(p.id)).map(p => p.id)
      : state.pages.map(p => p.id)
  ), [selectedPageIds, state.pages])

  // -------------------------------------------------------------------------
  // Zoom
  // -------------------------------------------------------------------------

  const setZoom = useCallback((value) => {
    setZoomRaw(Math.min(8, Math.max(0.1, value)))
    setZoomMode('custom')
  }, [])

  const zoomIn = useCallback(() => setZoom(zoom * 1.25), [zoom, setZoom])
  const zoomOut = useCallback(() => setZoom(zoom / 1.25), [zoom, setZoom])

  // Warn before losing unsaved work.
  useEffect(() => {
    if (!isDirty) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  useEffect(() => () => { releaseAll() }, [])

  const value = {
    theme, toggleTheme,
    sources, state, history,
    isReady: state.pages.length > 0,
    isDirty,

    commit, commitLive, beginInteraction, endInteraction, cancelInteraction,
    undo, redo, canUndo, canRedo, undoLabel, redoLabel,

    addFiles, closeDocument,
    busy, setBusy, error, setError,
    restoreSession, saveStatus, autosaver,

    rotatePages, deletePages, duplicatePages, movePage, reorderPages,
    cropPages, resizePages,

    addAnnotation, removeAnnotation, updateAnnotation, updateAnnotationLive,

    activeTool, setActiveTool,
    toolOptions, setToolOption,
    signatures, addSignature, removeSignature,
    selectedPageIds, togglePageSelection, selectAllPages, clearPageSelection,
    setPageSelection, targetPageIds,
    selectedAnnotationId, setSelectedAnnotationId,

    zoom, setZoom, zoomIn, zoomOut, zoomMode, setZoomMode, setZoomRaw,
    currentPageId, setCurrentPageId,

    getPageProxy,
  }

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
}
