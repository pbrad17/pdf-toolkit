import { useState } from 'react'
import { useEditor } from '../state/useEditor'
import { Icon, IconButton, Select, Spinner, TextInput } from './primitives'

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
    <div
      className="shrink-0 flex items-center gap-2 px-2 h-[var(--ui-status-h)] bg-dark-bg border-t border-border"
      /* The band is 30px and the shared row height is 28px, which would leave
         the controls wedged edge to edge. Re-pointing the row token at its own
         small step for this band keeps the input and the select on the app's
         scale instead of forking a second set of sizes here. */
      style={{ '--ui-row-h': 'var(--ui-row-h-sm)' }}
    >
      <div className="flex items-center gap-1">
        <IconButton
          label="Previous page"
          size="sm"
          onClick={() => pageIndex > 0 && onGoToPage(state.pages[pageIndex - 1].id)}
          disabled={pageIndex <= 0}
        >
          <Icon d="M18 15l-6-6-6 6" size={14} />
        </IconButton>
        {/* Sized on the form, not the input: the shared control is w-full, and
            a competing width utility would resolve by stylesheet order. Wide
            enough for a four-digit page number. */}
        <form
          className="w-14"
          onSubmit={(e) => { e.preventDefault(); jump(pageInput); e.target.querySelector('input')?.blur() }}
        >
          <TextInput
            value={pageInput}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => jump(pageInput)}
            className="text-center tabular-nums"
            aria-label="Page number"
          />
        </form>
        <span className="text-[11px] tabular-nums text-text-subtle">of {state.pages.length}</span>
        <IconButton
          label="Next page"
          size="sm"
          onClick={() => pageIndex < state.pages.length - 1 && onGoToPage(state.pages[pageIndex + 1].id)}
          disabled={pageIndex >= state.pages.length - 1}
        >
          <Icon d="M6 9l6 6 6-6" size={14} />
        </IconButton>
      </div>

      {busy && (
        <div className="flex-1 flex items-center gap-2 min-w-0" role="status" aria-live="polite">
          <span className="shrink-0 text-accent"><Spinner size={13} /></span>
          <span className="truncate text-[11px] text-text-muted">{busy.label}</span>
          {busy.progress != null && (
            <div
              className="w-24 h-1.5 rounded-full bg-alt-bg overflow-hidden shrink-0"
              role="progressbar"
              aria-label={busy.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(busy.progress * 100)}
            >
              {/* accent-edge, not accent-strong: the fill has to clear 3:1
                  against its own track, and on the light theme accent-strong
                  manages only 2.58 there. */}
              <div className="h-full bg-accent-edge" style={{ width: `${busy.progress * 100}%` }} />
            </div>
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-1">
        <IconButton label="Zoom out" size="sm" onClick={zoomOut}>
          <Icon d="M5 12h14" size={14} />
        </IconButton>
        <div className="w-[92px]">
          <Select
            value={zoomMode === 'custom' ? 'custom' : zoomMode}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'fit-width' || v === 'fit-page') setZoomMode(v)
              else setZoom(parseFloat(v))
            }}
            className="tabular-nums"
            aria-label="Zoom level"
          >
            <option value="fit-width">Fit width</option>
            <option value="fit-page">Fit page</option>
            {zoomMode === 'custom' && <option value="custom">{Math.round(zoom * 100)}%</option>}
            {ZOOM_PRESETS.map(z => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
          </Select>
        </div>
        <IconButton label="Zoom in" size="sm" onClick={zoomIn}>
          <Icon d="M12 5v14M5 12h14" size={14} />
        </IconButton>
      </div>
    </div>
  )
}
