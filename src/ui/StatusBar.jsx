import { useState } from 'react'
import { useEditor } from '../state/useEditor'

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 4]

/** Page indicator, zoom controls and long-operation progress. */
export default function StatusBar({ onGoToPage }) {
  const {
    state, currentPageId, zoom, zoomMode, setZoom, zoomIn, zoomOut, setZoomMode, busy,
  } = useEditor()

  const pageIndex = state.pages.findIndex(p => p.id === currentPageId)

  /**
   * Draft holds the user's in-progress typing; when it is null the field simply
   * shows the page the viewer is on.
   *
   * Deriving the displayed value this way — rather than mirroring the scroll
   * position into state from an effect — means scrolling can never overwrite a
   * half-typed page number, and there is no render cascade on every scroll tick.
   */
  const [draft, setDraft] = useState(null)
  const pageInput = draft ?? String(pageIndex + 1)

  const jump = (value) => {
    setDraft(null) // fall back to following the viewer again
    const n = parseInt(value, 10)
    if (Number.isNaN(n) || n < 1 || n > state.pages.length) return
    onGoToPage(state.pages[n - 1].id)
  }

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-dark-bg border-t border-border text-xs shrink-0">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => pageIndex > 0 && onGoToPage(state.pages[pageIndex - 1].id)}
          disabled={pageIndex <= 0}
          className="p-1 rounded hover:bg-alt-bg disabled:opacity-30"
          aria-label="Previous page"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6" /></svg>
        </button>
        <form onSubmit={(e) => { e.preventDefault(); jump(pageInput); e.target.querySelector('input')?.blur() }}>
          <input
            value={pageInput}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => jump(pageInput)}
            className="w-11 px-1.5 py-0.5 text-center rounded bg-alt-bg border border-border focus:outline-none focus:border-accent"
            aria-label="Page number"
          />
        </form>
        <span className="text-text-primary/50">of {state.pages.length}</span>
        <button
          onClick={() => pageIndex < state.pages.length - 1 && onGoToPage(state.pages[pageIndex + 1].id)}
          disabled={pageIndex >= state.pages.length - 1}
          className="p-1 rounded hover:bg-alt-bg disabled:opacity-30"
          aria-label="Next page"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>

      {busy && (
        <div className="flex-1 flex items-center gap-2 min-w-0" role="status" aria-live="polite">
          <span className="w-3 h-3 rounded-full border-2 border-accent/30 border-t-accent animate-spin shrink-0" />
          <span className="truncate text-text-primary/70">{busy.label}</span>
          {busy.progress != null && (
            <div className="w-24 h-1 rounded-full bg-alt-bg overflow-hidden shrink-0">
              <div className="h-full bg-accent-strong" style={{ width: `${busy.progress * 100}%` }} />
            </div>
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-1">
        <button onClick={zoomOut} className="p-1 rounded hover:bg-alt-bg" aria-label="Zoom out">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14" /></svg>
        </button>
        <select
          value={zoomMode === 'custom' ? 'custom' : zoomMode}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'fit-width' || v === 'fit-page') setZoomMode(v)
            else setZoom(parseFloat(v))
          }}
          className="px-1.5 py-0.5 rounded bg-alt-bg border border-border focus:outline-none focus:border-accent"
          aria-label="Zoom level"
        >
          <option value="fit-width">Fit width</option>
          <option value="fit-page">Fit page</option>
          {zoomMode === 'custom' && <option value="custom">{Math.round(zoom * 100)}%</option>}
          {ZOOM_PRESETS.map(z => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
        </select>
        <button onClick={zoomIn} className="p-1 rounded hover:bg-alt-bg" aria-label="Zoom in">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
    </div>
  )
}
