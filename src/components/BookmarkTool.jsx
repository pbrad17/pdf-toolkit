import { useState } from 'react'
import { useAppContext } from '../AppContext'
import { buildFinalPdf, addBookmarks } from '../utils/pdfOperations'

export default function BookmarkTool() {
  const { documents, pages, annotations, isProcessing, setIsProcessing } = useAppContext()

  const [bookmarks, setBookmarks] = useState([]) // [{ title, page }]
  const [newTitle, setNewTitle] = useState('')
  const [newPage, setNewPage] = useState(1)
  const [status, setStatus] = useState('')

  const addBookmark = () => {
    const title = newTitle.trim()
    if (!title) return
    const page = Math.max(1, Math.min(pages.length, newPage))
    setBookmarks(prev => [...prev, { title, page }])
    setNewTitle('')
    setNewPage(page + 1 <= pages.length ? page + 1 : page)
  }

  const removeBookmark = (index) => {
    setBookmarks(prev => prev.filter((_, i) => i !== index))
  }

  const moveBookmark = (index, dir) => {
    setBookmarks(prev => {
      const next = [...prev]
      const newIdx = index + dir
      if (newIdx < 0 || newIdx >= next.length) return prev
      ;[next[index], next[newIdx]] = [next[newIdx], next[index]]
      return next
    })
  }

  const handleApply = async () => {
    if (pages.length === 0 || bookmarks.length === 0) return
    setIsProcessing(true)
    setStatus('Building PDF...')
    try {
      const combinedBytes = await buildFinalPdf(documents, pages, annotations)
      setStatus('Adding bookmarks...')
      const result = await addBookmarks(combinedBytes, bookmarks)
      const blob = new Blob([result], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'bookmarked.pdf'
      a.click()
      URL.revokeObjectURL(url)
      setStatus('Done! PDF with bookmarks downloaded.')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  if (pages.length === 0) {
    return (
      <div className="text-center text-steel-blue py-12">
        <p>No pages loaded. Upload a PDF first.</p>
      </div>
    )
  }

  return (
    <div className="max-w-lg">
      <div className="bg-dark-bg border border-border rounded-lg p-6">
        <h3 className="font-semibold mb-3">Bookmarks / Table of Contents</h3>
        <p className="text-sm text-steel-blue mb-4">
          Add navigable bookmarks that link to specific pages. These appear in the PDF viewer's sidebar.
        </p>

        {/* Add bookmark form */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1">
            <label className="text-xs font-medium text-steel-blue block mb-1">Title</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addBookmark() }}
              placeholder="e.g. Chapter 1"
              className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
            />
          </div>
          <div className="w-20">
            <label className="text-xs font-medium text-steel-blue block mb-1">Page</label>
            <input
              type="number"
              value={newPage}
              onChange={(e) => setNewPage(Number(e.target.value) || 1)}
              min={1}
              max={pages.length}
              className="w-full px-2 py-1.5 rounded border border-border bg-dark-bg text-text-primary text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={addBookmark}
              disabled={!newTitle.trim()}
              className="px-3 py-1.5 rounded border border-accent text-accent text-sm hover:bg-accent hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        </div>

        {/* Bookmark list */}
        {bookmarks.length > 0 && (
          <div className="space-y-1 max-h-64 overflow-auto mb-4">
            {bookmarks.map((bm, i) => (
              <div
                key={i}
                className="flex items-center gap-2 p-2 rounded bg-alt-bg border border-border-light text-sm"
              >
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => moveBookmark(i, -1)}
                    disabled={i === 0}
                    className="text-steel-blue hover:text-accent disabled:opacity-30 leading-none text-xs"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => moveBookmark(i, 1)}
                    disabled={i === bookmarks.length - 1}
                    className="text-steel-blue hover:text-accent disabled:opacity-30 leading-none text-xs"
                  >
                    ▼
                  </button>
                </div>
                <span className="flex-1 truncate">{bm.title}</span>
                <span className="text-xs text-steel-blue whitespace-nowrap">p.{bm.page}</span>
                <button
                  onClick={() => removeBookmark(i)}
                  className="text-negative hover:text-negative/80 shrink-0"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {bookmarks.length === 0 && (
          <p className="text-sm text-steel-blue mb-4">No bookmarks added yet. Use the form above to add entries.</p>
        )}

        <button
          onClick={handleApply}
          disabled={isProcessing || bookmarks.length === 0}
          className="w-full py-2.5 rounded-lg font-medium bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Processing...' : 'Add Bookmarks & Download'}
        </button>
        {status && <p className="text-sm text-steel-blue mt-3">{status}</p>}
      </div>
    </div>
  )
}
