import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { EditorProvider } from './state/EditorContext'
import { useEditor } from './state/useEditor'
import { useSearch } from './search/useSearch'
import PdfViewer from './viewer/PdfViewer'
import StartScreen from './ui/StartScreen'
import Ribbon from './ui/Ribbon'
import LeftRail from './ui/LeftRail'
import StatusBar from './ui/StatusBar'
import ToolPanel from './ui/panelRegistry'
import { hasPanel } from './ui/panelMap'
import RestorePrompt from './ui/RestorePrompt'
import { AppErrorBoundary } from './ui/ErrorBoundary'
import { useSave } from './export/useSave'
import { Button, Icon, IconButton } from './ui/primitives'

/**
 * The tool-belt link has to stay a real <a> — middle-click and open-in-new-tab
 * are the whole point of it — and IconButton renders a <button>, so the ghost
 * icon-button geometry is reproduced here rather than teaching the primitive an
 * `as` prop for a single link.
 */
const ICON_LINK =
  'inline-flex items-center justify-center shrink-0 w-[var(--ui-row-h)] h-[var(--ui-row-h)] ' +
  'rounded-[var(--ui-radius-sm)] border border-transparent text-text-muted transition-colors ' +
  'hover:bg-section-bg hover:text-text-primary active:bg-header-bg'

/** tone -> [surface, icon colour, icon path] */
const NOTICE_TONE = {
  danger: [
    'bg-danger-soft',
    'text-negative',
    'M12 8v4M12 16h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  ],
  warning: [
    'bg-warn-soft',
    'text-accent',
    'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  ],
}

/**
 * Full-width notice band.
 *
 * Same grammar as the panel Callout — tone carried by the icon and a tinted
 * surface, body text always text-primary — but it spans a band of the frame
 * rather than sitting inside a panel, so it takes the frame's horizontal
 * padding and a bottom border instead of Callout's card treatment.
 */
function ShellNotice({ tone, role, dismissLabel, onDismiss, children }) {
  const [surface, iconTone, iconPath] = NOTICE_TONE[tone]
  return (
    <div
      role={role}
      className={`shrink-0 flex items-start gap-2 px-3 py-1.5 border-b border-border ${surface}`}
    >
      <span className={`shrink-0 mt-0.5 ${iconTone}`}>
        <Icon d={iconPath} size={14} />
      </span>
      <div className="flex-1 min-w-0 text-xs leading-snug text-text-primary">{children}</div>
      {/* Both bands can be open at once, so the accessible name says which one
          this dismisses. It still starts with the visible word. */}
      <Button variant="ghost" size="sm" aria-label={dismissLabel} onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  )
}

function Editor() {
  const {
    state, isReady, theme, toggleTheme, closeDocument,
    activeTool, setActiveTool, undo, redo, error, setError,
    selectedAnnotationId, removeAnnotation, currentPageId, selectAllPages,
  } = useEditor()

  const search = useSearch(state.pages)
  const { save, warnings, dismissWarnings } = useSave()
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
  // Depends on the two values it actually uses, not the whole search object —
  // useSearch returns a fresh object literal every render, so depending on it
  // ran this effect on every render of the editor.
  const { matchesByPage, resolveRects } = search
  useEffect(() => {
    const ids = Object.keys(matchesByPage)
    if (ids.length > 0) resolveRects(ids)
  }, [matchesByPage, resolveRects])

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
      {/* Three clusters, not one row: identity, document, actions. The band is a
          stated height so the stage always starts in the same place. */}
      <header className="shrink-0 flex items-center gap-2 px-3 h-[var(--ui-header-h)] bg-section-bg border-b border-border">
        <svg width="22" height="22" viewBox="0 0 48 48" fill="none" aria-hidden="true" className="shrink-0">
          <rect x="8" y="4" width="24" height="32" rx="2" stroke="currentColor" strokeWidth="2.5" />
          <path d="M32 4l8 8v28a2 2 0 0 1-2 2H8" stroke="currentColor" strokeWidth="2.5" />
          <rect x="14" y="14" width="12" height="2" rx="1" fill="var(--theme-accent)" />
          <rect x="14" y="20" width="16" height="2" rx="1" fill="var(--theme-steel-blue)" />
        </svg>
        <h1 className="text-sm font-semibold tracking-wide shrink-0">PDF Toolkit</h1>

        {isReady && (
          <>
            <span aria-hidden="true" className="shrink-0 w-px h-4 bg-border mx-1" />
            <span className="shrink-0 text-[11px] tabular-nums text-text-subtle">
              {state.pages.length} page{state.pages.length === 1 ? '' : 's'}
            </span>
            {/* Discards the working document, so it is a real button rather than
                the bare hover-red text link it used to be. */}
            <Button variant="secondary" size="sm" onClick={closeDocument}>Close</Button>
          </>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {isReady && (
            <>
              <Button
                variant="primary"
                onClick={save}
                icon={(
                  <Icon>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <path d="M7 10l5 5 5-5" />
                    <path d="M12 15V3" />
                  </Icon>
                )}
              >
                Save
              </Button>
              {/* Separates the document action from the app-level links. With no
                  document there is nothing to separate. */}
              <span aria-hidden="true" className="shrink-0 w-px h-4 bg-border mx-0.5" />
            </>
          )}
          <a
            href="https://planning-tool-belt.vercel.app"
            title="Back to Tool Belt"
            aria-label="Back to Tool Belt"
            className={ICON_LINK}
          >
            <Icon d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </a>
          <IconButton
            label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? (
              <Icon>
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
              </Icon>
            ) : (
              <Icon d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            )}
          </IconButton>
        </div>
      </header>

      {error && (
        <ShellNotice
          tone="danger"
          role="alert"
          dismissLabel="Dismiss error"
          onDismiss={() => setError(null)}
        >
          {error}
        </ShellNotice>
      )}

      {warnings.length > 0 && (
        <ShellNotice
          tone="warning"
          role="status"
          dismissLabel="Dismiss save notes"
          onDismiss={dismissWarnings}
        >
          <p className="font-medium">
            Saved, with {warnings.length} note{warnings.length === 1 ? '' : 's'}:
          </p>
          <ul className="list-disc pl-4 mt-0.5 space-y-0.5 text-[11px]">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </ShellNotice>
      )}

      {/* Offered, never automatic: a document reappearing by itself on a
          shared machine would be a privacy failure, not a convenience. */}
      <RestorePrompt />

      {!isReady ? (
        <StartScreen />
      ) : (
        <>
          <Ribbon onOpenPanel={setActiveTool} />
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
            {hasPanel(activeTool) && <ToolPanel toolId={activeTool} />}
          </div>
          <StatusBar onGoToPage={goToPage} />
        </>
      )}
    </div>
  )
}

export default function App() {
  return (
    <AppErrorBoundary>
      <EditorProvider>
        <Editor />
      </EditorProvider>
    </AppErrorBoundary>
  )
}
