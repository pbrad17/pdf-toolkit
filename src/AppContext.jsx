import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import pdfjsLib from './utils/pdfSetup'

const AppContext = createContext()
export const useAppContext = () => useContext(AppContext)

let nextDocId = 1
let nextPageId = 1

function generateThumbnail(bytes, pageIndex, rotation = 0) {
  return new Promise(async (resolve) => {
    const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() })
    const pdf = await loadingTask.promise
    const page = await pdf.getPage(pageIndex + 1)
    const scale = 200 / page.getViewport({ scale: 1 }).width
    const viewport = page.getViewport({ scale, rotation })
    const canvas = new OffscreenCanvas(viewport.width, viewport.height)
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    resolve(URL.createObjectURL(blob))
    pdf.destroy()
  })
}

export function AppProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('pdftoolkit-theme')
    return saved || 'light'
  })
  const [documents, setDocuments] = useState([])
  const [pages, setPages] = useState([])
  const [activeTool, setActiveTool] = useState('upload')
  const [isProcessing, setIsProcessing] = useState(false)
  const [selectedPages, setSelectedPages] = useState(new Set())
  const [previewPageId, setPreviewPageId] = useState(null)
  const [annotations, setAnnotations] = useState({})
  const [signatures, setSignatures] = useState([])
  const blobUrlsRef = useRef([])

  // Undo/Redo history
  const HISTORY_LIMIT = 50
  const undoStackRef = useRef([])
  const redoStackRef = useRef([])
  const [historyVersion, setHistoryVersion] = useState(0)
  const bumpHistory = () => setHistoryVersion(v => v + 1)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('pdftoolkit-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  const addDocument = useCallback(async (file) => {
    setIsProcessing(true)
    try {
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() })
      const pdf = await loadingTask.promise
      const pageCount = pdf.numPages
      const docId = nextDocId++
      const doc = { id: docId, name: file.name, bytes, pageCount }

      const newPages = []
      for (let i = 0; i < pageCount; i++) {
        const thumbnailUrl = await generateThumbnail(bytes, i)
        blobUrlsRef.current.push(thumbnailUrl)
        newPages.push({
          id: nextPageId++,
          docId,
          pageIndex: i,
          thumbnailUrl,
          rotation: 0,
        })
      }

      pdf.destroy()
      setDocuments(prev => [...prev, doc])
      setPages(prev => [...prev, ...newPages])
    } finally {
      setIsProcessing(false)
    }
  }, [])

  const removePages = useCallback((pageIds) => {
    setPages(prev => {
      const removed = prev.filter(p => pageIds.includes(p.id))
      removed.forEach(p => URL.revokeObjectURL(p.thumbnailUrl))
      return prev.filter(p => !pageIds.includes(p.id))
    })
    setSelectedPages(prev => {
      const next = new Set(prev)
      pageIds.forEach(id => next.delete(id))
      return next
    })
  }, [])

  const reorderPage = useCallback((pageId, direction) => {
    setPages(prev => {
      const idx = prev.findIndex(p => p.id === pageId)
      if (idx < 0) return prev
      const newIdx = idx + direction
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
      return next
    })
  }, [])

  const movePage = useCallback((fromIndex, toIndex) => {
    setPages(prev => {
      if (fromIndex === toIndex) return prev
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [])

  const rotatePage = useCallback((pageId, direction) => {
    setPages(prev => prev.map(p => {
      if (p.id !== pageId) return p
      const newRotation = (p.rotation + direction + 360) % 360
      const doc = documents.find(d => d.id === p.docId)
      if (!doc) return p
      // Revoke old thumbnail
      URL.revokeObjectURL(p.thumbnailUrl)
      // Generate new thumbnail asynchronously, update in place
      generateThumbnail(doc.bytes, p.pageIndex, newRotation).then(url => {
        blobUrlsRef.current.push(url)
        setPages(curr => curr.map(cp =>
          cp.id === pageId ? { ...cp, thumbnailUrl: url } : cp
        ))
      })
      return { ...p, rotation: newRotation, thumbnailUrl: p.thumbnailUrl }
    }))
  }, [documents])

  const duplicatePage = useCallback(async (pageId) => {
    const page = pages.find(p => p.id === pageId)
    if (!page) return
    const doc = documents.find(d => d.id === page.docId)
    if (!doc) return
    const thumbnailUrl = await generateThumbnail(doc.bytes, page.pageIndex, page.rotation)
    blobUrlsRef.current.push(thumbnailUrl)
    const newPage = {
      id: nextPageId++,
      docId: page.docId,
      pageIndex: page.pageIndex,
      thumbnailUrl,
      rotation: page.rotation,
    }
    setPages(prev => {
      const idx = prev.findIndex(p => p.id === pageId)
      const next = [...prev]
      next.splice(idx + 1, 0, newPage)
      return next
    })
    // Copy annotations if any exist for this page
    setAnnotations(prev => {
      const sourceAnns = prev[pageId]
      if (!sourceAnns || sourceAnns.length === 0) return prev
      const copied = sourceAnns.map(a => ({ ...a, id: Date.now() + Math.random() }))
      return { ...prev, [newPage.id]: copied }
    })
  }, [pages, documents])

  const toggleSelectPage = useCallback((pageId) => {
    setSelectedPages(prev => {
      const next = new Set(prev)
      if (next.has(pageId)) next.delete(pageId)
      else next.add(pageId)
      return next
    })
  }, [])

  const selectAllPages = useCallback(() => {
    setSelectedPages(new Set(pages.map(p => p.id)))
  }, [pages])

  const deselectAllPages = useCallback(() => {
    setSelectedPages(new Set())
  }, [])

  const addAnnotation = useCallback((pageId, annotation) => {
    const fullAnnotation = { ...annotation, id: Date.now() + Math.random() }
    undoStackRef.current = [...undoStackRef.current, { type: 'add', pageId, annotation: fullAnnotation }].slice(-HISTORY_LIMIT)
    redoStackRef.current = []
    bumpHistory()
    setAnnotations(prev => ({
      ...prev,
      [pageId]: [...(prev[pageId] || []), fullAnnotation],
    }))
  }, [])

  const removeAnnotation = useCallback((pageId, annotationId) => {
    setAnnotations(prev => {
      const removed = (prev[pageId] || []).find(a => a.id === annotationId)
      if (removed) {
        undoStackRef.current = [...undoStackRef.current, { type: 'remove', pageId, annotation: removed }].slice(-HISTORY_LIMIT)
        redoStackRef.current = []
        bumpHistory()
      }
      return { ...prev, [pageId]: (prev[pageId] || []).filter(a => a.id !== annotationId) }
    })
  }, [])

  // skipHistory: true during drag/resize (continuous updates), false for discrete changes
  const updateAnnotation = useCallback((pageId, annotationId, updates, skipHistory = false) => {
    setAnnotations(prev => {
      const current = (prev[pageId] || []).find(a => a.id === annotationId)
      if (current && !skipHistory) {
        const prevValues = {}
        for (const key of Object.keys(updates)) prevValues[key] = current[key]
        undoStackRef.current = [...undoStackRef.current, { type: 'update', pageId, annotationId, prev: prevValues, next: { ...updates } }].slice(-HISTORY_LIMIT)
        redoStackRef.current = []
        bumpHistory()
      }
      return { ...prev, [pageId]: (prev[pageId] || []).map(a => a.id === annotationId ? { ...a, ...updates } : a) }
    })
  }, [])

  // Record a single history entry for a completed drag/resize
  const recordAnnotationChange = useCallback((pageId, annotationId, prevValues, nextValues) => {
    undoStackRef.current = [...undoStackRef.current, { type: 'update', pageId, annotationId, prev: prevValues, next: nextValues }].slice(-HISTORY_LIMIT)
    redoStackRef.current = []
    bumpHistory()
  }, [])

  const undo = useCallback(() => {
    const stack = undoStackRef.current
    if (stack.length === 0) return
    const entry = stack[stack.length - 1]
    undoStackRef.current = stack.slice(0, -1)
    redoStackRef.current = [...redoStackRef.current, entry]
    bumpHistory()

    setAnnotations(prev => {
      if (entry.type === 'add') {
        return { ...prev, [entry.pageId]: (prev[entry.pageId] || []).filter(a => a.id !== entry.annotation.id) }
      }
      if (entry.type === 'remove') {
        return { ...prev, [entry.pageId]: [...(prev[entry.pageId] || []), entry.annotation] }
      }
      if (entry.type === 'update') {
        return { ...prev, [entry.pageId]: (prev[entry.pageId] || []).map(a => a.id === entry.annotationId ? { ...a, ...entry.prev } : a) }
      }
      return prev
    })
  }, [])

  const redo = useCallback(() => {
    const stack = redoStackRef.current
    if (stack.length === 0) return
    const entry = stack[stack.length - 1]
    redoStackRef.current = stack.slice(0, -1)
    undoStackRef.current = [...undoStackRef.current, entry]
    bumpHistory()

    setAnnotations(prev => {
      if (entry.type === 'add') {
        return { ...prev, [entry.pageId]: [...(prev[entry.pageId] || []), entry.annotation] }
      }
      if (entry.type === 'remove') {
        return { ...prev, [entry.pageId]: (prev[entry.pageId] || []).filter(a => a.id !== entry.annotation.id) }
      }
      if (entry.type === 'update') {
        return { ...prev, [entry.pageId]: (prev[entry.pageId] || []).map(a => a.id === entry.annotationId ? { ...a, ...entry.next } : a) }
      }
      return prev
    })
  }, [])

  const canUndo = undoStackRef.current.length > 0
  const canRedo = redoStackRef.current.length > 0

  const addSignature = useCallback((dataUrl) => {
    setSignatures(prev => [...prev, { id: Date.now(), dataUrl }])
  }, [])

  const removeSignature = useCallback((sigId) => {
    setSignatures(prev => prev.filter(s => s.id !== sigId))
  }, [])

  const clearAll = useCallback(() => {
    blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
    blobUrlsRef.current = []
    setDocuments([])
    setPages([])
    setSelectedPages(new Set())
    setPreviewPageId(null)
    setAnnotations({})
    undoStackRef.current = []
    redoStackRef.current = []
    bumpHistory()
  }, [])

  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  const value = {
    theme, toggleTheme,
    documents, pages,
    activeTool, setActiveTool,
    isProcessing, setIsProcessing,
    selectedPages, toggleSelectPage, selectAllPages, deselectAllPages,
    previewPageId, setPreviewPageId,
    annotations, addAnnotation, removeAnnotation, updateAnnotation, recordAnnotationChange,
    undo, redo, canUndo, canRedo,
    signatures, addSignature, removeSignature,
    addDocument, removePages, reorderPage, movePage, rotatePage, duplicatePage, clearAll,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
