import { useState, useMemo, useRef, useEffect } from 'react'
import { useEditor } from '../state/useEditor'
import { displaySize } from '../state/documentModel'
import PageCanvas from '../viewer/PageCanvas'

const TABS = [
  { id: 'pages', label: 'Pages', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'search', label: 'Search', icon: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35' },
  { id: 'bookmarks', label: 'Bookmarks', icon: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' },
]

const Icon = ({ d }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

/**
 * Left rail: page thumbnails, search results and bookmarks.
 *
 * Thumbnails double as the page-organisation surface — selection here is the
 * same selection the Organize tools act on, so there is no separate "manage
 * pages" screen to switch to and lose your place in the document.
 */
export default function LeftRail({ search, onGoToPage, collapsed, onToggle, tab, setTab }) {
  if (collapsed) {
    return (
      <div className="w-10 bg-dark-bg border-r border-border flex flex-col items-center py-2 gap-1 shrink-0">
        <button onClick={onToggle} title="Show panel" className="p-2 rounded-lg hover:bg-alt-bg text-text-primary/70">
          <Icon d="M9 18l6-6-6-6" />
        </button>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); onToggle() }}
            title={t.label}
            className="p-2 rounded-lg hover:bg-alt-bg text-text-primary/70"
          >
            <Icon d={t.icon} />
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="w-60 bg-dark-bg border-r border-border flex flex-col shrink-0">
      <div className="flex items-center border-b border-border" role="tablist" aria-label="Document panels">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            title={t.label}
            className={`flex-1 flex items-center justify-center py-2.5 transition-colors ${
              tab === t.id ? 'text-accent border-b-2 border-accent' : 'text-text-primary/50 hover:text-text-primary'
            }`}
          >
            <Icon d={t.icon} />
          </button>
        ))}
        <button onClick={onToggle} title="Hide panel" className="px-2 py-2.5 text-text-primary/50 hover:text-text-primary">
          <Icon d="M15 18l-6-6 6-6" />
        </button>
      </div>

      {tab === 'pages' && <ThumbnailList onGoToPage={onGoToPage} />}
      {tab === 'search' && <SearchPanel search={search} onGoToPage={onGoToPage} />}
      {tab === 'bookmarks' && <BookmarkList onGoToPage={onGoToPage} />}
    </div>
  )
}

// ---------------------------------------------------------------------------

function ThumbnailList({ onGoToPage }) {
  const {
    state, currentPageId, selectedPageIds, togglePageSelection,
    setPageSelection, movePage,
  } = useEditor()

  const dragIndexRef = useRef(null)
  const [dropIndex, setDropIndex] = useState(null)

  return (
    <div className="flex-1 overflow-auto p-2 space-y-2">
      {state.pages.map((page, i) => {
        const isCurrent = page.id === currentPageId
        const isSelected = selectedPageIds.has(page.id)
        const { width, height } = displaySize(page)
        const thumbWidth = 150
        const scale = thumbWidth / width

        return (
          <div
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
            className={`relative rounded-lg p-1 cursor-pointer transition-colors ${
              dropIndex === i ? 'ring-2 ring-accent' : ''
            } ${isSelected ? 'bg-accent/15' : 'hover:bg-alt-bg'}`}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey) togglePageSelection(page.id)
              else { setPageSelection([page.id]); onGoToPage(page.id) }
            }}
          >
            <div
              className={`relative mx-auto bg-white overflow-hidden shadow ${
                isCurrent ? 'ring-2 ring-accent' : 'ring-1 ring-border'
              }`}
              style={{ width: thumbWidth, height: Math.round(height * scale) }}
            >
              <PageCanvas
                page={page}
                scale={scale}
                width={thumbWidth}
                height={Math.round(height * scale)}
              />
            </div>
            <div className="text-center text-[11px] mt-1 text-text-primary/60">{i + 1}</div>
            {isSelected && (
              <div className="absolute top-2 left-2 w-4 h-4 rounded bg-accent flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--theme-title-bg)" strokeWidth="3">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
            )}
          </div>
        )
      })}
    </div>
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
        className="p-2 border-b border-border space-y-2"
        onSubmit={(e) => { e.preventDefault(); run(query, options) }}
      >
        <div className="relative">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find in document"
            className="w-full pl-3 pr-8 py-2 rounded-lg bg-alt-bg border border-border text-sm focus:outline-none focus:border-accent"
            aria-label="Search text"
          />
          {query && (
            <button type="button" onClick={clear} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-primary/40 hover:text-text-primary" aria-label="Clear search">
              <Icon d="M18 6L6 18M6 6l12 12" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 text-[11px] text-text-primary/70">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={options.caseSensitive}
                   onChange={(e) => { const o = { ...options, caseSensitive: e.target.checked }; setOptions(o); run(query, o) }} />
            Match case
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={options.wholeWord}
                   onChange={(e) => { const o = { ...options, wholeWord: e.target.checked }; setOptions(o); run(query, o) }} />
            Whole word
          </label>
        </div>

        {matches.length > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-primary/60">{activeIndex + 1} of {matches.length}</span>
            <div className="flex gap-1">
              <button type="button" onClick={previous} className="p-1 rounded hover:bg-alt-bg" aria-label="Previous match">
                <Icon d="M18 15l-6-6-6 6" />
              </button>
              <button type="button" onClick={next} className="p-1 rounded hover:bg-alt-bg" aria-label="Next match">
                <Icon d="M6 9l6 6 6-6" />
              </button>
            </div>
          </div>
        )}
      </form>

      <div className="flex-1 overflow-auto">
        {searching && <p className="p-3 text-xs text-text-primary/50">Searching…</p>}
        {!searching && query && matches.length === 0 && (
          <p className="p-3 text-xs text-text-primary/50">
            No matches. If this is a scanned document, run OCR first to make its text searchable.
          </p>
        )}
        {grouped.map(([pageIndex, items]) => (
          <div key={pageIndex}>
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-text-primary/40 bg-alt-bg/50 sticky top-0">
              Page {pageIndex + 1}
            </div>
            {items.map(item => (
              <button
                key={`${item.pageId}-${item.start}`}
                onClick={() => { search.setActiveIndex(item.globalIndex); onGoToPage(item.pageId) }}
                className={`w-full text-left px-3 py-2 text-xs leading-snug border-b border-border/40 hover:bg-alt-bg ${
                  item.globalIndex === activeIndex ? 'bg-accent/10' : ''
                }`}
              >
                <span className="text-text-primary/55">{item.snippet.before}</span>
                <span className="bg-accent/40 text-text-primary rounded-sm px-0.5">{item.snippet.match}</span>
                <span className="text-text-primary/55">{item.snippet.after}</span>
              </button>
            ))}
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
      <div className="flex-1 p-4 text-xs text-text-primary/50">
        No bookmarks yet. Add them from the Organize tab to build a table of contents in the exported PDF.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto py-1">
      {bookmarks.map(b => {
        const pageIndex = state.pages.findIndex(p => p.id === b.pageId)
        return (
          <div key={b.id} className="group flex items-center gap-2 px-3 py-2 hover:bg-alt-bg">
            <button onClick={() => onGoToPage(b.pageId)} className="flex-1 text-left text-xs truncate" title={b.title}>
              {b.title}
              <span className="ml-2 text-text-primary/40">p.{pageIndex + 1}</span>
            </button>
            <button
              onClick={() => commit('Delete bookmark', d => {
                d.doc.bookmarks = d.doc.bookmarks.filter(x => x.id !== b.id)
              })}
              className="opacity-0 group-hover:opacity-100 text-text-primary/40 hover:text-negative"
              aria-label={`Delete bookmark ${b.title}`}
            >
              <Icon d="M18 6L6 18M6 6l12 12" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
