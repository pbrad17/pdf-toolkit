import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import pdfjsLib from './utils/pdfSetup'

const AppContext = createContext()
export const useAppContext = () => useContext(AppContext)

let nextDocId = 1
let nextPageId = 1

function generateThumbnail(bytes, pageIndex) {
  return new Promise(async (resolve) => {
    const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() })
    const pdf = await loadingTask.promise
    const page = await pdf.getPage(pageIndex + 1)
    const scale = 200 / page.getViewport({ scale: 1 }).width
    const viewport = page.getViewport({ scale })
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
  const blobUrlsRef = useRef([])

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

  const clearAll = useCallback(() => {
    blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
    blobUrlsRef.current = []
    setDocuments([])
    setPages([])
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
    addDocument, removePages, reorderPage, movePage, clearAll,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
