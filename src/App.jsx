import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { EditorProvider } from './state/EditorContext'
import { useEditor } from './state/useEditor'
import { useSearch } from './search/useSearch'
import PdfViewer from './viewer/PdfViewer'
import StartScreen from './ui/StartScreen'
import Ribbon from './ui/Ribbon'
import LeftRail from './ui/LeftRail'
import StatusBar from './ui/StatusBar'
import ToolOptionsPanel from './ui/ToolOptionsPanel'
import { MODE_TOOLS } from './ui/toolRegistry'

function Editor() {
  const {
    state, isReady, theme, toggleTheme, closeDocument,
    activeTool, setActiveTool, undo, redo, error, setError,
    selectedAnnotationId, removeAnnotation, currentPageId, selectAllPages,
  } = useEditor()

  const search = useSearch(state.pages)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [railTab, setRailTab] = useState('pages')
  const viewerRef = useRef(null)

  const goToPage = useCallback((pageId, smooth = true) => {
    viewerRef.current?.scrollToPage(pageId, { smooth })
  }, [])

  // Follow the active search match as the user steps through results. This
  // drives the DOM directly, so it does not cascade a render.
  useEffect(() => {
    if (search.activeMatch) goToPage(search.activeMatch.pageId)
  }, [search.activeMatch, goToPage])

  // Resolve highlight geometry for the pages that currently have matches.
  useEffect(() => {
    const ids = Object.keys(search.matchesByPage)
    if (ids.length > 0) search.resolveRects(ids)
  }, [search])

  const openSearch = useCallback(() => {
    setRailCollapsed(false)
    setRailTab('search')
    // Focus after the panel has mounted.
    requestAnimationFrame(() => document.querySelector('[aria-label="Search text"]')?.focus())
  }, [])

  /** Highlight rects keyed by page, for the viewer's text layer. */
  const searchMatchesByPage = useMemo(() => {
    const out = {}
    for (const [pageId, rects] of Object.entries(search.rectsByPage)) {
      const page = state.pages.find(p => p.id === pageId)
      if (!page) continue
      out[pageId] = rects.map(r => ({
        left: `${r.left * 100}%`,
        top: `${r.top * 100}%`,
        width: `${r.width * 100}%`,
        height: `${r.height * 100}%`,
      }))
    }
    return out
  }, [search.rectsByPage, state.pages])

  // Global shortcuts. Skipped while typing so they never eat real input.
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
        || el.tagName === 'SELECT' || el.isContentEditable
      const mod = e.ctrlKey || e.metaKey

      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        openSearch()
        return
      }
      if (typing) return

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAllPages(); return }

      if (e.key === 'Escape') {
        if (search.matches.length > 0) search.clear()
        else setActiveTool('select')
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotationId && currentPageId) {
        e.preventDefault()
        removeAnnotation(currentPageId, selectedAnnotationId)
      }
      if (e.key === 'F3' || (mod && e.key.toLowerCase() === 'g')) {
        e.preventDefault()
        e.shiftKey ? search.previous() : search.next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, search, selectedAnnotationId, currentPageId, removeAnnotation, setActiveTool, selectAllPages, openSearch])

  return (
    <div className="h-screen flex flex-col bg-title-bg text-text-primary overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-2.5 bg-section-bg border-b border-border shrink-0">
        <svg width="26" height="26" viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <rect x="8" y="4" width="24" height="32" rx="2" stroke="currentColor" strokeWidth="2.5" />
          <path d="M32 4l8 8v28a2 2 0 0 1-2 2H8" stroke="currentColor" strokeWidth="2.5" />
          <rect x="14" y="14" width="12" height="2" rx="1" fill="var(--theme-accent)" />
          <rect x="14" y="20" width="16" height="2" rx="1" fill="var(--theme-steel-blue)" />
        </svg>
        <h1 className="text-lg font-semibold tracking-wide">PDF Toolkit</h1>

        {isReady && (
          <>
            <span className="text-xs text-text-primary/40 ml-2 truncate max-w-[280px]">
              {state.pages.length} page{state.pages.length === 1 ? '' : 's'}
            </span>
            <button onClick={closeDocument} className="text-xs text-text-primary/60 hover:text-negative ml-1">
              Close
            </button>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <a href="https://planning-tool-belt.vercel.app" title="Back to Tool Belt"
             className="p-1.5 rounded-lg hover:bg-alt-bg text-text-primary/70">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          </a>
          <button onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                  className="p-1.5 rounded-lg hover:bg-alt-bg text-text-primary/70">
            {theme === 'dark' ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
              </svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="flex items-center gap-3 px-4 py-2 bg-negative/15 border-b border-negative/40 text-sm shrink-0">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-xs underline">Dismiss</button>
        </div>
      )}

      {!isReady ? (
        <StartScreen />
      ) : (
        <>
          <Ribbon onOpenPanel={() => {}} />
          <div className="flex flex-1 min-h-0">
            <LeftRail
              search={search}
              onGoToPage={goToPage}
              collapsed={railCollapsed}
              onToggle={() => setRailCollapsed(c => !c)}
              tab={railTab}
              setTab={setRailTab}
            />
            <PdfViewer
              searchMatchesByPage={searchMatchesByPage}
              activeMatch={search.activeMatchOnPage}
              viewerRef={viewerRef}
            />
            {MODE_TOOLS.has(activeTool) && <ToolOptionsPanel />}
          </div>
          <StatusBar onGoToPage={goToPage} />
        </>
      )}
    </div>
  )
}

export default function App() {
  return (
    <EditorProvider>
      <Editor />
    </EditorProvider>
  )
}
