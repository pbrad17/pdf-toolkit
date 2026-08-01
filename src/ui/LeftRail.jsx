import { useState, useMemo, useRef, useEffect } from 'react'
import { useEditor } from '../state/useEditor'
import { displaySize } from '../state/documentModel'
import PageCanvas from '../viewer/PageCanvas'
import {
  Checkbox, Divider, EmptyState, Icon, IconButton, SectionHeading, Spinner, TextInput,
} from './primitives'

const TABS = [
  { id: 'pages', label: 'Pages', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'search', label: 'Search', icon: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35' },
  { id: 'bookmarks', label: 'Bookmarks', icon: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' },
]

const ICON = {
  chevronLeft: 'M15 18l-6-6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  chevronUp: 'M18 15l-6-6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  close: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
}

/** Rendered width of a page thumbnail. The rail is a fixed 240px, so this is a
 *  constant rather than a measurement; PageCanvas needs concrete pixel sizes. */
const THUMB_W = 152

/**
 * Left rail: page thumbnails, search results and bookmarks.
 *
 * Thumbnails double as the page-organisation surface — selection here is the
 * same selection the Organize tools act on, so there is no separate "manage
 * pages" screen to switch to and lose your place in the document.
 */
export default function LeftRail({ search, onGoToPage, collapsed, onToggle, tab, setTab }) {
  /**
   * Collapsed is a state of the rail, not a fallback for it. The tab buttons
   * stay in place and keep showing which panel is selected, so expanding is a
   * reversal rather than a re-navigation.
   */
  if (collapsed) {
    return (
      <div
        className="shrink-0 flex flex-col items-center gap-1 py-1.5 bg-dark-bg border-r border-border"
        style={{ width: 'var(--ui-rail-collapsed-w)' }}
      >
        <IconButton label="Show panel" onClick={onToggle}>
          <Icon d={ICON.chevronRight} />
        </IconButton>
        <Divider className="w-5" />
        {TABS.map(t => (
          <IconButton
            key={t.id}
            label={t.label}
            active={tab === t.id}
            onClick={() => { setTab(t.id); onToggle() }}
          >
            <Icon d={t.icon} />
          </IconButton>
        ))}
      </div>
    )
  }

  return (
    <div
      className="shrink-0 min-h-0 flex flex-col bg-dark-bg border-r border-border"
      style={{ width: 'var(--ui-rail-w)' }}
    >
      {/* Fixed head, same height as a tool panel's title bar so the rail and the
          right-hand panel share one horizontal line across the shell. */}
      <div
        className="shrink-0 flex items-center gap-0.5 px-1.5 h-[var(--ui-panel-head-h)] border-b border-border"
        role="tablist"
        aria-label="Document panels"
      >
        {TABS.map(t => {
          const on = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              id={`rail-tab-${t.id}`}
              role="tab"
              aria-selected={on}
              aria-controls="rail-panel"
              aria-label={t.label}
              title={t.label}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1 h-[var(--ui-row-h-sm)] px-1.5 rounded-[var(--ui-radius-sm)] border transition-colors ${
                on
                  ? 'bg-accent-soft text-accent border-accent-soft-border'
                  : 'border-transparent text-text-muted hover:bg-section-bg hover:text-text-primary'
              }`}
            >
              <Icon d={t.icon} size={14} />
              {/* Only the selected tab is named. Three labels do not fit a 240px
                  rail, and the one that matters is the panel you are looking at. */}
              {on && <span className="text-[11px] font-medium">{t.label}</span>}
            </button>
          )
        })}
        <IconButton label="Hide panel" size="sm" onClick={onToggle} className="ml-auto">
          <Icon d={ICON.chevronLeft} size={14} />
        </IconButton>
      </div>

      <div
        id="rail-panel"
        role="tabpanel"
        aria-labelledby={`rail-tab-${tab}`}
        className="flex-1 min-h-0 flex flex-col"
      >
        {tab === 'pages' && <ThumbnailList onGoToPage={onGoToPage} />}
        {tab === 'search' && <SearchPanel search={search} onGoToPage={onGoToPage} />}
        {tab === 'bookmarks' && <BookmarkList onGoToPage={onGoToPage} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * Three states can be true of one thumbnail at once, so each gets a different
 * kind of mark rather than a different shade of the same one:
 *
 *   current page   a ring on the page image itself, plus an accent page number
 *   selected       a tint and a rim on the ROW, plus a check badge
 *   drop target    a steel-blue ring and tint on the ROW, only during a drag
 *
 * The drop target highlights the destination slot rather than drawing a line in
 * a gap because that is what the reorder actually does: movePage(from, to)
 * removes the page and re-inserts it AT index `to`, so the dragged page ends up
 * occupying exactly the row being highlighted, whichever direction it came from.
 * A gap line would have to point above or below depending on drag direction.
 */
function ThumbnailList({ onGoToPage }) {
  const {
    state, currentPageId, selectedPageIds, togglePageSelection,
    setPageSelection, movePage,
  } = useEditor()

  const dragIndexRef = useRef(null)
  const [dropIndex, setDropIndex] = useState(null)

  return (
    <ol className="flex-1 min-h-0 overflow-y-auto px-2 py-1.5 space-y-1" aria-label="Page thumbnails">
      {state.pages.map((page, i) => {
        const isCurrent = page.id === currentPageId
        const isSelected = selectedPageIds.has(page.id)
        const isDropTarget = dropIndex === i
        const { width, height } = displaySize(page)
        const scale = THUMB_W / width
        const thumbHeight = Math.round(height * scale)

        return (
          <li
            key={page.id}
            draggable
            onDragStart={() => { dragIndexRef.current = i }}
            onDragOver={(e) => { e.preventDefault(); setDropIndex(i) }}
            onDragEnd={() => { dragIndexRef.current = null; setDropIndex(null) }}
            onDrop={(e) => {
              e.preventDefault()
              const from = dragIndexRef.current
              if (from != null && from !== i) movePage(from, i)
              dragIndexRef.current = null
              setDropIndex(null)
            }}
            aria-current={isCurrent ? 'page' : undefined}
            className={`relative p-1 border rounded-[var(--ui-radius-sm)] cursor-pointer transition-colors ${
              isDropTarget
                ? 'bg-info-soft border-steel-blue ring-1 ring-steel-blue'
                : isSelected
                  ? 'bg-accent-soft border-accent-soft-border'
                  : 'border-transparent hover:bg-section-bg'
            }`}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey) togglePageSelection(page.id)
              else { setPageSelection([page.id]); onGoToPage(page.id) }
            }}
          >
            {/* bg-white is paper, not a theme surface — the same call the
                viewer makes for a full-size page, and for the same reason: a
                thumbnail is the document, so it stays white in both themes and
                anything drawn on it is judged against white. PageCanvas's
                pending skeleton is a transparent overlay, so without this fill a
                thumbnail that has not rendered yet is a hole in the rail.
                No shadow: rim plus surface step, per DESIGN.md. */}
            <div
              className={`relative mx-auto overflow-hidden bg-white ${
                isCurrent ? 'ring-2 ring-accent-edge' : 'ring-1 ring-border'
              }`}
              style={{ width: THUMB_W, height: thumbHeight }}
            >
              <PageCanvas
                page={page}
                scale={scale}
                width={THUMB_W}
                height={thumbHeight}
              />
            </div>
            <div
              className={`mt-1 text-center text-[11px] leading-none tabular-nums ${
                isCurrent ? 'text-accent font-semibold' : 'text-text-subtle'
              }`}
            >
              {i + 1}
            </div>
            {isSelected && (
              <span className="absolute top-1.5 left-1.5 w-4 h-4 rounded-[var(--ui-radius-sm)] bg-accent-strong ring-1 ring-accent-soft-border flex items-center justify-center">
                {/* The rim, not the fill, is what separates the badge from the
                    white page under it: accent-strong is 2.85:1 on white in the
                    light theme and 1.92:1 in the dark one. */}
                <Icon d={ICON.check} size={14} className="text-on-accent" />
                <span className="sr-only">Selected</span>
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ---------------------------------------------------------------------------

function SearchPanel({ search, onGoToPage }) {
  const { query, setQuery, options, setOptions, matches, activeIndex, searching, run, next, previous, clear } = search
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const grouped = useMemo(() => {
    const out = new Map()
    matches.forEach((m, i) => {
      if (!out.has(m.pageIndex)) out.set(m.pageIndex, [])
      out.get(m.pageIndex).push({ ...m, globalIndex: i })
    })
    return [...out.entries()].sort((a, b) => a[0] - b[0])
  }, [matches])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <form
        className="shrink-0 p-2 border-b border-border space-y-1.5"
        onSubmit={(e) => { e.preventDefault(); run(query, options) }}
      >
        <div className="relative">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-subtle">
            <Icon d={TABS[1].icon} size={14} />
          </span>
          <TextInput
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find in document"
            className="pl-7 pr-7"
            aria-label="Search text"
          />
          {query && (
            <IconButton
              label="Clear search"
              size="sm"
              onClick={clear}
              className="absolute right-0.5 top-1/2 -translate-y-1/2"
            >
              <Icon d={ICON.close} size={14} />
            </IconButton>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Checkbox
            label="Match case"
            checked={options.caseSensitive}
            onChange={(e) => { const o = { ...options, caseSensitive: e.target.checked }; setOptions(o); run(query, o) }}
          />
          <Checkbox
            label="Whole word"
            checked={options.wholeWord}
            onChange={(e) => { const o = { ...options, wholeWord: e.target.checked }; setOptions(o); run(query, o) }}
          />
        </div>

        {matches.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] tabular-nums text-text-subtle">
              {activeIndex + 1} of {matches.length}
            </span>
            <div className="flex items-center gap-0.5">
              <IconButton label="Previous match" size="sm" onClick={previous}>
                <Icon d={ICON.chevronUp} size={14} />
              </IconButton>
              <IconButton label="Next match" size="sm" onClick={next}>
                <Icon d={ICON.chevronDown} size={14} />
              </IconButton>
            </div>
          </div>
        )}
      </form>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {searching && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-text-muted">
            <Spinner size={14} />
            Searching…
          </div>
        )}
        {!searching && !query && (
          <EmptyState
            icon={<Icon d={TABS[1].icon} size={18} />}
            title="Find in document"
            line="Enter a word or phrase to list every place it appears."
          />
        )}
        {!searching && query && matches.length === 0 && (
          <EmptyState
            icon={<Icon d={TABS[1].icon} size={18} />}
            title="No matches"
            line="If this is a scanned document, run OCR first to make its text searchable."
          />
        )}
        {grouped.map(([pageIndex, items]) => (
          <div key={pageIndex}>
            {/* Quiet on purpose: the header is a divider between results, not a
                result. Sticky, and opaque so rows pass behind it rather than
                through it. */}
            <div className="sticky top-0 z-10 px-2 bg-dark-bg border-b border-border-light">
              <SectionHeading level="sub">Page {pageIndex + 1}</SectionHeading>
            </div>
            {items.map(item => {
              const isActive = item.globalIndex === activeIndex
              return (
                <button
                  key={`${item.pageId}-${item.start}`}
                  type="button"
                  data-focus="inset"
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => { search.setActiveIndex(item.globalIndex); onGoToPage(item.pageId) }}
                  className={`w-full text-left px-2 py-1.5 text-xs leading-snug border-b border-b-border-light border-l-2 transition-colors ${
                    isActive
                      ? 'bg-accent-soft border-l-accent-edge'
                      : 'border-l-transparent hover:bg-section-bg'
                  }`}
                >
                  <span className="text-text-muted">{item.snippet.before}</span>
                  {/* The term is the answer to the question, so it carries a
                      real fill rather than a tint — it has to stay findable on
                      the plain row, the hovered row and the active row alike. */}
                  <mark className="bg-accent-strong text-on-accent px-0.5">{item.snippet.match}</mark>
                  <span className="text-text-muted">{item.snippet.after}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function BookmarkList({ onGoToPage }) {
  const { state, commit } = useEditor()
  const bookmarks = state.doc.bookmarks

  if (bookmarks.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <EmptyState
          icon={<Icon d={TABS[2].icon} size={18} />}
          title="No bookmarks"
          line="Add bookmarks from the Organize tab. They become the table of contents in the exported PDF."
        />
      </div>
    )
  }

  return (
    <ul className="flex-1 min-h-0 overflow-y-auto py-1">
      {bookmarks.map(b => {
        const pageIndex = state.pages.findIndex(p => p.id === b.pageId)
        return (
          <li key={b.id} className="group flex items-center gap-1 pl-2 pr-1 transition-colors hover:bg-section-bg">
            <button
              type="button"
              data-focus="inset"
              onClick={() => onGoToPage(b.pageId)}
              className="flex-1 min-w-0 flex items-center gap-2 h-[var(--ui-row-h)] text-left"
              title={b.title}
            >
              <span className="flex-1 truncate text-xs">{b.title}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-text-subtle">p.{pageIndex + 1}</span>
            </button>
            {/* Revealed on hover, but never hidden from the keyboard: an
                opacity-0 control is still in the tab order, so focus has to
                bring it back or the ring lands on nothing. */}
            <IconButton
              size="sm"
              variant="danger"
              label={`Delete bookmark ${b.title}`}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => commit('Delete bookmark', d => {
                d.doc.bookmarks = d.doc.bookmarks.filter(x => x.id !== b.id)
              })}
            >
              <Icon d={ICON.trash} size={14} />
            </IconButton>
          </li>
        )
      })}
    </ul>
  )
}
