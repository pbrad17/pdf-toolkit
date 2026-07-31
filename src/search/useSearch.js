import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { searchDocument, rectsForMatches, clearSearchCache } from './searchIndex'

/**
 * Search state for the document.
 *
 * Rects are resolved only for the pages the viewer currently has mounted, and
 * the set of those pages changes as the user scrolls, so resolution is driven
 * by a `visiblePageIds` input rather than computed once when the query runs.
 */
export function useSearch(pages) {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState({ caseSensitive: false, wholeWord: false })
  const [matches, setMatches] = useState([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [searching, setSearching] = useState(false)
  const [rectsByPage, setRectsByPage] = useState({})

  /** Guards against an older, slower query overwriting a newer one's results. */
  const runIdRef = useRef(0)

  const run = useCallback(async (nextQuery, nextOptions) => {
    const q = nextQuery ?? query
    const opts = nextOptions ?? options
    const runId = ++runIdRef.current

    if (!q.trim()) {
      setMatches([])
      setActiveIndex(-1)
      setRectsByPage({})
      setSearching(false)
      return
    }

    setSearching(true)
    const found = await searchDocument(pages, q, opts)
    if (runId !== runIdRef.current) return

    setMatches(found)
    setActiveIndex(found.length > 0 ? 0 : -1)
    setRectsByPage({})
    setSearching(false)
  }, [pages, query, options])

  // Re-run when the document itself changes, so results never point at pages
  // that have since been deleted or reordered.
  useEffect(() => {
    if (query.trim()) run(query, options)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages])

  const clear = useCallback(() => {
    runIdRef.current++
    setQuery('')
    setMatches([])
    setActiveIndex(-1)
    setRectsByPage({})
  }, [])

  const next = useCallback(() => {
    setActiveIndex(i => (matches.length === 0 ? -1 : (i + 1) % matches.length))
  }, [matches.length])

  const previous = useCallback(() => {
    setActiveIndex(i => (matches.length === 0 ? -1 : (i - 1 + matches.length) % matches.length))
  }, [matches.length])

  const matchesByPage = useMemo(() => {
    const grouped = {}
    for (const m of matches) {
      if (!grouped[m.pageId]) grouped[m.pageId] = []
      grouped[m.pageId].push(m)
    }
    return grouped
  }, [matches])

  /** Resolve highlight rects for pages that just became visible. */
  const resolveRects = useCallback(async (visiblePageIds) => {
    const pending = visiblePageIds.filter(id => matchesByPage[id] && !rectsByPage[id])
    if (pending.length === 0) return

    const resolved = {}
    for (const pageId of pending) {
      const page = pages.find(p => p.id === pageId)
      if (!page) continue
      try {
        resolved[pageId] = await rectsForMatches(page, matchesByPage[pageId])
      } catch {
        resolved[pageId] = []
      }
    }
    setRectsByPage(prev => ({ ...prev, ...resolved }))
  }, [matchesByPage, rectsByPage, pages])

  const activeMatch = activeIndex >= 0 ? matches[activeIndex] : null

  /**
   * Position of the active match within its own page, so the page's highlight
   * list knows which rect to emphasise.
   */
  const activeMatchOnPage = useMemo(() => {
    if (!activeMatch) return null
    const onPage = matchesByPage[activeMatch.pageId] || []
    return {
      pageId: activeMatch.pageId,
      indexOnPage: onPage.findIndex(m => m.start === activeMatch.start),
    }
  }, [activeMatch, matchesByPage])

  useEffect(() => () => clearSearchCache(), [])

  return {
    query, setQuery,
    options, setOptions,
    matches, matchesByPage, rectsByPage,
    activeIndex, activeMatch, activeMatchOnPage, setActiveIndex,
    searching, run, clear, next, previous, resolveRects,
  }
}
